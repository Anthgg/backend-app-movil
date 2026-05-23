const express = require('express');
const router = express.Router();
const roleController = require('./roles.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

router.get('/', requirePermission('roles.read'), roleController.getRoles);
router.get('/:id', requirePermission('roles.read'), roleController.getRoleById);
router.post('/', requirePermission('roles.create'), roleController.createRole);
router.put('/:id', requirePermission('roles.update'), roleController.updateRole);
router.patch('/:id/status', requirePermission('roles.update'), roleController.updateRoleStatus);
router.delete('/:id', requirePermission('roles.delete'), roleController.deleteRole);

module.exports = router;
