const analyticsService = require('../services/analytics.service');

function send(res, data, meta = null) {
  return res.json({ success: true, data, ...(meta ? { meta } : {}) });
}

exports.getToday = async (req, res, next) => {
  try {
    send(res, await analyticsService.getToday(req.tenantId, req.query));
  } catch (error) {
    next(error);
  }
};

exports.getMonthly = async (req, res, next) => {
  try {
    send(res, await analyticsService.getMonthly(req.tenantId, req.query));
  } catch (error) {
    next(error);
  }
};

exports.getWorkers = async (req, res, next) => {
  try {
    const result = await analyticsService.getWorkers(req.tenantId, req.query);
    send(res, result.items, { period: result.period, filters: result.filters });
  } catch (error) {
    next(error);
  }
};

exports.getWorkerSummary = async (req, res, next) => {
  try {
    send(res, await analyticsService.getWorkerSummary(req.tenantId, req.params.workerId, req.query));
  } catch (error) {
    next(error);
  }
};

function groupingHandler(grouping) {
  return async (req, res, next) => {
    try {
      const result = await analyticsService.getGrouping(req.tenantId, req.query, grouping);
      send(res, result.items, { period: result.period, filters: result.filters });
    } catch (error) {
      next(error);
    }
  };
}

exports.getAreas = groupingHandler('areas');
exports.getDepartments = groupingHandler('departments');
exports.getWorkLocations = groupingHandler('workLocations');
exports.getCrews = groupingHandler('crews');

function trendHandler(interval) {
  return async (req, res, next) => {
    try {
      const result = await analyticsService.getTrend(req.tenantId, req.query, interval);
      send(res, result.items, { period: result.period, filters: result.filters });
    } catch (error) {
      next(error);
    }
  };
}

exports.getDailyTrend = trendHandler('daily');
exports.getWeeklyTrend = trendHandler('weekly');

exports.getKpis = async (req, res, next) => {
  try {
    send(res, await analyticsService.getKpis(req.tenantId, req.query));
  } catch (error) {
    next(error);
  }
};

exports.getDashboard = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, max-age=30');
    send(res, await analyticsService.getDashboard(req.tenantId, req.query));
  } catch (error) {
    next(error);
  }
};

exports.recalculate = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    send(res, await analyticsService.getDashboard(req.tenantId, { ...req.query, ...req.body }), {
      mode: 'live_recalculation',
      persisted: false
    });
  } catch (error) {
    next(error);
  }
};

function rankingHandler(key) {
  return async (req, res, next) => {
    try {
      const result = await analyticsService.getRankings(req.tenantId, req.query);
      send(res, result[key], { period: result.period, filters: result.filters });
    } catch (error) {
      next(error);
    }
  };
}

exports.getAbsenceRanking = rankingHandler('topAbsentWorkers');
exports.getLateRanking = rankingHandler('topLateWorkers');
exports.getBestAttendanceRanking = rankingHandler('bestAttendanceWorkers');
exports.getAreaAbsenceRanking = rankingHandler('topAbsentAreas');
exports.getAreaLateRanking = rankingHandler('topLateAreas');
exports.getWorkLocationAbsenceRanking = rankingHandler('topAbsentWorkLocations');
exports.getWorkLocationLateRanking = rankingHandler('topLateWorkLocations');
exports.getBestWorkLocationRanking = rankingHandler('bestAttendanceWorkLocations');
exports.getCrewAbsenceRanking = rankingHandler('topAbsentCrews');
exports.getCrewLateRanking = rankingHandler('topLateCrews');
exports.getBestCrewRanking = rankingHandler('bestAttendanceCrews');
