const { query } = require('../../../config/database');

async function getHistory(workerId, tenantId, options = {}) {
    const { page = 1, limit = 10, startDate, endDate } = options;
    const offset = (page - 1) * limit;

    let whereClauses = ['worker_id = $1', 'company_id = $2', 'deleted_at IS NULL'];
    let params = [workerId, tenantId];
    let paramCount = 3;

    if (startDate) {
        whereClauses.push(`date >= $${paramCount++}`);
        params.push(startDate);
    }
    if (endDate) {
        whereClauses.push(`date <= $${paramCount++}`);
        params.push(endDate);
    }

    const whereString = whereClauses.join(' AND ');

    const dataQuery = `SELECT * FROM attendance_records WHERE ${whereString} ORDER BY date DESC, check_in_time DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    const countQuery = `SELECT COUNT(*) FROM attendance_records WHERE ${whereString}`;

    const dataPromise = query(dataQuery, [...params, limit, offset]);
    const countPromise = query(countQuery, params.slice(0, paramCount - 3));

    const [dataRes, countRes] = await Promise.all([dataPromise, countPromise]);

    const total = parseInt(countRes.rows[0].count, 10);

    return {
        data: dataRes.rows,
        pagination: {
            total,
            page: parseInt(page, 10),
            limit: parseInt(limit, 10),
            totalPages: Math.ceil(total / limit)
        }
    };
}

async function correctRecord(recordId, tenantId, correctionData) {
    const { check_in_time, check_out_time, reason, correctorId } = correctionData;

    const recordRes = await query('SELECT * FROM attendance_records WHERE id = $1 AND company_id = $2', [recordId, tenantId]);
    if (recordRes.rows.length === 0) {
        const err = new Error('Registro de asistencia no encontrado.');
        err.statusCode = 404;
        throw err;
    }
    const originalRecord = recordRes.rows[0];

    await query('BEGIN');

    // Guardar el historial de la corrección
    await query(
        `INSERT INTO attendance_corrections 
            (record_id, corrected_by, reason, old_check_in, old_check_out)
         VALUES ($1, $2, $3, $4, $5)`,
        [recordId, correctorId, reason, originalRecord.check_in_time, originalRecord.check_out_time]
    );

    // Aplicar la corrección
    const updatedRecordRes = await query(
        `UPDATE attendance_records 
         SET 
            check_in_time = $1, 
            check_out_time = $2,
            status = 'corrected',
            updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [check_in_time, check_out_time, recordId]
    );

    await query('COMMIT');

    return updatedRecordRes.rows[0];
}


module.exports = { getHistory, correctRecord };
