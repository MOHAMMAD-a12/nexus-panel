// api/routes/notifications.js
import { ok } from '../../utils/response.js';
import { authenticate } from '../../auth/auth.js';
import { hasPermission } from '../../auth/permissions.js';
import { listNotifications, markRead, markAllRead } from '../../services/notifications.js';

export async function listNotificationsRoute(ctx) {
  await authenticate(ctx);
  if (!hasPermission(ctx.user, 'notifications.read')) throw new Error('forbidden');
  const url = new URL(ctx.request.url);
  const unreadOnly = url.searchParams.get('unread') === '1';
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '30', 10));
  const { rows, total } = await listNotifications(ctx.db, { unreadOnly, limit });
  const unread = rows.filter((r) => !r.read).length;
  return ok({ items: rows, total, unread });
}

export async function markReadRoute(ctx) {
  await authenticate(ctx);
  await markRead(ctx.db, ctx.params.id);
  return ok({ id: ctx.params.id });
}

export async function deleteNotificationRoute(ctx) {
  await authenticate(ctx);
  await ctx.db.prepare('DELETE FROM notifications WHERE id = ?').bind(ctx.params.id).run();
  return ok({ id: ctx.params.id });
}

export async function markAllReadRoute(ctx) {
  await authenticate(ctx);
  await markAllRead(ctx.db);
  return ok({ ok: true });
}
