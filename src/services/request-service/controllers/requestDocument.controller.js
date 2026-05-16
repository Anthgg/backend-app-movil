const requestDocumentService = require('../services/requestDocument.service');
const requestService = require('../services/request.service');
const { getWorkerIdFromUserId } = require('../../attendance-service/services/utils.service');
const { logAudit } = require('../../../shared/utils/audit');

/**
 * POST /requests/:id/documents
 * Sube uno o varios documentos a una solicitud.
 * Body: multipart/form-data con campo "documents" (array de archivos)
 */
exports.uploadDocuments = async (req, res, next) => {
    try {
        const { id: requestId } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;
        const documentType = req.body?.documentType || req.body?.document_type || null;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Debes adjuntar al menos un archivo.',
                errorCode: 'NO_FILES_ATTACHED'
            });
        }

        // Verificar que la solicitud existe y el usuario tiene acceso
        const request = await requestService.getRequestById(requestId, tenantId);
        const workerId = await getWorkerIdFromUserId(userId, tenantId).catch(() => null);

        const canAccess =
            req.user.roles?.includes('ADMIN') ||
            req.user.permissions?.includes('requests.read_company') ||
            request.worker_id === workerId;

        if (!canAccess) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para agregar documentos a esta solicitud.',
                errorCode: 'REQUEST_FORBIDDEN'
            });
        }

        const documents = await requestDocumentService.uploadMultipleDocuments({
            files: req.files,
            requestId,
            companyId: tenantId,
            uploadedBy: userId,
            documentType
        });

        await logAudit({
            userId,
            companyId: tenantId,
            module: 'REQUESTS',
            action: 'UPLOAD_DOCUMENTS',
            entity: 'request_documents',
            entityId: requestId,
            newData: { filesCount: documents.length, fileNames: req.files.map(f => f.originalname) },
            req
        });

        res.status(201).json({
            success: true,
            message: `${documents.length} documento(s) subido(s) correctamente.`,
            data: { documents }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /requests/:id/documents
 * Lista todos los documentos de una solicitud.
 */
exports.getDocuments = async (req, res, next) => {
    try {
        const { id: requestId } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;

        // Verificar acceso
        const request = await requestService.getRequestById(requestId, tenantId);
        const workerId = await getWorkerIdFromUserId(userId, tenantId).catch(() => null);

        const canAccess =
            req.user.roles?.includes('ADMIN') ||
            req.user.permissions?.includes('requests.read_company') ||
            request.worker_id === workerId;

        if (!canAccess) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para ver los documentos de esta solicitud.',
                errorCode: 'REQUEST_FORBIDDEN'
            });
        }

        const documents = await requestDocumentService.getDocumentsByRequestId(requestId, tenantId);

        res.json({
            success: true,
            data: { documents }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /requests/:id/documents/:docId
 * Elimina un documento de una solicitud.
 */
exports.deleteDocument = async (req, res, next) => {
    try {
        const { id: requestId, docId } = req.params;
        const userId = req.user.id;
        const tenantId = req.tenantId;

        // Verificar acceso
        const request = await requestService.getRequestById(requestId, tenantId);
        const workerId = await getWorkerIdFromUserId(userId, tenantId).catch(() => null);

        // Solo el dueño o admin puede eliminar
        const canDelete =
            req.user.roles?.includes('ADMIN') ||
            request.worker_id === workerId;

        if (!canDelete) {
            return res.status(403).json({
                success: false,
                message: 'No tienes permiso para eliminar este documento.',
                errorCode: 'REQUEST_FORBIDDEN'
            });
        }

        // Solo permitir eliminar docs si la solicitud está en estado editable
        const editableStatuses = ['pending', 'observed', 'draft'];
        if (!editableStatuses.includes(request.status) && !req.user.roles?.includes('ADMIN')) {
            return res.status(422).json({
                success: false,
                message: `No puedes eliminar documentos de una solicitud en estado ${request.status}.`,
                errorCode: 'REQUEST_NOT_EDITABLE'
            });
        }

        const result = await requestDocumentService.deleteDocument(docId, requestId, tenantId, userId);

        await logAudit({
            userId,
            companyId: tenantId,
            module: 'REQUESTS',
            action: 'DELETE_DOCUMENT',
            entity: 'request_documents',
            entityId: docId,
            req
        });

        res.json({
            success: true,
            message: 'Documento eliminado correctamente.',
            data: result
        });
    } catch (error) {
        next(error);
    }
};
