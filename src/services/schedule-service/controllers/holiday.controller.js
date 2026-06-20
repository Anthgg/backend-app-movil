const { query } = require('../../../config/database');
const { v4: uuidv4 } = require('uuid');

exports.getHolidays = async (req, res, next) => {
  try {
    const { year, country, active } = req.query;
    
    let sql = 'SELECT * FROM holidays WHERE 1=1';
    const params = [];

    if (year) {
      params.push(`${year}-01-01`);
      params.push(`${year}-12-31`);
      sql += ` AND date >= $${params.length - 1} AND date <= $${params.length}`;
    }

    if (country) {
      params.push(country);
      sql += ` AND country = $${params.length}`;
    }

    if (active !== undefined) {
      params.push(active === 'true');
      sql += ` AND is_active = $${params.length}`;
    }

    sql += ' ORDER BY date ASC';

    const result = await query(sql, params);

    res.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        date: row.date,
        name: row.name,
        country: row.country,
        type: row.type,
        isPaid: row.is_paid,
        isActive: row.is_active
      }))
    });
  } catch (error) {
    next(error);
  }
};

exports.createHoliday = async (req, res, next) => {
  try {
    const { date, name, country = 'PE', type = 'national', isPaid = true, isActive = true } = req.body;

    if (!date || !name) {
      return res.status(400).json({ success: false, message: 'date and name are required' });
    }

    const id = uuidv4();
    await query(`
      INSERT INTO holidays (id, date, name, country, type, is_paid, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, date, name, country, type, isPaid, isActive]);

    res.json({
      success: true,
      data: { id, date, name, country, type, isPaid, isActive }
    });
  } catch (error) {
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ success: false, message: 'A holiday with this date already exists for this country' });
    }
    next(error);
  }
};

exports.updateHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date, name, country, type, isPaid, isActive } = req.body;

    const current = await query('SELECT * FROM holidays WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }

    const setFields = [];
    const params = [];
    let paramIndex = 1;

    const addField = (colName, val) => {
      if (val !== undefined) {
        params.push(val);
        setFields.push(`${colName} = $${paramIndex}`);
        paramIndex++;
      }
    };

    addField('date', date);
    addField('name', name);
    addField('country', country);
    addField('type', type);
    addField('is_paid', isPaid);
    addField('is_active', isActive);

    if (setFields.length === 0) {
      return res.json({ success: true, message: 'No fields to update' });
    }

    params.push(id);
    const sql = `UPDATE holidays SET ${setFields.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`;
    
    const result = await query(sql, params);

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ success: false, message: 'A holiday with this date already exists for this country' });
    }
    next(error);
  }
};

exports.deleteHoliday = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const result = await query(`
      UPDATE holidays SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }

    res.json({
      success: true,
      message: 'Holiday successfully deactivated'
    });
  } catch (error) {
    next(error);
  }
};
