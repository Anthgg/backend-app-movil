const { query } = require('../../../config/database');
const moment = require('moment');

class VacationService {
    /**
     * Calcula el balance de vacaciones según normativa peruana (30 días por año).
     * accumulatedDays = meses completos * 2.5
     */
    async getVacationBalance(workerId, tenantId) {
        // 1. Obtener fecha de ingreso
        const workerRes = await query('SELECT hire_date FROM workers WHERE id = $1 AND company_id = $2', [workerId, tenantId]);
        if (workerRes.rows.length === 0 || !workerRes.rows[0].hire_date) {
            return { error: 'HIRE_DATE_REQUIRED' };
        }

        const hireDate = moment(workerRes.rows[0].hire_date);
        const today = moment();
        const monthsWorked = today.diff(hireDate, 'months', true); // Incluye decimales para proporcional
        
        // Regla: 30 días al año = 2.5 días al mes
        const accumulatedDays = parseFloat((monthsWorked * 2.5).toFixed(2));

        // 2. Obtener días usados (aprobados) y pendientes (en revisión)
        // Buscamos el tipo de solicitud "VACACIONES"
        const typeRes = await query("SELECT id FROM request_types WHERE name ILIKE '%vacaciones%' OR code = 'VAC' LIMIT 1");
        const vacationTypeId = typeRes.rows[0]?.id;

        let usedDays = 0;
        let pendingDays = 0;

        if (vacationTypeId) {
            const requestsRes = await query(`
                SELECT status, SUM(days_requested) as total_days
                FROM employee_requests
                WHERE worker_id = $1 AND company_id = $2 AND request_type_id = $3
                AND status IN ('approved', 'pending')
                GROUP BY status
            `, [workerId, tenantId, vacationTypeId]);

            requestsRes.rows.forEach(row => {
                if (row.status === 'approved') usedDays = parseInt(row.total_days, 10);
                if (row.status === 'pending') pendingDays = parseInt(row.total_days, 10);
            });
        }

        const availableDays = parseFloat((accumulatedDays - usedDays - pendingDays).toFixed(2));

        return {
            workerId,
            hireDate: hireDate.format('YYYY-MM-DD'),
            monthsWorked: parseFloat(monthsWorked.toFixed(2)),
            yearsWorked: parseFloat((monthsWorked / 12).toFixed(2)),
            annualVacationDays: 30,
            accumulatedDays,
            usedDays,
            pendingDays,
            availableDays,
            calculationMode: 'calendar_days',
            countryRule: 'PE_30_DAYS_PER_YEAR'
        };
    }

    async checkVacationBalance(workerId, tenantId, daysRequested) {
        const balance = await this.getVacationBalance(workerId, tenantId);
        if (balance.error) {
            const err = new Error('El trabajador no tiene fecha de ingreso registrada');
            err.statusCode = 422;
            err.errorCode = 'HIRE_DATE_REQUIRED';
            throw err;
        }

        if (balance.availableDays < daysRequested) {
            const err = new Error(`Saldo de vacaciones insuficiente. Solicitados: ${daysRequested}, Disponible: ${balance.availableDays}`);
            err.statusCode = 409;
            err.errorCode = 'INSUFFICIENT_VACATION_BALANCE';
            err.data = { availableDays: balance.availableDays, requestedDays: daysRequested };
            throw err;
        }
    }
}

module.exports = new VacationService();
