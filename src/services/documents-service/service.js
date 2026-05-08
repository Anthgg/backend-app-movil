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

async function getCompanyDocuments(companyId, filters = {}) {
  const page = Math.max(parseInt(filters.page, 10) || 1, 1);
  const limit = Math.max(parseInt(filters.limit, 10) || 20, 1);
  const offset = (page - 1) * limit;
  const params = [companyId];
  const whereClauses = ['w.company_id = $1', 'w.deleted_at IS NULL'];
  let paramIndex = 2;

  if (filters.worker_id) {
    whereClauses.push(`d.worker_id = $${paramIndex++}`);
    params.push(filters.worker_id);
  }

  if (filters.status) {
    whereClauses.push(`LOWER(d.status) = LOWER($${paramIndex++})`);
    params.push(filters.status);
  }

  if (filters.document_type_id) {
    whereClauses.push(`d.document_type_id = $${paramIndex++}`);
    params.push(filters.document_type_id);
  }

  const whereSql = whereClauses.join(' AND ');

  const dataQuery = `
    SELECT d.id,
           d.worker_id,
           d.document_type_id,
           d.file_url,
           d.status,
           d.hr_comment,
           d.uploaded_at,
           d.updated_at,
           dt.name AS type_name,
           dt.description AS type_description,
           CONCAT_WS(' ', u.first_name, u.last_name) AS worker_name,
           u.email AS worker_email
    FROM documents d
    JOIN workers w ON w.id = d.worker_id
    JOIN users u ON u.id = w.user_id
    LEFT JOIN document_types dt ON dt.id = d.document_type_id
    WHERE ${whereSql}
    ORDER BY COALESCE(d.updated_at, d.uploaded_at) DESC, d.id DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM documents d
    JOIN workers w ON w.id = d.worker_id
    WHERE ${whereSql}
  `;

  const [dataRes, countRes] = await Promise.all([
    query(dataQuery, [...params, limit, offset]),
    query(countQuery, params)
  ]);

  return {
    documents: dataRes.rows.map((row) => ({
      ...serializeDocument(row),
      workerId: row.worker_id,
      workerName: row.worker_name,
      workerEmail: row.worker_email,
      documentTypeId: row.document_type_id
    })),
    pagination: {
      total: parseInt(countRes.rows[0]?.total || 0, 10),
      page,
      limit,
      totalPages: Math.ceil(parseInt(countRes.rows[0]?.total || 0, 10) / limit)
    }
  };
}

module.exports = {
  getMyDocuments,
  getCompanyDocuments
};
