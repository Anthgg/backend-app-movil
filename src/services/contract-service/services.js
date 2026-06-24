const path = require('path');
const { query, withTransaction } = require('../../config/database');
const env = require('../../config/env');
const { uploadFile } = require('../../shared/utils/storage.utils');
const { getCompanySettings } = require('../company-settings-service/companySettings.service');
const { generateLaborContractPdf } = require('../../templates/pdf/labor-contract.template');
const { normalizeNamePart } = require('../../utils/credentials.util');
const { buildWorkerStoragePath, getFileExtension, sanitizeFileName, validateSignedContractFile } = require('../../utils/file-upload.util');
const { insertReturning, updateReturning, tableHasColumn } = require('../../utils/db.util');
const { logAuditEvent } = require('../../utils/audit.util');
const { assertValidWorkerId, assertValidContractId } = require('../../utils/uuid.util');

const storageBucket = env.workerDocumentsBucket || env.requestDocumentsBucket;
const CONTRACT_CODE_PREFIX = 'F-RRHH-CTR';

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

function formatContractCode(sequenceNumber) {
  return `${CONTRACT_CODE_PREFIX}-${String(sequenceNumber).padStart(6, '0')}`;
}

function dateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function workerContractsSupportTrackingCode(db) {
  const [hasContractCode, hasContractSequence] = await Promise.all([
    tableHasColumn('worker_contracts', 'contract_code', db),
    tableHasColumn('worker_contracts', 'contract_sequence', db)
  ]);

  return hasContractCode && hasContractSequence;
}

async function ensureContractTrackingCode({ db, companyId, contract }) {
  if (!contract || contract.contract_code) {
    return contract;
  }

  const supportsTrackingCode = await workerContractsSupportTrackingCode(db);
  if (!supportsTrackingCode) {
    return contract;
  }

  const result = await db.query(`
    WITH target AS (
      SELECT wc.id, wc.contract_code, wc.contract_sequence
      FROM worker_contracts wc
      JOIN workers w ON w.id = wc.worker_id
      WHERE wc.id = $1
        AND w.company_id = $2
        AND w.deleted_at IS NULL
      FOR UPDATE OF wc
    ),
    next_sequence AS (
      SELECT nextval('public.worker_contract_code_seq') AS sequence_number
      WHERE EXISTS (
        SELECT 1
        FROM target
        WHERE contract_code IS NULL
      )
    ),
    assigned AS (
      UPDATE worker_contracts wc
      SET contract_sequence = next_sequence.sequence_number,
          contract_code = $3 || '-' || LPAD(next_sequence.sequence_number::TEXT, 6, '0'),
          company_id = COALESCE(wc.company_id, $2),
          updated_at = NOW()
      FROM target, next_sequence
      WHERE wc.id = target.id
        AND target.contract_code IS NULL
      RETURNING wc.contract_sequence, wc.contract_code
    )
    SELECT contract_sequence, contract_code
    FROM assigned
    UNION ALL
    SELECT contract_sequence, contract_code
    FROM target
    WHERE contract_code IS NOT NULL
    LIMIT 1
  `, [contract.id, companyId, CONTRACT_CODE_PREFIX]);

  const trackingCode = result.rows[0] || null;
  return {
    ...contract,
    contract_sequence: trackingCode?.contract_sequence || contract.contract_sequence || null,
    contract_code: trackingCode?.contract_code || contract.contract_code || null
  };
}

function generatedContractFileName(contract, timestamp) {
  const contractCode = contract.contract_code || (contract.contract_sequence ? formatContractCode(contract.contract_sequence) : null);
  const codeSegment = contractCode ? `${sanitizeFileName(contractCode)}-` : '';
  return `contrato-generado-${codeSegment}${safeContractBaseName(contract)}-${timestamp}.pdf`;
}

function downloadContractFileName(contract) {
  const codeSegment = contract.contract_code ? `${sanitizeFileName(contract.contract_code)}-` : '';
  return `contrato-${codeSegment}${safeContractBaseName(contract)}.pdf`;
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

async function registerGeneratedContractDocument({ db, companyId, workerId, contractId, contractCode, fileUrl, filePath, fileName, sizeBytes, uploadedBy }) {
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
    metadata: { source: 'contract_generate', contract_code: contractCode || null }
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
    metadata: { contract_id: contractId, contract_code: contractCode || null }
  });
}

async function generateContractPdfInternal({ db, companyId, contractId, requestedBy, req = null }) {
  assertValidContractId(contractId);

  let contract = await getContractForCompany(contractId, companyId, db);
  if (!contract) {
    throw createHttpError(404, 'CONTRACT_NOT_FOUND', 'Contrato no encontrado.');
  }

  contract = await ensureContractTrackingCode({ db, companyId, contract });

  const companySettings = await getCompanySettings(companyId);
  const generatedByName = req?.user?.email || 'RR.HH.';
  const pdfBuffer = await generateContractPdfBuffer({ contract, companySettings, generatedByName });
  const timestamp = Date.now();
  const fileName = generatedContractFileName(contract, timestamp);
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
    contractCode: contract.contract_code,
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
    newData: { file_url: fileUrl, file_name: fileName, contract_code: contract.contract_code || null },
    req: req || {}
  });

  return {
    contract_id: contractId,
    worker_id: contract.resolved_worker_id,
    contract_code: contract.contract_code || null,
    pdf_url: fileUrl,
    file_name: fileName,
    file_path: filePath
  };
}

async function generateContractPdf({ db, companyId, contractId, requestedBy, req = null }) {
  if (db) {
    return generateContractPdfInternal({ db, companyId, contractId, requestedBy, req });
  }

  return withTransaction((client) => generateContractPdfInternal({
    db: client,
    companyId,
    contractId,
    requestedBy,
    req
  }));
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

async function downloadContractStreamInternal(contractId, companyId, req, db) {
  assertValidContractId(contractId);

  let contract = await getContractForCompany(contractId, companyId, db);
  if (!contract) {
    throw createHttpError(404, 'CONTRACT_NOT_FOUND', 'Contrato no encontrado.');
  }

  if (contract.signed_file_url) {
    return { type: 'redirect', url: contract.signed_file_url };
  }

  contract = await ensureContractTrackingCode({ db, companyId, contract });

  const companySettings = await getCompanySettings(companyId);
  const generatedByName = req?.user?.email || 'RR.HH.';
  
  const pdfBuffer = await generateContractPdfBuffer({ contract, companySettings, generatedByName });
  const fileName = downloadContractFileName(contract);
  
  return { type: 'buffer', buffer: pdfBuffer, fileName, contract_code: contract.contract_code || null };
}

async function downloadContractStream(contractId, companyId, req, db) {
  if (db) {
    return downloadContractStreamInternal(contractId, companyId, req, db);
  }

  return withTransaction((client) => downloadContractStreamInternal(contractId, companyId, req, client));
}

module.exports = {
  generateContractPdf,
  uploadSignedContract,
  getContractForCompany,
  listWorkerContracts,
  downloadContractStream,
  createHttpError
};
