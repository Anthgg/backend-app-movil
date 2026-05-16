const { query } = require('../config/database');
const moment = require('moment-timezone');

const BUSINESS_TZ = 'America/Lima';

async function seed() {
  try {
    console.log('Seeding 15 days of attendance history (including today)...');

    // Get all workers
    const workersRes = await query(`
      SELECT w.id as worker_id, w.company_id, pa.project_id
      FROM workers w
      LEFT JOIN project_assignments pa ON w.id = pa.worker_id AND pa.unassigned_at IS NULL
      WHERE w.deleted_at IS NULL AND w.is_active = true
    `);

    const workers = workersRes.rows;
    console.log(`Found ${workers.length} active workers.`);

    for (const worker of workers) {
      const { worker_id, company_id, project_id } = worker;
      console.log(`- Processing worker: ${worker_id}`);
      
      for (let i = 14; i >= 0; i--) {
        const date = moment().tz(BUSINESS_TZ).subtract(i, 'days');
        const dateStr = date.format('YYYY-MM-DD');
        const dayOfWeek = date.day(); // 0 (Sun) to 6 (Sat)

        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekends

        // Random logic for status
        const rand = Math.random();
        let status = 'present';
        let checkIn = null;
        let checkOut = null;
        let lateMinutes = 0;
        let workedHours = 8;

        if (rand < 0.1) {
          status = 'absent';
          workedHours = 0;
        } else if (rand < 0.25) {
          status = 'late';
          checkIn = moment(`${dateStr} 08:15:00`).tz(BUSINESS_TZ).toDate();
          checkOut = moment(`${dateStr} 17:00:00`).tz(BUSINESS_TZ).toDate();
          lateMinutes = 15;
          workedHours = 8.75;
        } else {
          checkIn = moment(`${dateStr} 08:00:00`).tz(BUSINESS_TZ).toDate();
          // If today and rand > 0.5, maybe haven't checked out yet
          if (i === 0 && rand > 0.5) {
            checkOut = null;
            workedHours = 0;
          } else {
            checkOut = moment(`${dateStr} 17:00:00`).tz(BUSINESS_TZ).toDate();
          }
        }

        await query(`
          INSERT INTO attendance_records (
            worker_id, company_id, project_id, date, status, 
            check_in_time, check_out_time, late_minutes, worked_hours,
            check_in_latitude, check_in_longitude
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (worker_id, date) DO UPDATE SET 
            status = EXCLUDED.status, 
            check_in_time = EXCLUDED.check_in_time,
            check_out_time = EXCLUDED.check_out_time,
            worked_hours = EXCLUDED.worked_hours
        `, [
          worker_id, company_id, project_id, dateStr, status,
          checkIn, checkOut, lateMinutes, workedHours,
          -12.046374, -77.042793 // Lima center
        ]);
      }
    }

    console.log('Seeding completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding attendance history:', error);
    process.exit(1);
  }
}

seed();
