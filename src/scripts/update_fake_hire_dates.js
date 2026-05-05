const { query } = require('../config/database');
const moment = require('moment');

async function update() {
  const companyId = 'c487e654-6827-4dc8-8690-baed056bcd5e'; // Empresa Demo S.A.C.
  
  try {
    console.log('Updating fake hire dates for demo workers...');

    // Obtener todos los trabajadores de la empresa demo
    const workersRes = await query(`
        SELECT w.id, u.email, u.first_name 
        FROM workers w
        JOIN users u ON w.user_id = u.id
        WHERE w.company_id = $1
    `, [companyId]);

    for (const w of workersRes.rows) {
        // Generar una fecha aleatoria entre 6 meses y 2 años atrás
        const monthsAgo = Math.floor(Math.random() * 18) + 6;
        const fakeHireDate = moment().subtract(monthsAgo, 'months').format('YYYY-MM-DD');
        
        await query('UPDATE workers SET hire_date = $1 WHERE id = $2', [fakeHireDate, w.id]);
        
        // También crear un contrato falso si no tiene uno
        const contractExists = await query('SELECT id FROM worker_contracts WHERE worker_id = $1', [w.id]);
        if (contractExists.rows.length === 0) {
            await query(`
                INSERT INTO worker_contracts (worker_id, contract_type_id, start_date, agreed_salary, status)
                VALUES ($1, (SELECT id FROM contract_types LIMIT 1), $2, 2500, 'active')
            `, [w.id, fakeHireDate]);
        }

        console.log(`- Updated ${w.first_name} (${w.email}) hire_date to: ${fakeHireDate}`);
    }

    console.log('Update completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error updating hire dates:', error);
    process.exit(1);
  }
}

update();
