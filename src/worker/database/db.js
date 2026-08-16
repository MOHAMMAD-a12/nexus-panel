// database/db.js — D1 helpers + JSON column (de)serialization

function replacer(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (key.endsWith('_json') || key === 'permissions' || key === 'tags' || key === 'configs' || key === 'nameservers' || key === 'metadata') {
      if (typeof out[key] === 'string') {
        try {
          out[key] = JSON.parse(out[key]);
        } catch {
          out[key] = [];
        }
      }
    }
  }
  return out;
}

export async function query(db, sql, params = []) {
  const res = await db.prepare(sql).bind(...params).all();
  return (res.results || []).map(replacer);
}

export async function queryOne(db, sql, params = []) {
  const res = await db.prepare(sql).bind(...params).first();
  return res ? replacer(res) : null;
}

export async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

export async function insert(db, table, data) {
  const cols = Object.keys(data);
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;
  return run(db, sql, cols.map((c) => serialize(data[c])));
}

export async function update(db, table, id, data, idColumn = 'id') {
  const cols = Object.keys(data).filter((c) => data[c] !== undefined);
  if (cols.length === 0) return { meta: { changes: 0 } };
  const setClause = cols.map((c) => `${c} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${setClause} WHERE ${idColumn} = ?`;
  return run(db, sql, [...cols.map((c) => serialize(data[c])), id]);
}

export async function remove(db, table, id, idColumn = 'id') {
  return run(db, `DELETE FROM ${table} WHERE ${idColumn} = ?`, [id]);
}

export async function count(db, table, where = '', params = []) {
  const sql = `SELECT COUNT(*) as c FROM ${table} ${where}`.trim();
  const res = await db.prepare(sql).bind(...params).first();
  return res ? res.c : 0;
}

export function serialize(value) {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return value;
}

export function nowMs() {
  return Date.now();
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}
