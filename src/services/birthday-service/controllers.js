const birthdayService = require('./service');

exports.getToday = async (req, res, next) => {
  try {
    const birthdays = await birthdayService.getTodayBirthdays(req.tenantId);
    res.json({ success: true, data: birthdays });
  } catch (error) {
    next(error);
  }
};

exports.getUpcoming = async (req, res, next) => {
  try {
    const birthdays = await birthdayService.getUpcomingBirthdays(req.tenantId);
    res.json({ success: true, data: birthdays });
  } catch (error) {
    next(error);
  }
};

exports.getMonth = async (req, res, next) => {
  try {
    const month = req.query.month ? parseInt(req.query.month, 10) : null;
    if (month !== null && (Number.isNaN(month) || month < 1 || month > 12)) {
      return res.status(400).json({ success: false, message: 'Mes invalido.', error_code: 'INVALID_MONTH' });
    }

    const birthdays = await birthdayService.getMonthBirthdays(req.tenantId, month);
    res.json({ success: true, data: birthdays });
  } catch (error) {
    next(error);
  }
};

exports.getAll = async (req, res, next) => {
  try {
    const birthdays = await birthdayService.getAllBirthdays(req.tenantId);
    res.json({ success: true, data: { birthdays } });
  } catch (error) {
    next(error);
  }
};

exports.sendGreeting = async (req, res, next) => {
  try {
    const senderId = req.user.id;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Se requiere targetUserId.' });
    }

    const result = await birthdayService.sendGreeting(senderId, targetUserId, req.tenantId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
