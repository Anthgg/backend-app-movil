const { query } = require('../../config/database');
const { uploadFile } = require('../../shared/utils/storage.utils');
const logger = require('../../shared/utils/logger');
const { getSupabaseClient } = require('../../config/supabase');

const findCompanySettingsByCompanyId = async (companyId) => {
  const text = `
    SELECT * FROM company_settings
    WHERE company_id = $1 AND estado = true
  `;
  const { rows } = await query(text, [companyId]);
  return rows[0] || null;
};

const createCompanySettings = async (companyId, data) => {
  const text = `
    INSERT INTO company_settings (
      company_id, razon_social, nombre_comercial, ruc, direccion_fiscal,
      telefono, correo_corporativo, pagina_web, representante_legal,
      cargo_representante, color_primario, color_secundario, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
    ) RETURNING *
  `;
  const values = [
    companyId,
    data.razon_social,
    data.nombre_comercial || null,
    data.ruc,
    data.direccion_fiscal || null,
    data.telefono || null,
    data.correo_corporativo || null,
    data.pagina_web || null,
    data.representante_legal || null,
    data.cargo_representante || null,
    data.color_primario || null,
    data.color_secundario || null
  ];

  const { rows } = await query(text, values);
  return rows[0];
};

const updateCompanySettings = async (companyId, data) => {
  const text = `
    UPDATE company_settings SET
      razon_social = $2,
      nombre_comercial = $3,
      ruc = $4,
      direccion_fiscal = $5,
      telefono = $6,
      correo_corporativo = $7,
      pagina_web = $8,
      representante_legal = $9,
      cargo_representante = $10,
      color_primario = $11,
      color_secundario = $12,
      updated_at = NOW()
    WHERE company_id = $1
    RETURNING *
  `;
  const values = [
    companyId,
    data.razon_social,
    data.nombre_comercial || null,
    data.ruc,
    data.direccion_fiscal || null,
    data.telefono || null,
    data.correo_corporativo || null,
    data.pagina_web || null,
    data.representante_legal || null,
    data.cargo_representante || null,
    data.color_primario || null,
    data.color_secundario || null
  ];

  const { rows } = await query(text, values);
  return rows[0];
};

const upsertCompanySettings = async (companyId, data) => {
  const text = `
    INSERT INTO company_settings (
      company_id, razon_social, nombre_comercial, ruc, direccion_fiscal,
      telefono, correo_corporativo, pagina_web, representante_legal,
      cargo_representante, color_primario, color_secundario, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
    )
    ON CONFLICT (company_id)
    DO UPDATE SET
      razon_social = EXCLUDED.razon_social,
      nombre_comercial = EXCLUDED.nombre_comercial,
      ruc = EXCLUDED.ruc,
      direccion_fiscal = EXCLUDED.direccion_fiscal,
      telefono = EXCLUDED.telefono,
      correo_corporativo = EXCLUDED.correo_corporativo,
      pagina_web = EXCLUDED.pagina_web,
      representante_legal = EXCLUDED.representante_legal,
      cargo_representante = EXCLUDED.cargo_representante,
      color_primario = EXCLUDED.color_primario,
      color_secundario = EXCLUDED.color_secundario,
      updated_at = NOW()
    RETURNING *
  `;
  const values = [
    companyId,
    data.razon_social,
    data.nombre_comercial || null,
    data.ruc,
    data.direccion_fiscal || null,
    data.telefono || null,
    data.correo_corporativo || null,
    data.pagina_web || null,
    data.representante_legal || null,
    data.cargo_representante || null,
    data.color_primario || null,
    data.color_secundario || null
  ];

  const { rows } = await query(text, values);
  return rows[0];
};

const updateCompanyAsset = async (companyId, field, fileUrl) => {
  // field should be 'logo_url', 'firma_url', or 'sello_url'
  const allowedFields = ['logo_url', 'firma_url', 'sello_url'];
  if (!allowedFields.includes(field)) {
    throw new Error('Invalid asset field');
  }

  const text = `
    UPDATE company_settings 
    SET ${field} = $2, updated_at = NOW() 
    WHERE company_id = $1 
    RETURNING *
  `;
  const { rows } = await query(text, [companyId, fileUrl]);
  return rows[0];
};

const uploadCompanyAsset = async (companyId, type, file) => {
  const bucket = 'company-assets'; 
  const extension = file.originalname.split('.').pop();
  const path = `${companyId}/${type}.${extension}`;

  const publicUrl = await uploadFile(file, bucket, path);
  
  const fieldMapping = {
    'logo': 'logo_url',
    'signature': 'firma_url',
    'stamp': 'sello_url'
  };

  const field = fieldMapping[type];
  if (!field) throw new Error('Invalid asset type');

  return updateCompanyAsset(companyId, field, publicUrl);
};

const deleteCompanyAsset = async (companyId, type) => {
  // No borraremos el archivo de Supabase por simplicidad, solo anulamos la URL. 
  // Podriamos borrarlo si tuvieramos la ruta exacta
  const fieldMapping = {
    'logo': 'logo_url',
    'signature': 'firma_url',
    'stamp': 'sello_url'
  };

  const field = fieldMapping[type];
  if (!field) throw new Error('Invalid asset type');

  return updateCompanyAsset(companyId, field, null);
};

const getCompanySettings = async (companyId) => {
    return await findCompanySettingsByCompanyId(companyId);
};

module.exports = {
  findCompanySettingsByCompanyId,
  createCompanySettings,
  updateCompanySettings,
  upsertCompanySettings,
  uploadCompanyAsset,
  deleteCompanyAsset,
  getCompanySettings
};
