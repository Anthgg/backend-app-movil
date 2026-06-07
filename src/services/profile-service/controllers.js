const fs = require('fs');
const path = require('path');
const profileService = require('./service');
const { logAudit } = require('../../shared/utils/audit');

function buildProfilePayload(profile) {
  return {
    profile,
    user: profile.user || null,
    worker: profile.worker || null,
    security: profile.security || null,
    activity: profile.activity || [],
    audit_logs: profile.audit_logs || profile.activity || []
  };
}

exports.getMe = async (req, res, next) => {
  try {
    const profile = await profileService.getProfile(req.user.id, req.tenantId, req.user.roles);
    res.json({ success: true, data: buildProfilePayload(profile) });
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

    res.json({ success: true, data: buildProfilePayload(updated) });
  } catch (error) {
    next(error);
  }
};

exports.uploadPhoto = async (req, res, next) => {
  try {
    console.log('[profile/photo] headers', req.headers);
    console.log('[profile/photo] body', req.body);
    console.log('[profile/photo] file', req.file);

    if (!req.file) {
      console.log('[profile/photo] controller-missing-file', {
        contentType: req.headers['content-type'] || null
      });
      return res.status(400).json({ success: false, message: 'No se subio ningun archivo.', error_code: 'PHOTO_REQUIRED' });
    }

    console.log('[profile/photo] controller-file', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size
    });

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

    res.json({ success: true, data: buildProfilePayload(profile) });
  } catch (error) {
    console.error('[profile/photo] error', error);
    console.log('[profile/photo] controller-error', {
      message: error.message,
      statusCode: error.statusCode || null,
      errorCode: error.errorCode || null
    });

    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      return res.status(500).json({
        success: false,
        code: 'UPLOAD_FAILED',
        message: 'No se pudo subir la foto'
      });
    }

    return res.status(statusCode).json({
      success: false,
      message: error.message,
      error_code: error.errorCode || 'UPLOAD_FAILED'
    });
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
