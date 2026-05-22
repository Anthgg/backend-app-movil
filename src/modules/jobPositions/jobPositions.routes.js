const express = require('express');
const router = express.Router();
const jobPositionController = require('./jobPositions.controller');

router.get('/', jobPositionController.getJobPositions);
router.get('/by-area/:areaId', jobPositionController.getJobPositionsByArea);
router.get('/:id', jobPositionController.getJobPositionById);
router.post('/', jobPositionController.createJobPosition);
router.put('/:id', jobPositionController.updateJobPosition);
router.patch('/:id/status', jobPositionController.updateJobPositionStatus);

module.exports = router;
