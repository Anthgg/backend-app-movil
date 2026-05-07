const { query } = require('../../config/database');

const normalizeType = (value) => {
  if (!value) {
    return 'document';
  }

  return String(value).trim().toLowerCase().replace(/\s+/g, '_');
};

const normalizeTitle = (value) => {
  if (!value) {
    return 'Documento';
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const serializeDocument = (row) => ({
  id: row.id,
  type: normalizeType(row.type || row.document_type || row.type_code || row.type_name),
  title: row.title || normalizeTitle(row.name || row.type_name || row.type || row.document_type),
  description: row.description || row.type_description || null,
  status: row.status ? String(row.status).toLowerCase() : 'pending',
  fileUrl: row.file_url || row.fileUrl || null,
  createdAt: row.created_at || row.uploaded_at || null,
  updatedAt: row.updated_at || row.created_at || row.uploaded_at || null,
  reviewComment: row.review_comment || row.hr_comment || null
});

async function getMyDocuments(workerId, companyId) {
  const result = await query(`
    SELECT d.id,
           NULL::text AS type,
           NULL::text AS title,
           NULL::text AS description,
           d.file_url,
           d.status,
           d.hr_comment,
           NULL::text AS review_comment,
           NULL::timestamptz AS created_at,
           d.uploaded_at,
           d.updated_at,
           NULL::text AS type_code,
           dt.name AS type_name,
           dt.description AS type_description
    FROM documents d
    JOIN workers w ON w.id = d.worker_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE d.worker_id = $1
      AND w.company_id = $2
      AND d.deleted_at IS NULL
      AND w.deleted_at IS NULL
    ORDER BY COALESCE(d.updated_at, d.uploaded_at) DESC, d.id DESC
  `, [workerId, companyId]);

  console.log('[documents/my] query-result', {
    count: result.rows.length,
    firstId: result.rows[0]?.id || null,
    statuses: [...new Set(result.rows.map((row) => row.status).filter(Boolean))]
  });

  return result.rows.map(serializeDocument);
}

module.exports = {
  getMyDocuments
};
