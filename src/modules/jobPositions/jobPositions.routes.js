const express = require('express');
const router = express.Router();
const jobPositionController = require('./jobPositions.controller');
const { requirePermission } = require('../../shared/middlewares/permissions.middleware');

router.get('/', requirePermission('job_positions.read'), jobPositionController.getJobPositions);
router.get('/by-area/:areaId', requirePermission('job_positions.read'), jobPositionController.getJobPositionsByArea);
router.get('/:id/default-role', requirePermission('job_positions.read'), jobPositionController.getDefaultRole);
router.get('/:id', requirePermission('job_positions.read'), jobPositionController.getJobPositionById);
router.post('/', requirePermission('job_positions.create'), jobPositionController.createJobPosition);
router.put('/:id', requirePermission('job_positions.update'), jobPositionController.updateJobPosition);
router.patch('/:id/status', requirePermission('job_positions.update'), jobPositionController.updateJobPositionStatus);
router.delete('/:id', requirePermission('job_positions.delete'), jobPositionController.deleteJobPosition);

module.exports = router;
