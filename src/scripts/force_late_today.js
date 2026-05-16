const { query } = require('../config/database');
const moment = require('moment-timezone');

const BUSINESS_TZ = 'America/Lima';

async function forceLateInsert() {
  try {
    const todayStr = moment().tz(BUSINESS_TZ).format('YYYY-MM-DD');
    console.log(`Inserting lateness for today (${todayStr}) for all active workers...`);

    // Obtener todos los trabajadores activos
    const workersRes = await query(`
      SELECT w.id as worker_id, w.company_id, pa.project_id
      FROM workers w
      LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
      WHERE w.deleted_at IS NULL AND w.is_active = true
    `);

    const workers = workersRes.rows;
    let inserted = 0;

    for (const worker of workers) {
      const lateMinutes = Math.floor(Math.random() * 45) + 15; // 15 a 60 min
      const checkInTime = moment().tz(BUSINESS_TZ).startOf('day').add(8, 'hours').add(lateMinutes, 'minutes').toDate();

      await query(`
        INSERT INTO attendance_records (
          worker_id, company_id, project_id, date, status, 
          check_in_time, check_out_time, late_minutes, worked_hours,
          check_in_latitude, check_in_longitude
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (worker_id, date) DO UPDATE SET 
          status = EXCLUDED.status, 
          check_in_time = EXCLUDED.check_in_time,
          late_minutes = EXCLUDED.late_minutes,
          check_out_time = NULL,
          worked_hours = 0
      `, [
        worker.worker_id, 
        worker.company_id, 
        worker.project_id, 
        todayStr, 
        'late',
        checkInTime, 
        null, 
        lateMinutes, 
        0,
        -12.046374, 
        -77.042793
      ]);
      inserted++;
    }

    console.log(`Inserted/Updated ${inserted} records for today to be LATE.`);
    process.exit(0);
  } catch (error) {
    console.error('Error forcing late records:', error);
    process.exit(1);
  }
}

forceLateInsert();
