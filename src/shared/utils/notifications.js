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

async function getCompanyNotificationRecipients(companyId) {
    const result = await query(`
        SELECT DISTINCT u.id
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        LEFT JOIN permissions p ON p.id = rp.permission_id
        WHERE u.company_id = $1
          AND u.deleted_at IS NULL
          AND u.is_active = true
          AND (
            r.name IN ('ADMIN', 'RRHH')
            OR p.name IN ('requests.read_company', 'requests.read_all', 'requests.approve', 'requests.reject', 'requests.observe')
          )
    `, [companyId]);

    return result.rows.map((row) => row.id);
}

async function createNotificationsForUsers(userIds, companyId, title, message, type, channel = 'system') {
    const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];

    for (const userId of uniqueUserIds) {
        await createNotification(userId, companyId, title, message, type, channel);
    }
}

module.exports = { createNotification, createNotificationsForUsers, getCompanyNotificationRecipients };
