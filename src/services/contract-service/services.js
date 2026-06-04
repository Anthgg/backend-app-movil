const path = require('path');
const { query, withTransaction } = require('../../config/database');
const env = require('../../config/env');
const { uploadFile } = require('../../shared/utils/storage.utils');
const { getCompanySettings } = require('../company-settings-service/companySettings.service');
const { generateLaborContractPdf } = require('../../templates/pdf/labor-contract.template');
const { normalizeNamePart } = require('../../utils/credentials.util');
const { buildWorkerStoragePath, getFileExtension, sanitizeFileName, validateSignedContractFile } = require('../../utils/file-upload.util');
const { insertReturning, updateReturning } = require('../../utils/db.util');
const { logAuditEvent } = require('../../utils/audit.util');
const { assertValidWorkerId, assertValidContractId } = require('../../utils/uuid.util');

const storageBucket = env.workerDocumentsBucket || env.requestDocumentsBucket;

function createHttpError(statusCode, errorCode, message, errors = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (errors) {
    error.errors = errors;
  }
  return error;
}

function fullWorkerName(worker) {
  return [
    worker.first_name,
    worker.paternal_last_name,
    worker.maternal_last_name
  ].filter(Boolean).join(' ').trim() || worker.worker_name || 'Trabajador';
}

function safeContractBaseName(worker) {
  const name = normalizeNamePart(fullWorkerName(worker)).replace(/\s+/g, '-');
  return name || worker.document_number || worker.id;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function getContractForCompany(contractId, companyId, db = { query }) {
  assertValidContractId(contractId);

  const result = await db.query(`
    SELECT wc.*,
           ct.name AS contract_type_name,
           w.id AS resolved_worker_id,
           w.company_id AS resolved_company_id,
           w.document_number,
           w.document_type,
           w.first_name,
           w.paternal_last_name,
           w.maternal_last_name,
           w.phone_number,
           w.address,
           w.hire_date,
           jp.name AS position_name,
           d.name AS area_name,
           c.name AS company_name
    FROM worker_contracts wc
    JOIN workers w ON w.id = wc.worker_id
    LEFT JOIN contract_types ct ON ct.id = wc.contract_type_id
    LEFT JOIN job_positions jp ON jp.id = COALESCE(w.position_id, w.job_position_id)
    LEFT JOIN areas d ON d.id = w.area_id
    LEFT JOIN companies c ON c.id = w.company_id
    WHERE wc.id = $1
      AND w.company_id = $2
      AND w.deleted_at IS NULL
    LIMIT 1
  `, [contractId, companyId]);

  return result.rows[0] || null;
}

async function generateContractPdfBuffer({ contract, companySettings, generatedByName }) {
  return generateLaborContractPdf({
    contract,
    worker: contract, // The query in getContractForCompany fetches worker fields alongside contract fields
    companyConfig: companySettings,
    generatedBy: generatedByName || 'RR.HH.',
    generatedAt: new Date()
  });
}

async function registerGeneratedContractDocument({ db, companyId, workerId, contractId, fileUrl, filePath, fileName, sizeBytes, uploadedBy }) {
  await insertReturning(db, 'contract_documents', {
    contract_id: contractId,
    company_id: companyId,
    worker_id: workerId,
    document_type: 'generated_contract',
    file_name: fileName,
    file_url: fileUrl,
    file_path: filePath,
    mime_type: 'application/pdf',
    size_bytes: sizeBytes,
    status: 'generated',
    uploaded_by: uploadedBy,
    metadata: { source: 'contract_generate' }
  });

  await insertReturning(db, 'worker_documents', {
    worker_id: workerId,
    company_id: companyId,
    document_type: 'generated_contract',
    file_name: fileName,
    file_url: fileUrl,
    file_path: filePath,
    mime_type: 'application/pdf',
    size_bytes: sizeBytes,
    status: 'generated',
    uploaded_by: uploadedBy,
    metadata: { contract_id: contractId }
  });
}

async function generateContractPdf({ db = { query }, companyId, contractId, requestedBy, req = null }) {
  assertValidContractId(contractId);

  const contract = await getContractForCompany(contractId, companyId, db);
  if (!contract) {
    throw createHttpError(404, 'CONTRACT_NOT_FOUND', 'Contrato no encontrado.');
  }

  const companySettings = await getCompanySettings(companyId);
  const generatedByName = req?.user?.email || 'RR.HH.';
  const pdfBuffer = await generateContractPdfBuffer({ contract, companySettings, generatedByName });
  const timestamp = Date.now();
  const fileName = `contrato-generado-${safeContractBaseName(contract)}-${timestamp}.pdf`;
  const filePath = buildWorkerStoragePath({
    companyId,
    workerId: contract.resolved_worker_id,
    folder: 'contracts/generated',
    fileName
  });

  const fileUrl = await uploadFile({
    buffer: pdfBuffer,
    mimetype: 'application/pdf',
    originalname: fileName,
    size: pdfBuffer.length
  }, storageBucket, filePath);

  await updateReturning(db, 'worker_contracts', 'id', contractId, {
    generated_pdf_url: fileUrl,
    updated_at: new Date()
  });

  await registerGeneratedContractDocument({
    db,
    companyId,
    workerId: contract.resolved_worker_id,
    contractId,
    fileUrl,
    filePath,
    fileName,
    sizeBytes: pdfBuffer.length,
    uploadedBy: requestedBy
  });

  await logAuditEvent({
    db,
    userId: requestedBy,
    companyId,
    module: 'CONTRACTS',
    action: 'CONTRACT_PDF_GENERATED',
    entity: 'worker_contracts',
    entityId: contractId,
    newData: { file_url: fileUrl, file_name: fileName },
    req: req || {}
  });

  return {
    contract_id: contractId,
    worker_id: contract.resolved_worker_id,
    pdf_url: fileUrl,
    file_name: fileName,
    file_path: filePath
  };
}

async function uploadSignedContract({ workerId, companyId, contractId, file, signedAt, observations, uploadedBy, req }) {
  assertValidWorkerId(workerId);
  assertValidContractId(contractId);

  validateSignedContractFile(file);

  const contract = await getContractForCompany(contractId, companyId);
  if (!contract || contract.resolved_worker_id !== workerId) {
    throw createHttpError(404, 'CONTRACT_NOT_FOUND', 'El contrato no pertenece al trabajador indicado.');
  }

  const timestamp = Date.now();
  const extension = getFileExtension(file) || path.extname(file.originalname || '') || '.pdf';
  const fileName = sanitizeFileName(`contrato-firmado-${workerId}-${timestamp}${extension}`);
  const filePath = buildWorkerStoragePath({
    companyId,
    workerId,
    folder: 'contracts/signed',
    fileName
  });

  const fileUrl = await uploadFile(file, storageBucket, filePath);
  const resolvedSignedAt = signedAt || new Date().toISOString().slice(0, 10);

  const result = await withTransaction(async (client) => {
    const updatedContract = await updateReturning(client, 'worker_contracts', 'id', contractId, {
      signed_file_url: fileUrl,
      signed_at: resolvedSignedAt,
      observations: observations || contract.observations || null,
      updated_at: new Date()
    });

    await insertReturning(client, 'contract_documents', {
      contract_id: contractId,
      company_id: companyId,
      worker_id: workerId,
      document_type: 'signed_contract',
      file_name: fileName,
      file_url: fileUrl,
      file_path: filePath,
      mime_type: file.mimetype,
      size_bytes: file.size,
      status: 'signed',
      uploaded_by: uploadedBy,
      metadata: { signed_at: resolvedSignedAt, observations: observations || null }
    });

    await insertReturning(client, 'worker_documents', {
      worker_id: workerId,
      company_id: companyId,
      document_type: 'signed_contract',
      file_name: fileName,
      file_url: fileUrl,
      file_path: filePath,
      mime_type: file.mimetype,
      size_bytes: file.size,
      status: 'signed',
      uploaded_by: uploadedBy,
      metadata: { contract_id: contractId, signed_at: resolvedSignedAt, observations: observations || null }
    });

    await logAuditEvent({
      db: client,
      userId: uploadedBy,
      companyId,
      module: 'CONTRACTS',
      action: 'SIGNED_CONTRACT_UPLOADED',
      entity: 'worker_contracts',
      entityId: contractId,
      newData: { signed_file_url: fileUrl, signed_at: resolvedSignedAt },
      req
    });

    return updatedContract;
  });

  return {
    contract_id: contractId,
    signed_file_url: fileUrl,
    signed_at: resolvedSignedAt,
    contract: result
  };
}

async function listWorkerContracts(workerId, companyId, db = { query }) {
  assertValidWorkerId(workerId);

  const result = await db.query(`
    SELECT wc.*,
           ct.name AS contract_type_name
    FROM worker_contracts wc
    LEFT JOIN contract_types ct ON ct.id = wc.contract_type_id
    WHERE wc.worker_id = $1
      AND wc.company_id = $2
    ORDER BY wc.created_at DESC
  `, [workerId, companyId]);
  return result.rows;
}

async function downloadContractStream(contractId, companyId, req, db = { query }) {
  assertValidContractId(contractId);

  const contract = await getContractForCompany(contractId, companyId, db);
  if (!contract) {
    throw createHttpError(404, 'CONTRACT_NOT_FOUND', 'Contrato no encontrado.');
  }

  if (contract.signed_file_url) {
    return { type: 'redirect', url: contract.signed_file_url };
  }

  const companySettings = await getCompanySettings(companyId);
  const generatedByName = req?.user?.email || 'RR.HH.';
  
  const pdfBuffer = await generateContractPdfBuffer({ contract, companySettings, generatedByName });
  const fileName = `contrato-${safeContractBaseName(contract)}.pdf`;
  
  return { type: 'buffer', buffer: pdfBuffer, fileName };
}

module.exports = {
  generateContractPdf,
  uploadSignedContract,
  getContractForCompany,
  listWorkerContracts,
  downloadContractStream,
  createHttpError
};
