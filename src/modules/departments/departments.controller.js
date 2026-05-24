const { query } = require('../../config/database');

/**
 * GET /api/departments
 * Returns the global departments catalog (departments is a shared table, no company_id).
 */
async function getDepartments(req, res, next) {
  try {
    const res2 = await query(
      `SELECT id, name, code, status AS is_active
       FROM departments
       WHERE deleted_at IS NULL
         AND COALESCE(status, TRUE) = TRUE
       ORDER BY name ASC`
    );
    res.json({
      success: true,
      message: 'Departamentos obtenidos correctamente',
      data: res2.rows
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDepartments };
