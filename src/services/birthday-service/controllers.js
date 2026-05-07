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
