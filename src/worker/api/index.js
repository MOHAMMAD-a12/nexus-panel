// api/index.js — registers all routes into a Router instance
import { Router } from './router.js';

import * as auth from './routes/auth.js';
import * as health from './routes/health.js';
import * as dashboard from './routes/dashboard.js';
import * as domains from './routes/domains.js';
import * as dns from './routes/dns.js';
import * as nodes from './routes/nodes.js';
import * as configs from './routes/configs.js';
import * as generate from './routes/generate.js';
import * as templates from './routes/templates.js';
import * as generated from './routes/generated.js';
import * as endpoints from './routes/endpoints.js';
import * as cloudflare from './routes/cloudflare.js';
import * as subscriptions from './routes/subscriptions.js';
import * as users from './routes/users.js';
import * as apikeys from './routes/apikeys.js';
import * as logs from './routes/logs.js';
import * as settings from './routes/settings.js';
import * as notifications from './routes/notifications.js';

export function buildRouter() {
  const r = new Router();

  // Auth
  r.post('/api/auth/login', auth.login);
  r.post('/api/auth/logout', auth.logout);
  r.get('/api/auth/me', auth.me);

  // Health (public, no auth — but rate limited)
  r.get('/api/health', health.health);

  // Dashboard
  r.get('/api/dashboard', dashboard.getDashboard);

  // Domains
  r.get('/api/domains', domains.listDomains);
  r.post('/api/domains', domains.createDomain);
  r.get('/api/domains/sync', domains.syncCloudflareZones);
  r.get('/api/domains/:id', domains.getDomain);
  r.put('/api/domains/:id', domains.updateDomain);
  r.del('/api/domains/:id', domains.deleteDomain);
  r.post('/api/domains/:id/verify', domains.verifyDomain);

  // DNS (nested under domain)
  r.get('/api/domains/:id/dns', dns.listDns);
  r.post('/api/domains/:id/dns', dns.createDns);
  r.patch('/api/domains/:id/dns/:recordId', dns.updateDns);
  r.del('/api/domains/:id/dns/:recordId', dns.deleteDns);
  r.post('/api/domains/:id/dns/:recordId/proxy', dns.toggleProxy);

  // Nodes
  r.get('/api/nodes', nodes.listNodes);
  r.post('/api/nodes', nodes.createNode);
  r.get('/api/nodes/:id', nodes.getNode);
  r.put('/api/nodes/:id', nodes.updateNode);
  r.del('/api/nodes/:id', nodes.deleteNode);
  r.post('/api/nodes/:id/duplicate', nodes.duplicateNode);
  r.post('/api/nodes/:id/health', nodes.healthCheck);
  r.post('/api/nodes/:id/ping', nodes.pingNode);

  // Configs
  r.get('/api/configs', configs.listConfigs);
  r.get('/api/protocols', configs.listProtocolsRoute);
  r.post('/api/configs/generate', configs.generateConfigRoute);
  r.post('/api/configs', configs.createConfig);
  r.get('/api/configs/:id', configs.getConfigRoute);
  r.put('/api/configs/:id', configs.updateConfig);
  r.del('/api/configs/:id', configs.deleteConfig);

  // Generation (NEXUS core)
  r.post('/api/generate/:protocol', generate.generateByProtocol);
  r.post('/api/generate/batch', generate.generateBatch);

  // Templates
  r.get('/api/templates', templates.listTemplates);
  r.post('/api/templates', templates.createTemplate);
  r.post('/api/templates/:id/duplicate', templates.duplicateTemplate);
  r.get('/api/templates/:id', templates.getTemplate);
  r.put('/api/templates/:id', templates.updateTemplate);
  r.del('/api/templates/:id', templates.deleteTemplate);

  // Generated configs (history)
  r.get('/api/generated', generated.listGenerated);
  r.get('/api/generated/:id', generated.getGenerated);
  r.del('/api/generated/:id', generated.deleteGenerated);

  // Endpoints (location builder)
  r.get('/api/endpoints', endpoints.listEndpoints);
  r.post('/api/endpoints', endpoints.createEndpoint);
  r.get('/api/endpoints/:id', endpoints.getEndpoint);
  r.put('/api/endpoints/:id', endpoints.updateEndpoint);
  r.del('/api/endpoints/:id', endpoints.deleteEndpoint);

  // Cloudflare connection (token never returned to client)
  r.get('/api/cloudflare/connection', cloudflare.getConnectionRoute);
  r.post('/api/cloudflare/test', cloudflare.testRoute);
  r.post('/api/cloudflare/save', cloudflare.saveRoute);
  r.post('/api/cloudflare/disconnect', cloudflare.disconnectRoute);
  r.post('/api/cloudflare/refresh', cloudflare.refreshRoute);

  // Subscriptions
  r.get('/api/subscriptions', subscriptions.listSubs);
  r.post('/api/subscriptions', subscriptions.createSub);
  r.get('/api/subscriptions/:id', subscriptions.getSub);
  r.put('/api/subscriptions/:id', subscriptions.updateSub);
  r.del('/api/subscriptions/:id', subscriptions.deleteSub);
  r.post('/api/subscriptions/:id/regenerate', subscriptions.regenerateSub);
  r.get('/api/subscriptions/:id/link', subscriptions.getSubscriptionLink);

  // Users
  r.get('/api/users', users.listUsers);
  r.post('/api/users', users.createUser);
  r.get('/api/users/:id', users.getUser);
  r.put('/api/users/:id', users.updateUser);
  r.del('/api/users/:id', users.deleteUser);

  // API keys
  r.get('/api/apikeys', apikeys.listKeys);
  r.post('/api/apikeys', apikeys.createKey);
  r.del('/api/apikeys/:id', apikeys.deleteKey);
  r.post('/api/apikeys/:id/rotate', apikeys.rotateKey);

  // Logs
  r.get('/api/logs', logs.listLogs);
  r.get('/api/logs/export', logs.exportLogs);

  // Settings + credentials
  r.get('/api/settings', settings.getSettings);
  r.get('/api/settings/:group', settings.getSettingGroup);
  r.put('/api/settings/:group', settings.updateSettingGroup);
  r.get('/api/credentials', settings.listCredentialsRoute);
  r.post('/api/credentials', settings.addCredentialRoute);
  r.post('/api/credentials/:id/rotate', settings.rotateCredentialRoute);
  r.del('/api/credentials/:id', settings.deleteCredentialRoute);

  // Notifications
  r.get('/api/notifications', notifications.listNotificationsRoute);
  r.post('/api/notifications/:id/read', notifications.markReadRoute);
  r.post('/api/notifications/:id/delete', notifications.deleteNotificationRoute);
  r.post('/api/notifications/read-all', notifications.markAllReadRoute);

  return r;
}
