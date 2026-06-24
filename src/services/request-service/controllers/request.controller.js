const requestService = require('../services/request.service');
const vacationService = require('../services/vacation.service');
const requestReportService = require('../services/requestReport.service');
const requestTemplateService = require('../services/requestTemplate.service');
const requestDocumentService = require('../services/requestDocument.service');
const { getWorkerIdFromUserId } = require('../../attendance-service/services/utils.service');
const { logAudit } = require('../../../shared/utils/audit');
const { createNotificationsForUsers, getCompanyNotificationRecipients } = require('../../../shared/utils/notifications');

const handleRequestAction = (action, serviceMethod) => async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        const approverId = req.user.id;
        const tenantId = req.tenantId;

        const updatedRequest = await serviceMethod(id, tenantId, approverId, reason);

        await logAudit({
            userId: approverId, companyId: tenantId, module: 'REQUESTS', action,
            entity: 'employee_requests', entityId: id, newData: { status: updatedRequest.status, reason }, req
        });

        res.json({ success: true, data: updatedRequest });
    } catch (error) {
        next(error);
    }
};

exports.createRequest = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const tenantId = req.tenantId;
        let workerId;
        try {
            workerId = await getWorkerIdFromUserId(userId, tenantId);
        } catch (error) {
            if (error.statusCode === 404) {
                error.statusCode = 403;
                error.message = 'No tienes un perfil de trabajador activo asociado.';
                error.errorCode = 'WORKER_PROFILE_REQUIRED';
            }
            throw error;
        }

        const payload = {
            ...req.body,
            request_type_id: req.body.requestTypeId || req.body.request_type_id,
            start_date: req.body.startDate || req.body.start_date,
            end_date: req.body.endDate || req.body.end_date,
            reason: req.body.reason
        };

        const newRequest = await requestService.createRequest({ ...payload, workerId, tenantId });

        // Si se subieron archivos junto con la solicitud (multipart/form-data)
        let uploadedDocuments = [];
        if (req.files && req.files.length > 0) {
            uploadedDocuments = await requestDocumentService.uploadMultipleDocuments({
                files: req.files,
                requestId: newRequest.id,
                companyId: tenantId,
                uploadedBy: userId,
                documentType: req.body.documentType || req.body.document_type || null
            });
        }

        let generatedDocument = null;
        let documentGenerationWarning = null;
        const shouldGenerateDocument = req.body.generateDocument !== false
            && req.body.generate_document !== false
            && req.body.generateDocument !== 'false'
            && req.body.generate_document !== 'false';

        if (shouldGenerateDocument) {
            try {
                generatedDocument = await requestDocumentService.generateRequestDocument({
                    requestId: newRequest.id,
                    companyId: tenantId,
                    generatedBy: userId,
                    req
                });
            } catch (error) {
                documentGenerationWarning = {
                    code: error.errorCode || error.code || 'REQUEST_DOCUMENT_GENERATION_FAILED',
                    message: error.message || 'No se pudo generar el documento de la solicitud.'
                };
            }
        }

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'CREATE',
            entity: 'employee_requests', entityId: newRequest.id, newData: payload, req
        });

        const finalRequest = await requestService.getRequestById(newRequest.id, tenantId);

        res.status(201).json({
            success: true,
            data: {
                ...newRequest, // Backward compatibility flat fields
                request: requestService.serializeRequest(finalRequest),
                documents: finalRequest.documents,
                attachments: finalRequest.attachments,
                generatedDocument,
                documentGenerationWarning
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getMyRequests = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const tenantId = req.tenantId;
        
        let workerId;
        try {
            workerId = await getWorkerIdFromUserId(userId, tenantId);
        } catch (error) {
            // Si es ADMIN y no tiene perfil de trabajador, devolvemos lista vacía en lugar de error 404
            if (req.user.roles.includes('ADMIN')) {
                return res.json({ 
                    success: true, 
                    data: { 
                        requests: [],
                        pagination: { total: 0, page: 1, limit: 10, totalPages: 0 }
                    } 
                });
            }
            throw error;
        }

        const filters = { ...req.query, workerId };
        const result = await requestService.getRequests(filters, tenantId);
        
        // Attach documents without N+1
        const requestsWithDocs = await requestService.attachRequestDocuments(result.data, tenantId);
        
        res.json({ 
            success: true, 
            data: { 
                requests: requestsWithDocs,
                pagination: result.pagination
            } 
        });
    } catch (error) {
        next(error);
    }
};

exports.getRequestTypes = async (req, res, next) => {
    try {
        const requestTypes = await requestService.getActiveRequestTypes(req.tenantId);

        res.json({
            success: true,
            data: {
                requestTypes
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getCompanyRequests = async (req, res, next) => {
    try {
        const result = await requestService.getRequests(req.query, req.tenantId);
        res.json({ 
            success: true, 
            data: { 
                requests: result.data,
                pagination: result.pagination
            } 
        });
    } catch (error) {
        next(error);
    }
};

exports.getPendingRequests = async (req, res, next) => {
    try {
        const filters = { ...req.query, status: 'pending' };
        const result = await requestService.getRequests(filters, req.tenantId);
        res.json({ 
            success: true, 
            data: { 
                requests: result.data,
                pagination: result.pagination
            } 
        });
    } catch (error) {
        next(error);
    }
};

exports.getRequestById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const workerId = await getWorkerIdFromUserId(userId, tenantId).catch(() => null);

        const request = await requestService.getRequestById(id, tenantId);

        const canReadAll =
            req.user.roles?.includes('ADMIN') ||
            req.user.permissions?.includes('requests.read_all') ||
            req.user.permissions?.includes('requests.read_company');

        if (!canReadAll && request.worker_id !== workerId) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para ver esta solicitud.' });
        }

        res.json({ success: true, data: { request } });
    } catch (error) {
        next(error);
    }
};

exports.cancelRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const workerId = await getWorkerIdFromUserId(userId, tenantId);

        const updatedRequest = await requestService.cancelRequest(id, workerId, userId, tenantId);

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'CANCEL',
            entity: 'employee_requests', entityId: id, req
        });

        res.json({
            success: true,
            message: 'Solicitud cancelada correctamente',
            data: {
                request: {
                    id: updatedRequest.id,
                    status: updatedRequest.status
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.approveRequest = handleRequestAction('APPROVE', requestService.approveRequest.bind(requestService));
exports.rejectRequest = handleRequestAction('REJECT', requestService.rejectRequest.bind(requestService));
exports.observeRequest = handleRequestAction('OBSERVE', requestService.observeRequest.bind(requestService));
exports.reviewRequest = async (req, res, next) => {
    try {
        const action = String(req.body?.action || '').toLowerCase();

        if (action === 'approve') {
            return exports.approveRequest(req, res, next);
        }

        if (action === 'reject') {
            return exports.rejectRequest(req, res, next);
        }

        if (action === 'observe') {
            return exports.observeRequest(req, res, next);
        }

        return res.status(400).json({
            success: false,
            message: 'El campo action debe ser approve, reject u observe.',
            error_code: 'INVALID_REVIEW_ACTION'
        });
    } catch (error) {
        next(error);
    }
};

exports.resubmitRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const workerId = await getWorkerIdFromUserId(userId, tenantId);

        const updatedRequest = await requestService.resubmitRequest(id, workerId, tenantId, req.body);

        let uploadedDocuments = [];
        if (req.files && req.files.length > 0) {
            const requestDocumentService = require('../services/requestDocument.service');
            uploadedDocuments = await requestDocumentService.uploadMultipleDocuments({
                files: req.files,
                requestId: id,
                companyId: tenantId,
                uploadedBy: userId,
                documentType: req.body.documentType || req.body.document_type || null
            });
        }

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'RESUBMIT',
            entity: 'employee_requests', entityId: id, newData: req.body, req
        });

        const recipients = await getCompanyNotificationRecipients(tenantId);
        await createNotificationsForUsers(
            recipients,
            tenantId,
            'Solicitud reenviada',
            'Un trabajador reenviò una solicitud observada.',
            'request_resubmitted'
        );

        const finalRequest = await requestService.getRequestById(id, tenantId);

        res.json({ 
            success: true, 
            data: {
                ...updatedRequest,
                request: requestService.serializeRequest(finalRequest),
                documents: finalRequest.documents,
                attachments: finalRequest.attachments
            } 
        });
    } catch (error) {
        next(error);
    }
};

exports.updateRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const workerId = await getWorkerIdFromUserId(userId, tenantId);

        // Mapeo de camelCase (Flutter) a snake_case (Backend)
        const data = {
            ...req.body,
            start_date: req.body.startDate || req.body.start_date,
            end_date: req.body.endDate || req.body.end_date,
            request_type_id: req.body.requestTypeId || req.body.request_type_id
        };

        const updatedRequest = await requestService.updateRequest(id, workerId, tenantId, data);

        let uploadedDocuments = [];
        if (req.files && req.files.length > 0) {
            const requestDocumentService = require('../services/requestDocument.service');
            uploadedDocuments = await requestDocumentService.uploadMultipleDocuments({
                files: req.files,
                requestId: id,
                companyId: tenantId,
                uploadedBy: userId,
                documentType: req.body.documentType || req.body.document_type || null
            });
        }

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'UPDATE',
            entity: 'employee_requests', entityId: id, newData: data, req
        });

        const finalRequest = await requestService.getRequestById(id, tenantId);

        res.json({ 
            success: true, 
            data: {
                ...updatedRequest,
                request: requestService.serializeRequest(finalRequest),
                documents: finalRequest.documents,
                attachments: finalRequest.attachments
            } 
        });
    } catch (error) {
        next(error);
    }
};

exports.getMyVacationBalance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const tenantId = req.tenantId;
        
        let workerId;
        try {
            workerId = await getWorkerIdFromUserId(userId, tenantId);
        } catch (error) {
            if (req.user.role === 'ADMIN') {
                return res.json({ 
                    success: true, 
                    data: { 
                        totalAccumulated: 0,
                        totalUsed: 0,
                        totalPending: 0,
                        availableDays: 0,
                        lastUpdated: new Date()
                    } 
                });
            }
            throw error;
        }

        const balance = await vacationService.getVacationBalance(workerId, tenantId);
        res.json({ success: true, data: balance });
    } catch (error) {
        next(error);
    }
};

exports.getWorkerVacationBalance = async (req, res, next) => {
    try {
        const { workerId } = req.params;
        const tenantId = req.tenantId;

        const balance = await vacationService.getVacationBalance(workerId, tenantId);
        res.json({ success: true, data: balance });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// REPORTS CONTROLLERS
// ==========================================

exports.getRequestsReport = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const result = await requestService.getRequests(req.query, tenantId);
        res.json({
            success: true,
            data: result.data,
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

exports.exportRequestsExcel = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const buffer = await requestReportService.generateExcel(req.query, tenantId, req.user);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-reporte.xlsx"');
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

exports.exportRequestsPdf = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const buffer = await requestReportService.generatePdf(req.query, tenantId, req.user);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-reporte.pdf"');
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

exports.exportRequestsCsv = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const buffer = await requestReportService.generateCsv(req.query, tenantId, req.user);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-reporte.csv"');
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

exports.getAvailableReportColumns = async (req, res, next) => {
    try {
        const columns = requestReportService.getAvailableColumns();
        res.json({
            success: true,
            data: columns
        });
    } catch (error) {
        next(error);
    }
};

// ==========================================
// TEMPLATES CONTROLLERS
// ==========================================

exports.listTemplates = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const includeInactive = req.user?.roles?.includes('ADMIN') || req.user?.roles?.includes('RRHH');
        const templates = await requestTemplateService.listTemplates(tenantId, includeInactive);
        
        res.json({
            success: true,
            data: templates
        });
    } catch (error) {
        next(error);
    }
};

exports.downloadTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;
        const template = await requestTemplateService.getTemplateById(id, tenantId);
        
        // Redirigir a la URL pública del documento en el Storage
        res.redirect(template.file_url);
    } catch (error) {
        next(error);
    }
};

exports.createTemplate = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const userId = req.user.id;
        const { name, description } = req.body;
        
        const file = req.file;
        const newTemplate = await requestTemplateService.createTemplate({
            file,
            name,
            description,
            companyId: tenantId,
            userId
        });

        await logAudit({
            userId,
            companyId: tenantId,
            module: 'REQUESTS',
            action: 'CREATE_TEMPLATE',
            entity: 'request_templates',
            entityId: newTemplate.id,
            newData: { name },
            req
        });

        res.status(201).json({
            success: true,
            message: 'Plantilla de solicitud creada exitosamente.',
            data: newTemplate
        });
    } catch (error) {
        next(error);
    }
};

exports.updateTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;
        const userId = req.user.id;
        const { name, description, is_active } = req.body;
        
        const file = req.file;
        const updated = await requestTemplateService.updateTemplate(id, tenantId, {
            file,
            name,
            description,
            is_active: is_active === 'true' || is_active === true ? true : (is_active === 'false' || is_active === false ? false : undefined),
            userId
        });

        await logAudit({
            userId,
            companyId: tenantId,
            module: 'REQUESTS',
            action: 'UPDATE_TEMPLATE',
            entity: 'request_templates',
            entityId: id,
            newData: { name, is_active },
            req
        });

        res.json({
            success: true,
            message: 'Plantilla de solicitud actualizada exitosamente.',
            data: updated
        });
    } catch (error) {
        next(error);
    }
};

exports.deactivateTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const tenantId = req.tenantId;
        const userId = req.user.id;

        const deactivated = await requestTemplateService.deactivateTemplate(id, tenantId, userId);

        await logAudit({
            userId,
            companyId: tenantId,
            module: 'REQUESTS',
            action: 'DEACTIVATE_TEMPLATE',
            entity: 'request_templates',
            entityId: id,
            req
        });

        res.json({
            success: true,
            message: 'Plantilla de solicitud desactivada exitosamente.',
            data: deactivated
        });
    } catch (error) {
        next(error);
    }
};

exports.previewRequestsReport = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const result = await requestReportService.getReportData(req.body, tenantId, req.user);
        
        if (result.data.length === 0) {
            return res.json({
                success: true,
                data: [],
                total: 0,
                previewLimit: result.previewLimit || 20,
                selectedColumns: result.selectedColumns || [],
                message: 'No se encontraron registros de solicitudes con los filtros especificados.'
            });
        }

        res.json({
            success: true,
            data: result.data,
            total: result.total,
            previewLimit: result.previewLimit,
            selectedColumns: result.selectedColumns
        });
    } catch (error) {
        next(error);
    }
};

exports.exportRequestsExcelPost = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const buffer = await requestReportService.generateExcel(req.body, tenantId, req.user);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-reporte.xlsx"');
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

exports.exportRequestsPdfPost = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const buffer = await requestReportService.generatePdf(req.body, tenantId, req.user);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-reporte.pdf"');
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

exports.exportRequestsCsvPost = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const buffer = await requestReportService.generateCsv(req.body, tenantId, req.user);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="solicitudes-reporte.csv"');
        res.send(buffer);
    } catch (error) {
        next(error);
    }
};

exports.getRequestsCharts = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const chartData = await requestReportService.getChartsData(req.body, tenantId, req.user);
        res.json({
            success: true,
            data: chartData
        });
    } catch (error) {
        next(error);
    }
};

exports.getRequestsSummary = async (req, res, next) => {
    try {
        const tenantId = req.tenantId;
        const payload = req.method === 'POST' ? req.body : req.query;
        const summaryData = await requestReportService.getSummaryData(payload, tenantId, req.user);
        res.json({
            success: true,
            data: summaryData
        });
    } catch (error) {
        next(error);
    }
};
