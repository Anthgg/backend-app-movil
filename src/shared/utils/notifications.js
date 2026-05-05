const { query } = require('../../config/database');

/**
 * Crea una notificación para un usuario.
 * @param {string} userId - ID del usuario destinatario.
 * @param {string} companyId - ID de la empresa.
 * @param {string} title - Título de la notificación.
 * @param {string} message - Cuerpo del mensaje.
 * @param {string} type - Tipo de notificación (request_approved, request_rejected, etc.)
 * @param {object} metadata - Datos adicionales (opcional).
 */
async function createNotification(userId, companyId, title, message, type, channel = 'system') {
    try {
        await query(`
            INSERT INTO notifications (user_id, company_id, title, message, type, channel, is_read, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
        `, [userId, companyId, title, message, type, channel]);
        
        console.log(`[NOTIFICATION] To User ${userId}: ${title} - ${message}`);
    } catch (error) {
        console.error('[NOTIFICATION_ERROR]', error);
    }
}

module.exports = { createNotification };
