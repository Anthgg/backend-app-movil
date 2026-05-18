const { query } = require('../../../config/database');

class ReportTemplateService {
  async createTemplate(data, tenantId, userId, user) {
    const { name, description, module, reportType, filters, columns, chartConfig, isDefault } = data;

    if (!name || !module || !reportType || !filters || !columns) {
      const err = new Error('Los campos name, module, reportType, filters y columns son obligatorios.');
      err.statusCode = 400;
      err.errorCode = 'VALIDATION_ERROR';
      throw err;
    }

    // Only ADMIN or RRHH can set a template as default
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');
    const finalIsDefault = isAdminOrHR ? (isDefault === true || isDefault === 'true') : false;

    const result = await query(`
      INSERT INTO report_templates (company_id, user_id, name, description, module, report_type, filters, columns, chart_config, is_default)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      tenantId,
      userId,
      name,
      description || null,
      module,
      reportType,
      typeof filters === 'string' ? filters : JSON.stringify(filters),
      typeof columns === 'string' ? columns : JSON.stringify(columns),
      chartConfig ? (typeof chartConfig === 'string' ? chartConfig : JSON.stringify(chartConfig)) : null,
      finalIsDefault
    ]);

    return result.rows[0];
  }

  async getTemplates(module, tenantId, user) {
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');
    
    let sql = '';
    let params = [];

    if (isAdminOrHR) {
      sql = `
        SELECT * FROM report_templates 
        WHERE company_id = $1 
          ${module ? 'AND module = $2' : ''} 
        ORDER BY is_default DESC, created_at DESC
      `;
      params = module ? [tenantId, module] : [tenantId];
    } else {
      sql = `
        SELECT * FROM report_templates 
        WHERE company_id = $1 
          AND (user_id = $2 OR is_default = true)
          ${module ? 'AND module = $3' : ''}
        ORDER BY is_default DESC, created_at DESC
      `;
      params = module ? [tenantId, user.id, module] : [tenantId, user.id];
    }

    const result = await query(sql, params);
    return result.rows;
  }

  async getTemplateById(id, tenantId, user) {
    const result = await query(`
      SELECT * FROM report_templates WHERE id = $1 AND company_id = $2
    `, [id, tenantId]);

    if (result.rows.length === 0) {
      const err = new Error('Plantilla de reporte no encontrada.');
      err.statusCode = 404;
      err.errorCode = 'TEMPLATE_NOT_FOUND';
      throw err;
    }

    const template = result.rows[0];
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');

    // Worker can only view their own templates or default ones
    if (!isAdminOrHR && template.user_id !== user.id && !template.is_default) {
      const err = new Error('No tienes permiso para ver esta plantilla de reporte.');
      err.statusCode = 403;
      err.errorCode = 'INSUFFICIENT_PERMISSIONS';
      throw err;
    }

    return template;
  }

  async updateTemplate(id, tenantId, user, data) {
    const template = await this.getTemplateById(id, tenantId, user);
    
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');

    // Worker can only edit their own templates
    if (!isAdminOrHR && template.user_id !== user.id) {
      const err = new Error('No tienes permiso para editar esta plantilla de reporte.');
      err.statusCode = 403;
      err.errorCode = 'INSUFFICIENT_PERMISSIONS';
      throw err;
    }

    const { name, description, filters, columns, chartConfig, isDefault } = data;

    const finalName = name !== undefined ? name : template.name;
    const finalDescription = description !== undefined ? description : template.description;
    const finalFilters = filters !== undefined 
      ? (typeof filters === 'string' ? filters : JSON.stringify(filters)) 
      : (typeof template.filters === 'string' ? template.filters : JSON.stringify(template.filters));

    const finalColumns = columns !== undefined 
      ? (typeof columns === 'string' ? columns : JSON.stringify(columns)) 
      : (typeof template.columns === 'string' ? template.columns : JSON.stringify(template.columns));

    const finalChartConfig = chartConfig !== undefined 
      ? (typeof chartConfig === 'string' ? chartConfig : JSON.stringify(chartConfig)) 
      : (template.chart_config ? (typeof template.chart_config === 'string' ? template.chart_config : JSON.stringify(template.chart_config)) : null);
    
    // Only admin/hr can toggle defaults
    const finalIsDefault = isAdminOrHR && isDefault !== undefined 
      ? (isDefault === true || isDefault === 'true') 
      : template.is_default;

    const result = await query(`
      UPDATE report_templates
      SET name = $1,
          description = $2,
          filters = $3,
          columns = $4,
          chart_config = $5,
          is_default = $6,
          updated_at = NOW()
      WHERE id = $7 AND company_id = $8
      RETURNING *
    `, [
      finalName,
      finalDescription,
      finalFilters,
      finalColumns,
      finalChartConfig,
      finalIsDefault,
      id,
      tenantId
    ]);

    return result.rows[0];
  }

  async deleteTemplate(id, tenantId, user) {
    const template = await this.getTemplateById(id, tenantId, user);
    
    const isAdminOrHR = user.roles?.includes('ADMIN') || user.roles?.includes('RRHH');

    // Worker can only delete their own templates
    if (!isAdminOrHR && template.user_id !== user.id) {
      const err = new Error('No tienes permiso para eliminar esta plantilla de reporte.');
      err.statusCode = 403;
      err.errorCode = 'INSUFFICIENT_PERMISSIONS';
      throw err;
    }

    await query('DELETE FROM report_templates WHERE id = $1 AND company_id = $2', [id, tenantId]);
    return { id, message: 'Plantilla eliminada exitosamente.' };
  }
}

module.exports = new ReportTemplateService();
