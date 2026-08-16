// utils/validate.js — input validation helpers (no external deps)

export function isString(v, opts = {}) {
  if (typeof v !== 'string') return false;
  if (opts.min && v.length < opts.min) return false;
  if (opts.max && v.length > opts.max) return false;
  if (opts.pattern && !opts.pattern.test(v)) return false;
  return true;
}

export function isInt(v, opts = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) return false;
  if (opts.min !== undefined && n < opts.min) return false;
  if (opts.max !== undefined && n > opts.max) return false;
  return true;
}

export function isIn(v, arr) {
  return arr.includes(v);
}

export function isEmail(v) {
  if (typeof v !== 'string' || v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function isArray(v) {
  return Array.isArray(v);
}

export function isBool(v) {
  return typeof v === 'boolean' || v === '0' || v === '1' || v === 0 || v === 1;
}

export function toBool(v) {
  return v === true || v === '1' || v === 1 || v === 'true';
}

export function optional(value, fn, defaultVal) {
  if (value === undefined || value === null || value === '') return { ok: true, value: defaultVal };
  return fn(value) ? { ok: true, value } : { ok: false, error: 'invalid' };
}

// Validate an object against a schema of rule functions.
// A rule returns true (valid, keep value), false (invalid), or
// { ok:true, value } / { ok:false, error } for transformations.
export function validateBody(body, schema, { allowUnknown = false } = {}) {
  const errors = {};
  const clean = {};
  for (const [field, rule] of Object.entries(schema)) {
    const value = body ? body[field] : undefined;
    const res = typeof rule === 'function' ? rule(value) : rule;
    if (res === false) errors[field] = 'invalid';
    else if (res === true) clean[field] = value;
    else if (res && res.ok) clean[field] = res.value;
    else if (res) errors[field] = res.error || 'invalid';
  }
  if (!allowUnknown && body) {
    for (const key of Object.keys(body)) {
      if (!(key in schema)) errors[key] = 'unknown_field';
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, clean };
}

export function parseJsonBody(request) {
  return request.json().catch(() => null);
}
