const { query } = require('../../config/database');

async function resolveUserAccess(userId, fallbackRole = 'TRABAJADOR', companyId = null) {
  const roleRes = await query(`
    SELECT DISTINCT r.id, COALESCE(NULLIF(r.code, ''), r.name) AS role_code
    FROM roles r
    JOIN user_roles ur ON r.id = ur.role_id
    WHERE ur.user_id = $1
    ORDER BY role_code
  `, [userId]);

  let roles = roleRes.rows.map((row) => row.role_code);
  let roleIds = roleRes.rows.map((row) => row.id);

  if (roles.length === 0 && fallbackRole) {
    const fallbackRes = await query(`
      SELECT id, COALESCE(NULLIF(code, ''), name) AS role_code
      FROM roles
      WHERE (name = $1 OR code = $1)
        AND (company_id = $2 OR company_id IS NULL)
        AND COALESCE(is_active, TRUE) = TRUE
        AND deleted_at IS NULL
      ORDER BY CASE WHEN company_id = $2 THEN 0 ELSE 1 END, created_at ASC NULLS LAST
      LIMIT 1
    `, [fallbackRole, companyId]);

    if (fallbackRes.rows[0]) {
      roles = [fallbackRes.rows[0].role_code];
      roleIds = [fallbackRes.rows[0].id];
    } else {
      roles = [fallbackRole];
    }
  }

  let permissions = [];
  if (roleIds.length > 0) {
    const permRes = await query(`
      SELECT DISTINCT p.name
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ANY($1::uuid[])
      ORDER BY p.name
    `, [roleIds]);
    permissions = permRes.rows.map((row) => row.name);
  }

  return { roles, permissions };
}

module.exports = { resolveUserAccess };
