const express = require('express');
const router = express.Router();
const controller = require('../controllers/holiday.controller');
const authMiddleware = require('../../../shared/middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/', controller.getHolidays);
router.post('/', controller.createHoliday);
router.put('/:id', controller.updateHoliday);
router.delete('/:id', controller.deleteHoliday);

module.exports = router;
