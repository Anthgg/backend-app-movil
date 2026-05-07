const requestService = require('../services/request.service');
const vacationService = require('../services/vacation.service');
const { getWorkerIdFromUserId } = require('../../attendance-service/services/utils.service');
const { logAudit } = require('../../../shared/utils/audit');

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
        const workerId = await getWorkerIdFromUserId(userId, tenantId);

        const newRequest = await requestService.createRequest({ ...req.body, workerId, tenantId });

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'CREATE',
            entity: 'employee_requests', entityId: newRequest.id, newData: req.body, req
        });

        res.status(201).json({ success: true, data: newRequest });
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

        const updatedRequest = await requestService.cancelRequest(id, workerId, tenantId);

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'CANCEL',
            entity: 'employee_requests', entityId: id, req
        });

        res.json({ success: true, data: updatedRequest });
    } catch (error) {
        next(error);
    }
};

exports.approveRequest = handleRequestAction('APPROVE', requestService.approveRequest.bind(requestService));
exports.rejectRequest = handleRequestAction('REJECT', requestService.rejectRequest.bind(requestService));
exports.observeRequest = handleRequestAction('OBSERVE', requestService.observeRequest.bind(requestService));

exports.resubmitRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const workerId = await getWorkerIdFromUserId(userId, tenantId);

        const updatedRequest = await requestService.resubmitRequest(id, workerId, tenantId, req.body);

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'RESUBMIT',
            entity: 'employee_requests', entityId: id, newData: req.body, req
        });

        res.json({ success: true, data: updatedRequest });
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

        await logAudit({
            userId, companyId: tenantId, module: 'REQUESTS', action: 'UPDATE',
            entity: 'employee_requests', entityId: id, newData: data, req
        });

        res.json({ success: true, data: updatedRequest });
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
