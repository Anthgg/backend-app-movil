const { query } = require('../../../config/database');

class ProfileService {
    async getProfile(userId, tenantId) {
        const result = await query(`
            SELECT 
                u.id, u.email, u.first_name, u.last_name,
                w.phone_number as phone, w.address, w.personal_email, w.birth_date,
                w.emergency_contact_name, w.emergency_contact_phone, w.profile_photo_url,
                jp.title as position, d.name as department
            FROM users u
            LEFT JOIN workers w ON u.id = w.user_id
            LEFT JOIN job_positions jp ON w.job_position_id = jp.id
            LEFT JOIN departments d ON jp.department_id = d.id
            WHERE u.id = $1 AND u.company_id = $2
        `, [userId, tenantId]);

        if (result.rows.length === 0) throw new Error('Usuario no encontrado.');
        return result.rows[0];
    }

    async updateProfile(userId, tenantId, data) {
        const { phone, address, personal_email, birth_date, emergency_contact_name, emergency_contact_phone } = data;

        // Validaciones básicas
        if (phone && !/^\d{9}$/.test(phone)) throw new Error('El celular debe tener 9 dígitos.');
        if (personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal_email)) throw new Error('Correo inválido.');

        const result = await query(`
            UPDATE workers 
            SET 
                phone_number = COALESCE($1, phone_number),
                address = COALESCE($2, address),
                personal_email = COALESCE($3, personal_email),
                birth_date = COALESCE($4, birth_date),
                emergency_contact_name = COALESCE($5, emergency_contact_name),
                emergency_contact_phone = COALESCE($6, emergency_contact_phone),
                updated_at = NOW()
            WHERE user_id = $7 AND company_id = $8
            RETURNING *
        `, [phone, address, personal_email, birth_date, emergency_contact_name, emergency_contact_phone, userId, tenantId]);

        if (result.rows.length === 0) throw new Error('No se pudo actualizar el perfil. ¿Es usted un trabajador activo?');
        return result.rows[0];
    }

    async updatePhoto(userId, tenantId, photoUrl) {
        const result = await query(`
            UPDATE workers 
            SET profile_photo_url = $1, updated_at = NOW() 
            WHERE user_id = $2 AND company_id = $3 
            RETURNING profile_photo_url
        `, [photoUrl, userId, tenantId]);

        if (result.rows.length === 0) throw new Error('No se pudo actualizar la foto.');
        return result.rows[0];
    }

    async deletePhoto(userId, tenantId) {
        await query(`
            UPDATE workers 
            SET profile_photo_url = NULL, updated_at = NOW() 
            WHERE user_id = $1 AND company_id = $2
        `, [userId, tenantId]);
        return { success: true };
    }
}

module.exports = new ProfileService();
