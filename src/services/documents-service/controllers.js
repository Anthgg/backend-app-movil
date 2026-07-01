const documentsService = require('./service');
const { getWorkerIdFromUserId } = require('../attendance-service/services/utils.service');
const { logAudit } = require('../../shared/utils/audit');

function getUploadedFiles(req) {
  if (Array.isArray(req.files)) {
    return req.files;
  }

  if (req.file) {
    return [req.file];
  }

  if (req.files && typeof req.files === 'object') {
    return Object.values(req.files).flat().filter(Boolean);
  }

  return [];
}

async function resolveAuthenticatedWorkerId(req) {
  const userId = req.user.id;
  const tenantId = req.tenantId;

  if (req.user.worker_id) {
    return req.user.worker_id;
  }

  try {
    return await getWorkerIdFromUserId(userId, tenantId);
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

exports.getMyDocuments = async (req, res, next) => {
  try {
    const workerId = await resolveAuthenticatedWorkerId(req);

    if (!workerId) {
      return res.json({
        success: true,
        data: {
          documents: []
        }
      });
    }

    const documents = await documentsService.getMyDocuments(workerId, req.tenantId, req.query);

    res.json({
      success: true,
      data: {
        documents
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.uploadMyDocuments = async (req, res, next) => {
  try {
    const workerId = await resolveAuthenticatedWorkerId(req);
    if (!workerId) {
      return res.status(404).json({
        success: false,
        message: 'Trabajador autenticado no encontrado.',
        errorCode: 'WORKER_NOT_FOUND',
        error_code: 'WORKER_NOT_FOUND'
      });
    }

    const files = getUploadedFiles(req);
    const documents = await documentsService.uploadDocuments({
      files,
      body: req.body || {},
      workerId,
      companyId: req.tenantId,
      uploadedBy: req.user.id
    });

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'DOCUMENTS',
      action: 'WORKER_UPLOAD_OWN_DOCUMENT',
      entity: 'worker_documents',
      entityId: workerId,
      newData: {
        workerId,
        filesCount: documents.length,
        documentTypes: documents.map((document) => document.type)
      },
      req
    });

    res.status(201).json({
      success: true,
      message: `${documents.length} documento(s) subido(s) correctamente.`,
      data: {
        documents,
        document: documents[0] || null
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteMyDocument = async (req, res, next) => {
  try {
    const workerId = await resolveAuthenticatedWorkerId(req);
    if (!workerId) {
      return res.status(404).json({
        success: false,
        message: 'Trabajador autenticado no encontrado.',
        errorCode: 'WORKER_NOT_FOUND',
        error_code: 'WORKER_NOT_FOUND'
      });
    }

    const result = await documentsService.deleteDocument({
      documentId: req.params.documentId || req.params.id,
      companyId: req.tenantId,
      deletedBy: req.user.id,
      reason: req.body?.reason || req.body?.deleteReason || req.body?.delete_reason || null,
      workerId
    });

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'DOCUMENTS',
      action: 'WORKER_DELETE_OWN_DOCUMENT',
      entity: 'worker_documents',
      entityId: req.params.documentId || req.params.id,
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

exports.getCompanyDocuments = async (req, res, next) => {
  try {
    const result = await documentsService.getCompanyDocuments(req.tenantId, req.query);

    res.json({
      items: result.documents,
      total: result.pagination.total,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize
    });
  } catch (error) {
    next(error);
  }
};

exports.getDocumentDetail = async (req, res, next) => {
  try {
    const document = await documentsService.getDocumentById(req.params.documentId || req.params.id, req.tenantId);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: 'Documento no encontrado.',
        errorCode: 'DOCUMENT_NOT_FOUND',
        error_code: 'DOCUMENT_NOT_FOUND'
      });
    }

    res.json(document);
  } catch (error) {
    next(error);
  }
};

exports.getWorkerDocuments = async (req, res, next) => {
  try {
    const workerId = req.params.workerId || req.params.id;
    const documents = await documentsService.getWorkerDocuments(workerId, req.tenantId, req.query);

    res.json({
      success: true,
      data: {
        documents,
        items: documents
      },
      items: documents
    });
  } catch (error) {
    next(error);
  }
};

exports.uploadWorkerDocuments = async (req, res, next) => {
  try {
    const workerId = req.params.workerId || req.params.id;
    const document = await documentsService.uploadDocument({
      file: req.file,
      body: req.body || {},
      workerId,
      companyId: req.tenantId,
      uploadedBy: req.user.id
    });

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'DOCUMENTS',
      action: 'UPLOAD_WORKER_DOCUMENT',
      entity: 'worker_documents',
      entityId: workerId,
      newData: {
        workerId,
        documentId: document.id,
        documentType: document.type
      },
      req
    });

    res.status(201).json(document);
  } catch (error) {
    next(error);
  }
};

exports.reviewDocument = async (req, res, next) => {
  try {
    const document = await documentsService.reviewDocument({
      documentId: req.params.documentId || req.params.id,
      companyId: req.tenantId,
      status: req.body?.status,
      reviewComment: req.body?.reviewComment || req.body?.review_comment || req.body?.comment || null,
      reviewedBy: req.user.id
    });

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'DOCUMENTS',
      action: 'REVIEW_WORKER_DOCUMENT',
      entity: 'worker_documents',
      entityId: document.id,
      newData: {
        status: document.status,
        reviewComment: document.reviewComment
      },
      req
    });

    res.json(document);
  } catch (error) {
    next(error);
  }
};

exports.deleteDocument = async (req, res, next) => {
  try {
    await documentsService.deleteDocument({
      documentId: req.params.documentId || req.params.id,
      companyId: req.tenantId,
      deletedBy: req.user.id,
      reason: req.body?.reason || req.body?.deleteReason || req.body?.delete_reason || null
    });

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'DOCUMENTS',
      action: 'DELETE_WORKER_DOCUMENT',
      entity: 'worker_documents',
      entityId: req.params.documentId || req.params.id,
      req
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

exports.getDocumentTypes = async (req, res, next) => {
  try {
    const types = await documentsService.getDocumentTypes(req.tenantId);
    const catalog = types.map((type) => ({
      type,
      documentType: type,
      document_type: type,
      label: type.replace(/_/g, ' '),
      usageCount: 0,
      usage_count: 0
    }));
    res.json({
      success: true,
      data: {
        types: catalog,
        documentTypes: catalog,
        document_types: catalog
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getAdminDocumentTypes = async (req, res, next) => {
  try {
    const types = await documentsService.getDocumentTypes(req.tenantId);
    res.json(types);
  } catch (error) {
    next(error);
  }
};
