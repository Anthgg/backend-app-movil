const profileService = require('./service');
const { logAudit } = require('../../../shared/utils/audit');

exports.getMe = async (req, res, next) => {
    try {
        const profile = await profileService.getProfile(req.user.id, req.tenantId);
        res.json({ success: true, data: profile });
    } catch (error) {
        next(error);
    }
};

exports.updateMe = async (req, res, next) => {
    try {
        const updated = await profileService.updateProfile(req.user.id, req.tenantId, req.body);
        
        await logAudit({
            userId: req.user.id, companyId: req.tenantId, module: 'PROFILE', action: 'UPDATE',
            entity: 'workers', entityId: updated.id, newData: req.body, req
        });

        res.json({ success: true, message: 'Perfil actualizado correctamente.', data: updated });
    } catch (error) {
        next(error);
    }
};

exports.uploadPhoto = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No se subió ningún archivo.' });
        }

        const photoUrl = `/uploads/profiles/${req.file.filename}`;
        const result = await profileService.updatePhoto(req.user.id, req.tenantId, photoUrl);

        res.json({ success: true, message: 'Foto de perfil actualizada.', data: result });
    } catch (error) {
        next(error);
    }
};

exports.deletePhoto = async (req, res, next) => {
    try {
        await profileService.deletePhoto(req.user.id, req.tenantId);
        res.json({ success: true, message: 'Foto de perfil eliminada.' });
    } catch (error) {
        next(error);
    }
};
