const service = require('../services/payroll.service');
const { logAudit } = require('../../../shared/utils/audit');

exports.createPeriod = async (req, res, next) => {
  try {
    const data = await service.createPeriod(req.tenantId, req.body, req.user);
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'PAYROLL', action: 'CREATE_PERIOD', entity: 'payroll_periods', entityId: data.id, req });
    res.json({ success: true, message: 'Periodo de planilla creado', data });
  } catch (error) { next(error); }
};

exports.getPeriods = async (req, res, next) => {
  try {
    const data = await service.getPeriods(req.tenantId);
    res.json({ success: true, data });
  } catch (error) { next(error); }
};

exports.generatePayroll = async (req, res, next) => {
  try {
    const data = await service.generatePayroll(req.tenantId, req.params.id, req.user);
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'PAYROLL', action: 'GENERATE', entity: 'payroll_periods', entityId: req.params.id, req });
    res.json({ success: true, message: 'Planilla generada', data });
  } catch (error) { next(error); }
};

exports.recalculatePayroll = async (req, res, next) => {
  try {
    const data = await service.recalculatePayroll(req.tenantId, req.params.id, req.user);
    await logAudit({ userId: req.user.id, companyId: req.tenantId, module: 'PAYROLL', action: 'RECALCULATE', entity: 'payroll_periods', entityId: req.params.id, req });
    res.json({ success: true, message: 'Planilla recalculada', data });
  } catch (error) { next(error); }
};

exports.approvePeriod = async (req, res, next) => {
  try {
    const data = await service.updatePeriodStatus(req.tenantId, req.params.id, 'approved', req.user);
    res.json({ success: true, message: 'Planilla aprobada', data });
  } catch (error) { next(error); }
};

exports.closePeriod = async (req, res, next) => {
  try {
    const data = await service.updatePeriodStatus(req.tenantId, req.params.id, 'closed', req.user);
    res.json({ success: true, message: 'Planilla cerrada', data });
  } catch (error) { next(error); }
};

exports.exportExcel = async (req, res, next) => {
  try {
    const buffer = await service.exportExcel(req.tenantId, req.params.id);
    res.setHeader('Content-Disposition', 'attachment; filename=Planilla_Estimada.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) { next(error); }
};
