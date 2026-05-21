const contractService = require('./services');

exports.generateContract = async (req, res, next) => {
  try {
    const contractId = req.body.contract_id || req.body.contractId;
    if (!contractId) {
      return res.status(400).json({
        success: false,
        message: 'contract_id es obligatorio.',
        code: 'CONTRACT_ID_REQUIRED',
        errors: [{ field: 'contract_id', message: 'El contrato es obligatorio.' }]
      });
    }

    const data = await contractService.generateContractPdf({
      companyId: req.tenantId,
      contractId,
      requestedBy: req.user.id,
      req
    });

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
};

exports.uploadSignedContract = async (req, res, next) => {
  try {
    const workerId = req.params.workerId;
    const contractId = req.body.contract_id || req.body.contractId;

    if (!contractId) {
      return res.status(400).json({
        success: false,
        message: 'contract_id es obligatorio.',
        code: 'CONTRACT_ID_REQUIRED',
        errors: [{ field: 'contract_id', message: 'El contrato es obligatorio.' }]
      });
    }

    const data = await contractService.uploadSignedContract({
      workerId,
      companyId: req.tenantId,
      contractId,
      file: req.file,
      signedAt: req.body.signed_at || req.body.signedAt,
      observations: req.body.observations,
      uploadedBy: req.user.id,
      req
    });

    res.json({
      success: true,
      message: 'Contrato firmado subido correctamente.',
      data
    });
  } catch (error) {
    next(error);
  }
};
