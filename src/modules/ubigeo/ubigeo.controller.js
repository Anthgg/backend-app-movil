const ubigeoService = require('./ubigeo.service');

function sendCatalogResponse(res, items, successMessage) {
  const data = Array.isArray(items) ? items : [];

  res.status(200).json({
    success: true,
    message: data.length > 0 ? successMessage : 'Sin resultados',
    data
  });
}

async function getDepartments(req, res, next) {
  try {
    const departments = await ubigeoService.getDepartments();
    sendCatalogResponse(res, departments, 'Departamentos obtenidos correctamente');
  } catch (error) {
    next(error);
  }
}

async function getProvincesByDepartment(req, res, next) {
  try {
    const fieldName = req.params.departmentId ? 'departmentId' : 'department_id';
    const provinces = await ubigeoService.getProvincesByDepartment(
      req.params.departmentId || req.query.department_id,
      fieldName
    );
    sendCatalogResponse(res, provinces, 'Provincias obtenidas correctamente');
  } catch (error) {
    next(error);
  }
}

async function getDistrictsByProvince(req, res, next) {
  try {
    const fieldName = req.params.provinceId ? 'provinceId' : 'province_id';
    const districts = await ubigeoService.getDistrictsByProvince(
      req.params.provinceId || req.query.province_id,
      fieldName
    );
    sendCatalogResponse(res, districts, 'Distritos obtenidos correctamente');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDepartments,
  getProvincesByDepartment,
  getDistrictsByProvince
};
