const { query } = require('../config/database');

const tableColumnsCache = new Map();

async function getTableColumns(tableName, db = { query }) {
  const cacheKey = tableName;
  if (tableColumnsCache.has(cacheKey)) {
    return tableColumnsCache.get(cacheKey);
  }

  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName]
  );

  const columns = new Set(result.rows.map((row) => row.column_name));
  tableColumnsCache.set(cacheKey, columns);
  return columns;
}

async function tableHasColumn(tableName, columnName, db = { query }) {
  const columns = await getTableColumns(tableName, db);
  return columns.has(columnName);
}

async function insertReturning(db, tableName, values, returning = '*') {
  const columns = await getTableColumns(tableName, db);
  const entries = Object.entries(values)
    .filter(([key, value]) => columns.has(key) && value !== undefined);

  if (entries.length === 0) {
    throw new Error(`No hay columnas válidas para insertar en ${tableName}.`);
  }

  const columnSql = entries.map(([key]) => key).join(', ');
  const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
  const params = entries.map(([, value]) => value);

  const result = await db.query(
    `INSERT INTO ${tableName} (${columnSql}) VALUES (${placeholders}) RETURNING ${returning}`,
    params
  );

  return result.rows[0];
}

async function updateReturning(db, tableName, idColumn, idValue, values, returning = '*') {
  const columns = await getTableColumns(tableName, db);
  const entries = Object.entries(values)
    .filter(([key, value]) => columns.has(key) && value !== undefined);

  if (entries.length === 0) {
    const result = await db.query(`SELECT ${returning} FROM ${tableName} WHERE ${idColumn} = $1`, [idValue]);
    return result.rows[0] || null;
  }

  const setSql = entries.map(([key], index) => `${key} = $${index + 1}`).join(', ');
  const params = entries.map(([, value]) => value);
  params.push(idValue);

  const result = await db.query(
    `UPDATE ${tableName} SET ${setSql} WHERE ${idColumn} = $${params.length} RETURNING ${returning}`,
    params
  );

  return result.rows[0];
}

module.exports = {
  getTableColumns,
  tableHasColumn,
  insertReturning,
  updateReturning
};
