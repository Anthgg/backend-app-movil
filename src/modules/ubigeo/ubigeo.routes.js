const express = require('express');
const router = express.Router();
const ubigeoController = require('./ubigeo.controller');

router.get('/departments', ubigeoController.getDepartments);
router.get('/provinces/:departmentId', ubigeoController.getProvincesByDepartment);
router.get('/districts/:provinceId', ubigeoController.getDistrictsByProvince);

module.exports = router;
