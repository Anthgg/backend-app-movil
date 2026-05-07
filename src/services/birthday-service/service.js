const { query } = require('../../../config/database');

class BirthdayService {
    async getTodayBirthdays(tenantId) {
        return query(`
            SELECT 
                w.id, 
                (u.first_name || ' ' || u.last_name) as full_name,
                jp.title as position,
                w.profile_photo_url,
                w.birth_date
            FROM workers w
            JOIN users u ON w.user_id = u.id
            LEFT JOIN job_positions jp ON w.job_position_id = jp.id
            WHERE w.company_id = $1 
            AND EXTRACT(MONTH FROM w.birth_date) = EXTRACT(MONTH FROM CURRENT_DATE)
            AND EXTRACT(DAY FROM w.birth_date) = EXTRACT(DAY FROM CURRENT_DATE)
            AND w.deleted_at IS NULL
        `, [tenantId]).then(res => res.rows);
    }

    async getUpcomingBirthdays(tenantId, days = 30) {
        // Lógica para próximos cumpleaños considerando cambio de año
        return query(`
            SELECT 
                w.id, 
                (u.first_name || ' ' || u.last_name) as full_name,
                jp.title as position,
                w.profile_photo_url,
                w.birth_date,
                TO_CHAR(w.birth_date, 'DD/MM') as birthday_day_month
            FROM workers w
            JOIN users u ON w.user_id = u.id
            LEFT JOIN job_positions jp ON w.job_position_id = jp.id
            WHERE w.company_id = $1 
            AND w.birth_date IS NOT NULL
            AND (
                (EXTRACT(MONTH FROM w.birth_date) = EXTRACT(MONTH FROM CURRENT_DATE) AND EXTRACT(DAY FROM w.birth_date) > EXTRACT(DAY FROM CURRENT_DATE))
                OR 
                (EXTRACT(MONTH FROM w.birth_date) > EXTRACT(MONTH FROM CURRENT_DATE))
            )
            AND w.deleted_at IS NULL
            ORDER BY EXTRACT(MONTH FROM w.birth_date) ASC, EXTRACT(DAY FROM w.birth_date) ASC
            LIMIT 10
        `, [tenantId]).then(res => res.rows);
    }
}

module.exports = new BirthdayService();
