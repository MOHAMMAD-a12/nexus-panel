// build/deploy-bundle.mjs — produces the deploy-bot's fetchable artifacts.
//
// The deploy-bot worker cannot run esbuild (it runs on Cloudflare Workers, not Node),
// so we pre-build the panel into a single ESM bundle + an assets manifest here, locally
// or in CI. The bot then downloads these from the project's GitHub raw URL and uploads
// them onto each end-user's Cloudflare account.
//
// Usage: `npm run bundle`  (writes dist/nexus-panel.mjs + dist/assets-manifest.json)

import { build } from 'esbuild';
import { readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const OUT_DIR = 'dist';
const PUBLIC_DIR = 'public';

mkdirSync(OUT_DIR, { recursive: true });

// ── 1) Bundle the panel worker into a single ESM file ──
await build({
  entryPoints: ['src/worker/index.js'],
  bundle: true,
  format: 'esm',
  platform: 'neutral', // no Node built-ins assumed; crypto etc. are runtime globals
  target: ['es2022'],
  conditions: ['worker', 'browser'],
  mainFields: ['browser', 'module', 'main'],
  minify: false, // keep readable for now; flip to true later if size matters
  sourcemap: false,
  outfile: join(OUT_DIR, 'nexus-panel.mjs'),
  logLevel: 'info',
  // external: [] — inline everything; the panel uses only Web Crypto / runtime globals.
});

// ── 2) Walk public/ into an assets manifest ──
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(PUBLIC_DIR);

const manifest = files.map((p) => {
  const rel = relative(PUBLIC_DIR, p).split('\\').join('/'); // normalize Windows paths
  const path = '/' + rel;
  return {
    path,
    file: relative('.', p).split('\\').join('/'),
    contentType: CONTENT_TYPES[extname(p).toLowerCase()] || 'application/octet-stream',
  };
});

writeFileSync(join(OUT_DIR, 'assets-manifest.json'), JSON.stringify(manifest, null, 2));

// ── 3) Bundle every dashboard file into ONE JSON payload ──
// The bot runs on a Cloudflare Worker with a hard per-invocation subrequest cap (50 on
// the free tier). Downloading each of the ~32 static files individually would blow that
// cap. Instead we inline every file's base64 content into a single artifact so the bot
// makes ONE fetch and then bulk-writes the lot to the user's KV in a couple of calls.
const { readFileSync } = await import('node:fs');
const dashboardFiles = manifest.map((m) => {
  const raw = readFileSync(m.file);
  return {
    path: m.path,
    contentType: m.contentType,
    // base64 keeps binary (png/woff/ico) safe inside JSON.
    content: raw.toString('base64'),
  };
});
writeFileSync(
  join(OUT_DIR, 'dashboard-files.json'),
  JSON.stringify(dashboardFiles)
);

console.log(
  `[deploy-bundle] wrote dist/nexus-panel.mjs + dist/assets-manifest.json + dist/dashboard-files.json (${manifest.length} static assets)`
);
