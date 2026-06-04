const { query } = require('../config/database');
const { insertReturning, updateReturning } = require('../utils/db.util');

function getDb(db = null) {
  return db || { query };
}

async function findUserById(userId, companyId, db = null) {
  const client = getDb(db);
  const result = await client.query(
    `SELECT *
     FROM users
     WHERE id = $1
       AND (company_id = $2 OR company_id IS NULL)
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId, companyId]
  );
  return result.rows[0] || null;
}

async function findWorkerById(workerId, companyId, db = null) {
  const client = getDb(db);
  const result = await client.query(
    `SELECT *
     FROM workers
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );
  return result.rows[0] || null;
}

async function findWorkerByUserId(userId, companyId, db = null) {
  const client = getDb(db);
  const result = await client.query(
    `SELECT *
     FROM workers
     WHERE user_id = $1
       AND company_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId, companyId]
  );
  return result.rows[0] || null;
}

async function findWorkerIdentityByUserId(userId, companyId, db = null) {
  const client = getDb(db);
  const result = await client.query(
    `SELECT id,
            id AS worker_id,
            user_id,
            document_number,
            personal_id
     FROM workers
     WHERE user_id = $1
       AND company_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId, companyId]
  );
  return result.rows[0] || null;
}

async function findWorkerIdentityByWorkerId(workerId, companyId, db = null) {
  const client = getDb(db);
  const result = await client.query(
    `SELECT id,
            id AS worker_id,
            user_id,
            document_number,
            personal_id
     FROM workers
     WHERE id = $1
       AND company_id = $2
       AND deleted_at IS NULL
     LIMIT 1`,
    [workerId, companyId]
  );
  return result.rows[0] || null;
}

async function existsUsername(companyId, username, excludeUserId = null, db = null) {
  const client = getDb(db);
  const queryStr = excludeUserId
    ? `SELECT id FROM users WHERE company_id = $1 AND LOWER(username) = LOWER($2) AND id != $3 AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM users WHERE company_id = $1 AND LOWER(username) = LOWER($2) AND deleted_at IS NULL LIMIT 1`;
  const params = excludeUserId ? [companyId, username, excludeUserId] : [companyId, username];
  const result = await client.query(queryStr, params);
  return result.rows.length > 0;
}

async function existsEmail(companyId, email, excludeUserId = null, db = null) {
  const client = getDb(db);
  const queryStr = excludeUserId
    ? `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND (company_id = $2 OR company_id IS NULL) AND id != $3 AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND (company_id = $2 OR company_id IS NULL) AND deleted_at IS NULL LIMIT 1`;
  const params = excludeUserId ? [email, companyId, excludeUserId] : [email, companyId];
  const result = await client.query(queryStr, params);
  return result.rows.length > 0;
}

async function existsDni(companyId, documentNumber, excludeWorkerId = null, db = null) {
  const client = getDb(db);
  const queryStr = excludeWorkerId
    ? `SELECT id FROM workers WHERE company_id = $1 AND document_number = $2 AND id != $3 AND deleted_at IS NULL LIMIT 1`
    : `SELECT id FROM workers WHERE company_id = $1 AND document_number = $2 AND deleted_at IS NULL LIMIT 1`;
  const params = excludeWorkerId ? [companyId, documentNumber, excludeWorkerId] : [companyId, documentNumber];
  const result = await client.query(queryStr, params);
  return result.rows.length > 0;
}

async function createWorker(data, db = null) {
  return insertReturning(getDb(db), 'workers', data);
}

async function updateWorker(workerId, data, db = null) {
  return updateReturning(getDb(db), 'workers', 'id', workerId, data);
}

async function upsertWorkerByUserId(userId, companyId, data, db = null) {
  const existing = await findWorkerByUserId(userId, companyId, db);
  if (existing) {
    return updateWorker(existing.id, data, db);
  }
  return createWorker({ ...data, user_id: userId, company_id: companyId }, db);
}

module.exports = {
  findUserById,
  findWorkerById,
  findWorkerByUserId,
  findWorkerIdentityByUserId,
  findWorkerIdentityByWorkerId,
  existsUsername,
  existsEmail,
  existsDni,
  createWorker,
  updateWorker,
  upsertWorkerByUserId
};
