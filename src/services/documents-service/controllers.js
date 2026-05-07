const documentsService = require('./service');
const { getWorkerIdFromUserId } = require('../attendance-service/services/utils.service');

exports.getMyDocuments = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const tenantId = req.tenantId;

    let workerId;
    try {
      workerId = await getWorkerIdFromUserId(userId, tenantId);
    } catch (error) {
      if (error.statusCode === 404) {
        return res.json({
          success: true,
          data: {
            documents: []
          }
        });
      }

      throw error;
    }

    const documents = await documentsService.getMyDocuments(workerId, tenantId);

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
