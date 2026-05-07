const fs = require('fs');
const path = require('path');
const profileService = require('./service');
const { logAudit } = require('../../shared/utils/audit');

exports.getMe = async (req, res, next) => {
  try {
    const profile = await profileService.getProfile(req.user.id, req.tenantId, req.user.roles);
    res.json({ success: true, data: { profile } });
  } catch (error) {
    next(error);
  }
};

exports.getMyShift = async (req, res, next) => {
  try {
    const shift = await profileService.getMyShift(req.user.id, req.tenantId);
    res.json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

exports.updateMe = async (req, res, next) => {
  try {
    const updated = await profileService.updateProfile(req.user.id, req.tenantId, req.body, req.user.roles);

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'PROFILE',
      action: 'UPDATE',
      entity: 'workers',
      entityId: req.user.worker_id || req.user.id,
      newData: req.body,
      req
    });

    res.json({ success: true, data: { profile: updated } });
  } catch (error) {
    next(error);
  }
};

exports.uploadPhoto = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se subio ningun archivo.', error_code: 'PHOTO_REQUIRED' });
    }

    const photoUrl = `/uploads/profiles/${req.file.filename}`;
    const profile = await profileService.updatePhoto(req.user.id, req.tenantId, photoUrl, req.user.roles);

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'PROFILE',
      action: 'UPLOAD_PHOTO',
      entity: 'workers',
      entityId: req.user.worker_id || req.user.id,
      newData: { profilePhotoUrl: photoUrl },
      req
    });

    res.json({ success: true, data: { profile } });
  } catch (error) {
    next(error);
  }
};

exports.deletePhoto = async (req, res, next) => {
  try {
    const current = await profileService.getProfile(req.user.id, req.tenantId, req.user.roles);
    await profileService.deletePhoto(req.user.id, req.tenantId);

    if (current.profilePhotoUrl) {
      const filePath = path.join(__dirname, '../../../uploads', current.profilePhotoUrl.replace(/^\/uploads\//, ''));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    await logAudit({
      userId: req.user.id,
      companyId: req.tenantId,
      module: 'PROFILE',
      action: 'DELETE_PHOTO',
      entity: 'workers',
      entityId: req.user.worker_id || req.user.id,
      req
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
