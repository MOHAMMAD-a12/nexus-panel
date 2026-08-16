// services/notifications.js — notification center + alert creation
import { randomId } from '../utils/id.js';
import { nowSec } from '../database/db.js';

const MAX_NOTIFICATIONS = 500;

export async function createNotification(db, { type, severity = 'info', title, message, resource, resourceId }) {
  const id = randomId('ntf', 10);
  const ts = nowSec();
  await db
    .prepare(
      `INSERT INTO notifications (id, type, severity, title, message, resource, resource_id, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    )
    .bind(id, type, severity, title, message, resource || null, resourceId || null, ts)
    .run();

  // Trim old notifications
  const total = await db.prepare('SELECT COUNT(*) as c FROM notifications').first();
  if (total.c > MAX_NOTIFICATIONS) {
    const excess = total.c - MAX_NOTIFICATIONS;
    await db
      .prepare(`DELETE FROM notifications WHERE id IN (SELECT id FROM notifications ORDER BY created_at ASC LIMIT ?)`)
      .bind(excess)
      .run();
  }
  return id;
}

export async function listNotifications(db, { unreadOnly = false, limit = 50, offset = 0 } = {}) {
  const where = unreadOnly ? 'WHERE read = 0' : '';
  const rows = await db
    .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all();
  const total = await db
    .prepare(`SELECT COUNT(*) as c FROM notifications ${where}`)
    .first();
  return { rows: rows.results || [], total: total.c };
}

export async function markRead(db, id) {
  await db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').bind(id).run();
}

export async function markAllRead(db) {
  await db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
}

// Helper used by scheduled jobs
export async function alert(db, type, title, message, severity, resource, resourceId) {
  return createNotification(db, { type, title, message, severity, resource, resourceId });
}
