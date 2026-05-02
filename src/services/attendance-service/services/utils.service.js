const { query } = require('../../../config/database');

async function getWorkerIdFromUserId(userId, tenantId) {
    const workerRes = await query('SELECT id FROM workers WHERE user_id = $1 AND company_id = $2 AND deleted_at IS NULL', [userId, tenantId]);
    if (workerRes.rows.length === 0) {
        const err = new Error('No tienes un perfil de trabajador activo asociado.');
        err.statusCode = 404;
        throw err;
    }
    return workerRes.rows[0].id;
}

module.exports = { getWorkerIdFromUserId };
