const { query } = require('../../config/database');

exports.getMyNotifications = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;
    const limit = Math.max(parseInt(req.query.limit, 10) || 50, 1);

    const result = await query(`
      SELECT id, type, title, message, created_at, is_read
      FROM notifications
      WHERE user_id = $1
        AND company_id = $2
      ORDER BY created_at DESC
      LIMIT $3
    `, [userId, tenantId, limit]);

    const notifications = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      createdAt: row.created_at,
      readAt: row.is_read ? row.created_at : null
    }));

    res.json({
      success: true,
      data: {
        notifications
      }
    });
  } catch (error) {
    next(error);
  }
};
