const homeService = require('./service');

exports.getSummary = async (req, res, next) => {
  try {
    const summary = await homeService.getSummary(req.user.id, req.tenantId, req.user.roles);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
};
