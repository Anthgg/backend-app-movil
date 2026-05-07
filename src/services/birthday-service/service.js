const { query } = require('../../config/database');

function formatDateOnly(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function serializeBirthday(row) {
  return {
    id: row.user_id,
    fullName: row.full_name,
    position: row.position || null,
    profilePhotoUrl: row.profile_photo_url || null,
    birthDate: formatDateOnly(row.birth_date)
  };
}

async function fetchCompanyBirthdays(tenantId) {
  const result = await query(`
    SELECT
      u.id AS user_id,
      CONCAT_WS(' ', u.first_name, u.last_name) AS full_name,
      jp.title AS position,
      w.profile_photo_url,
      w.birth_date
    FROM workers w
    JOIN users u ON u.id = w.user_id
    LEFT JOIN job_positions jp ON jp.id = w.job_position_id
    WHERE w.company_id = $1
      AND w.deleted_at IS NULL
      AND w.birth_date IS NOT NULL
    ORDER BY EXTRACT(MONTH FROM w.birth_date), EXTRACT(DAY FROM w.birth_date), u.first_name, u.last_name
  `, [tenantId]);

  return result.rows;
}

function nextBirthdayDate(birthDate, now = new Date()) {
  const currentYear = now.getFullYear();
  const birth = new Date(birthDate);
  let next = new Date(Date.UTC(currentYear, birth.getUTCMonth(), birth.getUTCDate()));

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (next < today) {
    next = new Date(Date.UTC(currentYear + 1, birth.getUTCMonth(), birth.getUTCDate()));
  }

  return next;
}

class BirthdayService {
  async getTodayBirthdays(tenantId) {
    const rows = await fetchCompanyBirthdays(tenantId);
    const now = new Date();

    return rows
      .filter((row) => {
        const birth = new Date(row.birth_date);
        return birth.getUTCMonth() === now.getUTCMonth() && birth.getUTCDate() === now.getUTCDate();
      })
      .map(serializeBirthday);
  }

  async getUpcomingBirthdays(tenantId, days = 30) {
    const rows = await fetchCompanyBirthdays(tenantId);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const max = new Date(today);
    max.setUTCDate(max.getUTCDate() + days);

    return rows
      .map((row) => ({ row, nextDate: nextBirthdayDate(row.birth_date, now) }))
      .filter(({ nextDate }) => nextDate > today && nextDate <= max)
      .sort((a, b) => a.nextDate - b.nextDate)
      .map(({ row }) => serializeBirthday(row));
  }

  async getMonthBirthdays(tenantId, month = null) {
    const rows = await fetchCompanyBirthdays(tenantId);
    const targetMonth = month || new Date().getUTCMonth() + 1;

    return rows
      .filter((row) => new Date(row.birth_date).getUTCMonth() + 1 === targetMonth)
      .map(serializeBirthday);
  }
}

module.exports = new BirthdayService();
