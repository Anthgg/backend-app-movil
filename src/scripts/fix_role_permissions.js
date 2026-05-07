const { query } = require('../config/database');

async function fix() {
  const permissionsByRole = {
    'TRABAJADOR': [
      'requests.create',
      'requests.read_own',
      'requests.update_own',
      'requests.cancel_own',
      'requests.delete_own',
      'vacations.request',
      'vacations.balance.read_own',
      'medical_leaves.request'
    ],
    'SUPERVISOR': [
      'requests.read_company',
      'requests.read_project',
      'requests.approve',
      'requests.reject',
      'requests.observe',
      'workers.read',
      'attendance.read_project',
      'dashboard.read'
    ],
    'RRHH': [
      'requests.read_company',
      'requests.read_all',
      'requests.approve',
      'requests.reject',
      'requests.observe',
      'workers.read',
      'workers.create',
      'workers.update',
      'attendance.read_company',
      'attendance.correct',
      'dashboard.read',
      'dashboard.admin'
    ],
    'ADMIN': [
      'requests.read_company',
      'requests.read_all',
      'requests.approve',
      'requests.reject',
      'requests.observe'
    ]
  };

  try {
    console.log('Fixing role permissions...');

    for (const [roleName, permissions] of Object.entries(permissionsByRole)) {
      const roleRes = await query('SELECT id FROM roles WHERE name = $1', [roleName]);
      if (roleRes.rows.length === 0) {
        console.warn(`Role ${roleName} not found, skipping...`);
        continue;
      }
      const roleId = roleRes.rows[0].id;

      for (const permName of permissions) {
        // Ensure permission exists
        let permRes = await query('SELECT id FROM permissions WHERE name = $1', [permName]);
        let permId;
        if (permRes.rows.length === 0) {
          const insertPerm = await query('INSERT INTO permissions (name) VALUES ($1) RETURNING id', [permName]);
          permId = insertPerm.rows[0].id;
        } else {
          permId = permRes.rows[0].id;
        }

        // Assign to role
        await query('INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roleId, permId]);
      }
      console.log(`- Permissions for ${roleName} fixed.`);
    }

    console.log('Role permissions fix completed.');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing permissions:', error);
    process.exit(1);
  }
}

fix();
