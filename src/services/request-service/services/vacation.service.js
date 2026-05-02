const { query } = require('../../../config/database');

class VacationService {

    async getVacationBalance(workerId, tenantId) {
        const result = await query(`
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'credit' THEN days ELSE 0 END), 0) as total_accrued,
                COALESCE(SUM(CASE WHEN type = 'debit' THEN days ELSE 0 END), 0) as total_taken
            FROM vacation_ledger
            WHERE worker_id = $1 AND company_id = $2
        `, [workerId, tenantId]);

        const { total_accrued, total_taken } = result.rows[0];
        const balance = total_accrued - total_taken;

        return { worker_id: workerId, total_accrued, total_taken, balance };
    }

    async checkVacationBalance(workerId, tenantId, daysRequested) {
        const { balance } = await this.getVacationBalance(workerId, tenantId);
        if (balance < daysRequested) {
            const err = new Error(`Saldo de vacaciones insuficiente. Solicitados: ${daysRequested}, Disponible: ${balance}`);
            err.statusCode = 400;
            throw err;
        }
    }

    async updateVacationLedger(workerId, tenantId, type, days, reason) {
        await query(`
            INSERT INTO vacation_ledger (company_id, worker_id, type, days, reason)
            VALUES ($1, $2, $3, $4, $5)
        `, [tenantId, workerId, type, days, reason]);
    }
}

module.exports = new VacationService();
