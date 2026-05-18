const reportTemplateService = require('../services/reportTemplate.service');
const { logAudit } = require('../../../shared/utils/audit');

exports.createTemplate = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    
    const template = await reportTemplateService.createTemplate(req.body, tenantId, userId, req.user);
    
    await logAudit({
      userId,
      companyId: tenantId,
      module: 'REPORTS',
      action: 'CREATE_REPORT_TEMPLATE',
      entity: 'report_templates',
      entityId: template.id,
      newData: req.body,
      req
    });

    res.status(201).json({
      success: true,
      message: 'Plantilla de reporte creada exitosamente.',
      data: template
    });
  } catch (error) {
    next(error);
  }
};

exports.getTemplates = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const { module } = req.query;
    
    const templates = await reportTemplateService.getTemplates(module, tenantId, req.user);
    
    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    next(error);
  }
};

exports.getTemplateById = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const { id } = req.params;
    
    const template = await reportTemplateService.getTemplateById(id, tenantId, req.user);
    
    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const { id } = req.params;
    
    const template = await reportTemplateService.updateTemplate(id, tenantId, req.user, req.body);
    
    await logAudit({
      userId,
      companyId: tenantId,
      module: 'REPORTS',
      action: 'UPDATE_REPORT_TEMPLATE',
      entity: 'report_templates',
      entityId: id,
      newData: req.body,
      req
    });

    res.json({
      success: true,
      message: 'Plantilla de reporte actualizada exitosamente.',
      data: template
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteTemplate = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const userId = req.user.id;
    const { id } = req.params;
    
    const result = await reportTemplateService.deleteTemplate(id, tenantId, req.user);
    
    await logAudit({
      userId,
      companyId: tenantId,
      module: 'REPORTS',
      action: 'DELETE_REPORT_TEMPLATE',
      entity: 'report_templates',
      entityId: id,
      req
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
};
