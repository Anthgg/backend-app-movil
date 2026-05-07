const { query } = require('../../../config/database');

class ShiftRepository {
  async getAll(companyId) {
    const res = await query(
      'SELECT * FROM shifts WHERE company_id = $1 AND is_active = true ORDER BY start_time ASC',
      [companyId]
    );
    return res.rows;
  }

  async getById(id, companyId) {
    const res = await query(
      'SELECT * FROM shifts WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );
    return res.rows[0];
  }

  async create(companyId, data) {
    const res = await query(
      `INSERT INTO shifts (company_id, name, start_time, end_time, tolerance_minutes, allows_overtime, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [companyId, data.name, data.start_time, data.end_time, data.tolerance_minutes || 0, data.allows_overtime !== false, true]
    );
    return res.rows[0];
  }

  async update(id, companyId, data) {
    const fields = [];
    const values = [];
    let i = 1;

    const addField = (name, val) => {
      if (val !== undefined) {
        fields.push(`${name} = $${i++}`);
        values.push(val);
      }
    };

    addField('name', data.name);
    addField('start_time', data.start_time);
    addField('end_time', data.end_time);
    addField('tolerance_minutes', data.tolerance_minutes);
    addField('allows_overtime', data.allows_overtime);
    addField('is_active', data.is_active);

    if (fields.length === 0) return null;

    values.push(id, companyId);
    const sql = `UPDATE shifts SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i++} AND company_id = $${i++} RETURNING *`;
    
    const res = await query(sql, values);
    return res.rows[0];
  }

  async delete(id, companyId) {
    const res = await query(
      'DELETE FROM shifts WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );
    return res.rows.length > 0;
  }

  async assignToWorker(workerId, shiftId, companyId) {
    // Validar que el turno pertenece a la compañía
    const shift = await this.getById(shiftId, companyId);
    if (!shift) throw new Error('Turno no encontrado o no pertenece a la empresa.');

    const res = await query(
      'UPDATE workers SET shift_id = $1 WHERE id = $2 AND company_id = $3 RETURNING *',
      [shiftId, workerId, companyId]
    );
    return res.rows[0];
  }

  async getWorkerShift(workerId, companyId) {
    const res = await query(
      `SELECT s.* FROM shifts s
       JOIN workers w ON w.shift_id = s.id
       WHERE w.id = $1 AND w.company_id = $2`,
      [workerId, companyId]
    );
    return res.rows[0];
  }
}

module.exports = new ShiftRepository();
