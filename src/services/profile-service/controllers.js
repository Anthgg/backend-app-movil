const fs = require('fs');
const profileService = require('./service');
const sessionService = require('./session.service');
const { logAudit } = require('../../shared/utils/audit');
const { extractUploadPath, getPublicUploadUrl, getUploadFilePath } = require('../../shared/utils/url.utils');
const { uploadFile } = require('../../shared/utils/storage.utils');
const { getActivityTranslation, ACTIVITY_TRANSLATIONS } = require('./activity-translations');
const env = require('../../config/env');

function normalizeProfileUrls(req, profile) {
  if (!profile) return profile;

  const absUrl = getPublicUploadUrl(req, profile.profilePhotoUrl);
  profile.profilePhotoUrl = absUrl;
  profile.avatarUrl = absUrl;

  if (profile.user) {
    profile.user.profile_photo_url = getPublicUploadUrl(req, profile.user.profile_photo_url) || absUrl;
    profile.user.profilePhotoUrl = absUrl;
    profile.user.avatarUrl = absUrl;
  }

  return profile;
}

function buildProfilePayload(profile, req) {
  const normalizedProfile = normalizeProfileUrls(req, profile);
  return {
    profile: normalizedProfile,
    user: normalizedProfile.user || null,
    worker: normalizedProfile.worker || null,
    security: normalizedProfile.security || null,
    activity: normalizedProfile.activity || [],
    audit_logs: normalizedProfile.audit_logs || normalizedProfile.activity || [],
    logs: normalizedProfile.logs || normalizedProfile.activity || [],
    permissions: normalizedProfile.permissions || [],
    permissions_by_module: normalizedProfile.permissions_by_module || [],
    permissionsByModule: normalizedProfile.permissionsByModule || []
  };
}

function buildProfileResponse(profile, req) {
  const payload = buildProfilePayload(profile, req);
  return {
    success: true,
    ...payload,
    data: payload
  };
}

exports.getMe = async (req, res, next) => {
  try {
    await sessionService.touchSession(req.user.sessionId, req.user.id);
    const profile = await profileService.getProfile(req.user.id, req.tenantId, req.user.roles, req.user.permissions);
    res.json(buildProfileResponse(profile, req));
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
    const updated = await profileService.updateProfile(req.user.id, req.tenantId, req.body, req.user.roles, req.user.permissions);

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

    res.json(buildProfileResponse(updated, req));
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

    let photoUrl = `/uploads/profiles/${req.file.filename}`;
    if (env.supabaseUrl && env.supabaseServiceRoleKey) {
      const buffer = fs.readFileSync(req.file.path);
      const storagePath = `profiles/${req.user.id}/${req.file.filename}`;
      photoUrl = await uploadFile({
        buffer,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname
      }, env.companyAssetsBucket, storagePath);

      fs.unlink(req.file.path, () => {});
    }

    const profile = await profileService.updatePhoto(req.user.id, req.tenantId, photoUrl, req.user.roles, req.user.permissions);

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

    res.json(buildProfileResponse(profile, req));
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
    const current = await profileService.getProfile(req.user.id, req.tenantId, req.user.roles, req.user.permissions);
    await profileService.deletePhoto(req.user.id, req.tenantId);

    const currentPhotoPath = extractUploadPath(current.profilePhotoUrl);
    if (currentPhotoPath) {
      const filePath = getUploadFilePath(currentPhotoPath);
      if (filePath && fs.existsSync(filePath)) {
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

exports.listSessions = async (req, res, next) => {
  try {
    const sessions = await sessionService.listSessions(req.user.id, req.user.sessionId);
    const logger = require('../../shared/utils/logger');
    logger.logInfo('SESSION', `[PROFILE SESSIONS] Cantidad de sesiones devueltas: ${sessions.length}`);
    res.json({ success: true, data: { sessions } });
  } catch (error) {
    next(error);
  }
};

exports.revokeSession = async (req, res, next) => {
  try {
    const result = await sessionService.revokeSession(req.user.id, req.params.id, req);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.revokeOtherSessions = async (req, res, next) => {
  try {
    const result = await sessionService.revokeOtherSessions(req.user.id, req.user.sessionId, req);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.trustSession = async (req, res, next) => {
  try {
    const result = await sessionService.trustSession(req.user.id, req.params.id, req);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.getActivities = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "No se pudo identificar al usuario autenticado."
      });
    }

    let { scope = "ALL", days, page = 1, limit = 20 } = req.query;
    
    // Type casting
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);
    days = days ? parseInt(days, 10) : null;
    scope = String(scope).toUpperCase();

    // Validation
    const ALLOWED_ACTIVITY_SCOPES = ["ALL", "SECURITY", "PROFILE", "REPORTS", "SESSION", "GENERAL"];
    if (!ALLOWED_ACTIVITY_SCOPES.includes(scope)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACTIVITY_SCOPE",
        message: "El filtro de actividad no es válido."
      });
    }

    if (isNaN(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACTIVITY_LIMIT",
        message: "El límite debe estar entre 1 y 100."
      });
    }

    if (isNaN(page) || page < 1) {
      page = 1;
    }

    if (days !== null && (isNaN(days) || days < 1 || days > 365)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ACTIVITY_DAYS",
        message: "El filtro de días debe estar entre 1 y 365."
      });
    }

    // Map scopes to actions
    let actionFilters = [];
    if (scope !== "ALL") {
      // Gather all actions matching the requested scope
      for (const [actionKey, translation] of Object.entries(ACTIVITY_TRANSLATIONS)) {
        if (translation.scope === scope) {
          actionFilters.push(actionKey);
        }
      }
      
      // If no actions match the scope, we still pass a non-matching action to return empty results
      if (actionFilters.length === 0) {
        actionFilters = ["__EMPTY_FILTER__"];
      }
    }

    const offset = (page - 1) * limit;

    const rawActivities = await profileService.getUserActivities({
      userId: req.user.id,
      actionFilters,
      days,
      limit,
      offset
    });

    const totalCount = rawActivities.length > 0 ? parseInt(rawActivities[0].total_count, 10) : 0;
    const totalPages = Math.ceil(totalCount / limit);

    const mappedActivities = rawActivities.map(row => {
      const translation = getActivityTranslation(row.action);
      return {
        id: row.id,
        action: row.action,
        actionLabel: translation.label,
        description: translation.description,
        scope: translation.scope,
        module: row.module || "GENERAL",
        actorName: row.actor_name || "Sistema",
        createdAt: row.created_at
      };
    });

    res.json({
      success: true,
      data: {
        activities: mappedActivities,
        pagination: {
          page,
          limit,
          total: totalCount,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
};
