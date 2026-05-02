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
        const workerId = await getWorkerIdFromUserId(userId, tenantId);
        const filters = { ...req.query, workerId };

        const result = await requestService.getRequests(filters, tenantId);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
};

exports.getAllRequests = async (req, res, next) => {
    try {
        const result = await requestService.getRequests(req.query, req.tenantId);
        res.json({ success: true, ...result });
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

        // El admin puede ver todo. El trabajador solo puede ver las suyas.
        if (!req.user.permissions.includes('requests.manage') && request.worker_id !== workerId) {
            return res.status(403).json({ success: false, message: 'No tienes permiso para ver esta solicitud.' });
        }

        res.json({ success: true, data: request });
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

exports.approveRequest = handleRequestAction('APPROVE', requestService.approveRequest);
exports.rejectRequest = handleRequestAction('REJECT', requestService.rejectRequest);

exports.getMyVacationBalance = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const workerId = await getWorkerIdFromUserId(userId, tenantId);

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
