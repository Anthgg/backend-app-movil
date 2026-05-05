const { query } = require('../config/database');
const moment = require('moment-timezone');

const BUSINESS_TZ = 'America/Lima';

async function seed() {
  const companyId = 'c487e654-6827-4dc8-8690-baed056bcd5e'; // Empresa Demo S.A.C.
  const projectId = '59f21f41-9f4b-497f-b396-0da6435b4ff3'; // Demo Mobile HQ
  
  const workerIds = [
    '2f8e3223-9892-4f3f-b6a2-314723d8e951', // trabajador1
    '5bb0cd45-0e19-4b39-9686-2a3ebc26ee02', // trabajador2
    '61be156d-9a3d-4690-8d83-c0862e6be047'  // trabajador3
  ];

  try {
    console.log('Seeding 30 days of attendance history...');

    for (const workerId of workerIds) {
      console.log(`- Processing worker: ${workerId}`);
      
      for (let i = 30; i >= 1; i--) {
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
          checkOut = moment(`${dateStr} 17:00:00`).tz(BUSINESS_TZ).toDate();
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
            check_out_time = EXCLUDED.check_out_time
        `, [
          workerId, companyId, projectId, dateStr, status,
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
