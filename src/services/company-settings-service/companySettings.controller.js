const companySettingsService = require('./companySettings.service');
const { validateCompanySettings } = require('./companySettings.validation');
const logger = require('../../shared/utils/logger');

const getSettings = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    const settings = await companySettingsService.findCompanySettingsByCompanyId(companyId);

    if (!settings) {
      return res.status(200).json({
        success: true,
        message: 'La empresa aún no tiene configuración corporativa registrada',
        data: null
      });
    }

    res.status(200).json({
      success: true,
      message: 'Configuración corporativa obtenida correctamente',
      data: settings
    });
  } catch (error) {
    logger.logError('COMPANY_SETTINGS', 'Error al obtener configuración', error);
    next(error);
  }
};

const upsertSettings = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    
    // Ignore any company_id sent by frontend
    const payload = { ...req.body };
    delete payload.company_id;

    const { error, value } = validateCompanySettings(payload);

    if (error) {
      return res.status(422).json({
        success: false,
        message: 'Error de validación',
        errors: error.details.map(err => ({
          field: err.path[0],
          message: err.message
        }))
      });
    }

    const existingSettings = await companySettingsService.findCompanySettingsByCompanyId(companyId);

    const updatedSettings = await companySettingsService.upsertCompanySettings(companyId, value);

    const isNew = !existingSettings;

    res.status(isNew ? 201 : 200).json({
      success: true,
      message: isNew ? 'Configuración corporativa creada correctamente' : 'Configuración corporativa actualizada correctamente',
      data: updatedSettings
    });
  } catch (error) {
    logger.logError('COMPANY_SETTINGS', 'Error al actualizar/crear configuración', error);
    next(error);
  }
};

const handleAssetUpload = async (req, res, next, assetType) => {
  try {
    const companyId = req.user.company_id;

    const existingSettings = await companySettingsService.findCompanySettingsByCompanyId(companyId);
    if (!existingSettings) {
      return res.status(422).json({
        success: false,
        message: 'Primero registre los datos corporativos de la empresa antes de subir archivos'
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se envió ningún archivo' });
    }

    const updatedSettings = await companySettingsService.uploadCompanyAsset(companyId, assetType, req.file);

    const messageMapping = {
      'logo': 'Logo corporativo actualizado correctamente',
      'signature': 'Firma digital actualizada correctamente',
      'stamp': 'Sello corporativo actualizado correctamente'
    };

    res.status(200).json({
      success: true,
      message: messageMapping[assetType],
      data: updatedSettings
    });
  } catch (error) {
    logger.logError('COMPANY_SETTINGS', `Error al subir asset: ${assetType}`, error);
    next(error);
  }
};

const uploadLogo = (req, res, next) => handleAssetUpload(req, res, next, 'logo');
const uploadSignature = (req, res, next) => handleAssetUpload(req, res, next, 'signature');
const uploadStamp = (req, res, next) => handleAssetUpload(req, res, next, 'stamp');

const handleAssetDelete = async (req, res, next, assetType) => {
  try {
    const companyId = req.user.company_id;

    const existingSettings = await companySettingsService.findCompanySettingsByCompanyId(companyId);
    if (!existingSettings) {
      return res.status(422).json({
        success: false,
        message: 'La empresa no tiene configuración corporativa registrada'
      });
    }

    const updatedSettings = await companySettingsService.deleteCompanyAsset(companyId, assetType);

    const messageMapping = {
      'logo': 'Logo corporativo eliminado',
      'signature': 'Firma digital eliminada',
      'stamp': 'Sello corporativo eliminado'
    };

    res.status(200).json({
      success: true,
      message: messageMapping[assetType],
      data: updatedSettings
    });
  } catch (error) {
    logger.logError('COMPANY_SETTINGS', `Error al eliminar asset: ${assetType}`, error);
    next(error);
  }
};

const deleteLogo = (req, res, next) => handleAssetDelete(req, res, next, 'logo');
const deleteSignature = (req, res, next) => handleAssetDelete(req, res, next, 'signature');
const deleteStamp = (req, res, next) => handleAssetDelete(req, res, next, 'stamp');

module.exports = {
  getSettings,
  upsertSettings,
  uploadLogo,
  uploadSignature,
  uploadStamp,
  deleteLogo,
  deleteSignature,
  deleteStamp
};
