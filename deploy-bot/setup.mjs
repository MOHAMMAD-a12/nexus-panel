// deploy-bot/setup.mjs — one-shot automated setup for the Nexus Deploy Bot.
//
// It does everything for you in a single command:
//   1) creates the BOT_KV namespace and writes its id into wrangler.toml
//   2) sets BOT_TOKEN + BOT_ENCRYPTION_KEY secrets
//   3) writes PROJECT_RAW_BASE into wrangler.toml
//   4) deploys the bot worker
//   5) registers the Telegram webhook automatically
//
// Prerequisites (install once):
//   npm i -g wrangler
//   wrangler login
//   node --version   (needs Node 18+ for global fetch)
//
// Interactive:
//   node deploy-bot/setup.mjs
//
// Non-interactive (CI / copy-paste): set env vars first, then run.
//   BOT_TOKEN=... BOT_ENCRYPTION_KEY=... PROJECT_RAW_BASE=... node deploy-bot/setup.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(__dirname, 'wrangler.toml');
const CONFIG_REL = 'deploy-bot/wrangler.toml';

function run(cmd, args, { inputText = null, silent = false } = {}) {
  const res = execFileSync(cmd, args, {
    input: inputText ?? undefined,
    encoding: 'utf8',
    stdio: silent ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });
  return res;
}

function patchToml(patches) {
  let txt = readFileSync(CONFIG, 'utf8');
  for (const [find, replace] of patches) {
    if (!txt.includes(find)) {
      console.warn(`  ⚠️  Could not find marker: ${find} — edit wrangler.toml manually.`);
      continue;
    }
    txt = txt.replace(find, replace);
  }
  writeFileSync(CONFIG, txt);
}

function ask(rl, question, { secret = false, fallback = '' } = {}) {
  return rl.question(question).then((ans) => (ans.trim() || fallback).trim());
}

async function main() {
  const rl = readline.createInterface({ input, output });

  const botToken = process.env.BOT_TOKEN || (await ask(rl, '🤖 Telegram BOT_TOKEN (از @BotFather): '));
  const encKey =
    process.env.BOT_ENCRYPTION_KEY ||
    (await ask(rl, '🔑 BOT_ENCRYPTION_KEY (یک رشته ۳۲ کاراکتری تصادفی): '));
  const rawBase =
    process.env.PROJECT_RAW_BASE ||
    (await ask(rl, '🌐 PROJECT_RAW_BASE (مثال: https://raw.githubusercontent.com/OWNER/REPO/main): '));

  if (!botToken || !encKey || !rawBase) {
    console.error('❌ هر سه مقدار لازم است. خارج شدم.');
    process.exit(1);
  }

  console.log('\n📦 1) ساخت namespaceی BOT_KV…');
  const kvOut = run('wrangler', ['kv', 'namespace', 'create', 'BOT_KV', '--config', CONFIG_REL], {
    silent: true,
  });
  const kvId = (kvOut.match(/id\s*=\s*"([0-9a-f]+)"/i) || [])[1];
  if (!kvId) {
    console.error('❌ نتوانستم id را از خروجی wrangler بخوانم. خروجی:\n' + kvOut);
    process.exit(1);
  }
  console.log('   ✅ BOT_KV id =', kvId);

  console.log('✏️  2) نوشتن id و PROJECT_RAW_BASE در wrangler.toml…');
  patchToml([
    ['id = "REPLACE_WITH_YOUR_BOT_KV_ID"', `id = "${kvId}"`],
    [
      /PROJECT_RAW_BASE\s*=\s*"[^"]*"/,
      `PROJECT_RAW_BASE = "${rawBase.replace(/\/+$/, '')}"`,
    ],
  ]);
  console.log('   ✅ wrangler.toml آپدیت شد.');

  console.log('🔐 3) تنظیم سکرت‌ها (BOT_TOKEN , BOT_ENCRYPTION_KEY)…');
  run('wrangler', ['secret', 'put', 'BOT_TOKEN', '--config', CONFIG_REL], { inputText: botToken + '\n' });
  run('wrangler', ['secret', 'put', 'BOT_ENCRYPTION_KEY', '--config', CONFIG_REL], {
    inputText: encKey + '\n',
  });
  console.log('   ✅ سکرت‌ها تنظیم شدند.');

  console.log('🚀 4) دیپلوی ربات…');
  const deployOut = run('wrangler', ['deploy', '--config', CONFIG_REL], { silent: true });
  const workerUrl = (deployOut.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/gi) || [])[0];
  if (!workerUrl) {
    console.error('❌ نتوانستم آدرس ورکر را از خروجی بخوانم. خروجی:\n' + deployOut);
    process.exit(1);
  }
  console.log('   ✅ ربات دیپلوی شد در:', workerUrl);

  console.log('🔗 5) ثبت خودکار وب‌هوک تلگرام…');
  const webhookUrl = `${workerUrl}/`;
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] }),
  });
  const j = await resp.json().catch(() => ({}));
  if (j.ok) {
    console.log('   ✅ وب‌هوک ثبت شد:', webhookUrl);
  } else {
    console.warn('   ⚠️  ثبت وب‌هوک ناموفق بود (کد خطا در پایین). دستی اجرا کنید:');
    console.warn(`   curl "https://api.telegram.org/bot${botToken}/setWebhook?url=${webhookUrl}"`);
  }

  console.log('\n🎉 تمام! در تلگرام /start بزنید.');
  console.log(`   سلامت: curl ${workerUrl}/health`);
  rl.close();
}

main().catch((e) => {
  console.error('💥 خطا:', e.message);
  process.exit(1);
});
