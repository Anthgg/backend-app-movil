const { query } = require('../../config/database');

const normalizeType = (value) => {
  if (!value) {
    return 'document';
  }

  return value.toLowerCase();
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
  type: normalizeType(row.type_name),
  title: normalizeTitle(row.type_name),
  description: row.type_description || null,
  status: row.status ? row.status.toLowerCase() : 'pending',
  fileUrl: row.file_url,
  createdAt: row.uploaded_at,
  updatedAt: row.updated_at || row.uploaded_at,
  reviewComment: row.hr_comment || null
});

async function getMyDocuments(workerId, companyId) {
  const result = await query(`
    SELECT d.id,
           d.file_url,
           d.status,
           d.hr_comment,
           d.uploaded_at,
           d.updated_at,
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

  return result.rows.map(serializeDocument);
}

module.exports = {
  getMyDocuments
};
