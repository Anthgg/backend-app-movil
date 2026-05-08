const documentsService = require('./service');
const { getWorkerIdFromUserId } = require('../attendance-service/services/utils.service');

exports.getMyDocuments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;
    const role = req.user.roles?.[0] || null;

    let workerId = req.user.worker_id || null;
    if (!workerId) {
      try {
        workerId = await getWorkerIdFromUserId(userId, tenantId);
      } catch (error) {
        if (error.statusCode !== 404) {
          throw error;
        }
      }
    }

    console.log('[documents/my] auth', {
      userId,
      workerId,
      companyId: tenantId,
      role
    });

    if (!workerId) {
      console.log('[documents/my] response', { count: 0 });
      return res.json({
        success: true,
        data: {
          documents: []
        }
      });
    }

    const documents = await documentsService.getMyDocuments(workerId, tenantId);

    console.log('[documents/my] response', {
      count: documents.length
    });

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

exports.getCompanyDocuments = async (req, res, next) => {
  try {
    const result = await documentsService.getCompanyDocuments(req.tenantId, req.query);

    res.json({
      success: true,
      data: {
        documents: result.documents,
        pagination: result.pagination
      }
    });
  } catch (error) {
    next(error);
  }
};
