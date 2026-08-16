// auth/permissions.js — granular permission model

export const PERMISSIONS = [
  'dashboard.read',
  'domains.read',
  'domains.write',
  'dns.read',
  'dns.write',
  'nodes.read',
  'nodes.write',
  'configs.read',
  'configs.write',
  'subscriptions.read',
  'subscriptions.write',
  'users.read',
  'users.write',
  'apikeys.read',
  'apikeys.write',
  'logs.read',
  'settings.read',
  'settings.write',
  'cloudflare.read',
  'cloudflare.write',
  'notifications.read',
];

export function hasPermission(user, permission) {
  if (!user) return false;
  const perms = user.permissions || [];
  if (perms.includes('*')) return true;
  if (perms.includes(permission)) return true;
  // wildcard category match, e.g. "nodes.*"
  const [cat] = permission.split('.');
  if (perms.includes(`${cat}.*`)) return true;
  return false;
}

export function hasAnyPermission(user, list) {
  return list.some((p) => hasPermission(user, p));
}

export function requirePermission(user, permission) {
  if (!hasPermission(user, permission)) {
    const err = new Error('Permission denied');
    err.status = 403;
    err.code = 'forbidden';
    throw err;
  }
}

export async function loadRolePermissions(db, roleId) {
  const row = await db.prepare('SELECT permissions FROM roles WHERE id = ?').bind(roleId).first();
  if (!row) return [];
  try {
    return JSON.parse(row.permissions);
  } catch {
    return [];
  }
}
