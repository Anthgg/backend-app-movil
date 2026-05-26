/**
 * Postman payload examples for organizational structure endpoints.
 */

const createDepartmentPayload = {
  name: 'Operaciones',
  description: 'Departamento responsable de operaciones de campo',
  is_active: true
};

const createAreaPayload = {
  department_id: 'uuid-departamento-interno',
  name: 'Obras Civiles',
  description: 'Area operativa de obras civiles',
  is_active: true
};

const createPositionPayload = {
  area_id: 'uuid-area',
  name: 'Supervisor de Obra',
  description: 'Responsable de cuadrillas y control de avance',
  default_role_id: 'uuid-rol-opcional',
  is_active: true
};

const createWorkLocationPayload = {
  sede_id: 'uuid-sede-opcional',
  name: 'Obra Villa El Salvador',
  address: 'Av. Principal 123',
  geographic_department_id: 'uuid-departamento-geografico',
  geographic_province_id: 'uuid-provincia-geografica',
  geographic_district_id: 'uuid-distrito-geografico',
  latitude: -12.2145,
  longitude: -76.9432,
  allowed_radius_meters: 100
};

const updateWorkerLaborAssignmentPayload = {
  sede_id: 'uuid-sede',
  internal_department_id: 'uuid-departamento-interno',
  area_id: 'uuid-area',
  position_id: 'uuid-puesto',
  work_location_id: 'uuid-lugar-trabajo'
};

module.exports = {
  createDepartmentPayload,
  createAreaPayload,
  createPositionPayload,
  createWorkLocationPayload,
  updateWorkerLaborAssignmentPayload
};
