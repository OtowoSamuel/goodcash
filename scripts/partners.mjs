#!/usr/bin/env node
/**
 * GoodCash partner admin. YOU run this (it writes to the worker's KV store with your own wrangler login).
 * Keys are printed ONCE, here, and only their SHA-256 is stored. Nothing is sent anywhere else.
 *
 *   node scripts/partners.mjs create  --name "Acme Games" --origins https://acme.game,https://www.acme.game \
 *                                     [--apps com.acme.game] [--fee 0.5] [--logo https://...] [--accent "#7b39fc"]
 *   node scripts/partners.mjs list
 *   node scripts/partners.mjs show    <partnerId>
 *   node scripts/partners.mjs update  <partnerId> [--name ..] [--origins ..] [--apps ..] [--fee ..] [--logo ..] [--accent ..] [--topups on|off]
 *   node scripts/partners.mjs disable <partnerId>        (all its keys stop working at once)
 *   node scripts/partners.mjs enable  <partnerId>
 *   node scripts/partners.mjs rotate  <partnerId> --kind pk|sk --mode live|test   (old key stops working)
 *   node scripts/partners.mjs ledger  <partnerId> <YYYY-MM>   (fees earned that month, for the monthly payout)
 *   node scripts/partners.mjs approve-live <partnerId>   (a partner who got test keys themselves: approves LIVE keys; the worker emails them a one-time link within ~10 min)
 *   node scripts/partners.mjs approve-live <partnerId> --rotate  (a partner who already has live keys: revokes both at once, then the worker emails new ones)
 *   node scripts/partners.mjs approve-live <partnerId> --print   (makes the live keys here and prints them once, to send by hand)
 *   node scripts/partners.mjs secrets-key                (how to set PARTNER_SECRETS_KEY without seeing it)
 *
 * Add --dry-run to print what would be written instead of writing (keys are then shown masked).
 */
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../services/orders');
const MAX_PARTNER_FEE = 3;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const cmd = argv[0];
const positional = argv.filter((a, i) => i > 0 && !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
function flag(name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
}

function randomString(n) {
  const bytes = randomBytes(n * 2);
  let out = '';
  for (let i = 0; out.length < n && i < bytes.length; i++) if (bytes[i] < 248) out += ALPHABET[bytes[i] % 62];
  return out;
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

let wranglerMajor = null;
function remoteFlag() {
  if (wranglerMajor === null) {
    try {
      const v = execFileSync('npx', ['wrangler', '--version'], { cwd: WORKER_DIR, encoding: 'utf8' });
      wranglerMajor = Number(/(\d+)\.\d+\.\d+/.exec(v)?.[1] ?? '3');
    } catch {
      wranglerMajor = 3;
    }
  }
  // wrangler 4 defaults to local storage for kv commands; 3 writes to the real namespace
  return wranglerMajor >= 4 ? ['--remote'] : [];
}

function kv(args, input) {
  if (DRY) {
    console.log(`[dry-run] wrangler kv ${args.join(' ')}`);
    return '';
  }
  return execFileSync('npx', ['wrangler', 'kv', ...args, '--binding', 'ORDER_STORE', ...remoteFlag()], {
    cwd: WORKER_DIR,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}
const put = (key, value) => kv(['key', 'put', key, typeof value === 'string' ? value : JSON.stringify(value)]);
const get = (key) => {
  if (DRY) return null;
  try {
    const out = kv(['key', 'get', key]).trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
};
const del = (key) => kv(['key', 'delete', key]);

function parseList(v) {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function checkOrigins(list) {
  for (const o of list) {
    let u;
    try {
      u = new URL(o);
    } catch {
      throw new Error(`Not a web address: ${o}`);
    }
    if (u.origin !== o) throw new Error(`Use just the origin, like ${u.origin} (no path or trailing slash): ${o}`);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error(`Origins must be https (or http://localhost for development): ${o}`);
  }
  return list;
}

function checkFee(v) {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PARTNER_FEE) throw new Error(`--fee must be between 0 and ${MAX_PARTNER_FEE}`);
  return n;
}

function show(key) {
  return DRY ? `${key.slice(0, 15)}…(dry run, not stored)` : key;
}

const index_hasLive = (index) => !!(index && (index.pk_live || index.sk_live));

function makeKey(kind, mode) {
  return `gc_${kind}_${mode}_${randomString(40)}`;
}

async function issueKey(partnerId, kind, mode, keyIndex) {
  const key = makeKey(kind, mode);
  const hash = sha256(key);
  put(`key:${hash}`, { partnerId, kind, mode, createdAt: Date.now() });
  keyIndex[`${kind}_${mode}`] = hash;
  return key;
}

async function main() {
  switch (cmd) {
    case 'create': {
      const name = flag('name');
      if (!name) throw new Error('--name is required');
      const allowedOrigins = checkOrigins(parseList(flag('origins')));
      const appIds = parseList(flag('apps'));
      if (!allowedOrigins.length && !appIds.length) throw new Error('Give at least one --origins site or --apps id, or the publishable key cannot be used anywhere.');
      const id = `p_${randomString(12)}`;
      const partner = {
        id,
        name,
        enabled: true,
        allowedOrigins,
        appIds,
        feePercent: checkFee(flag('fee')) ?? 0,
        ...(flag('logo') ? { logoUrl: flag('logo') } : {}),
        ...(flag('accent') ? { accentColor: flag('accent') } : {}),
        createdAt: Date.now(),
      };
      put(`partner:${id}`, partner);
      const index = {};
      const keys = {};
      for (const mode of ['test', 'live']) for (const kind of ['pk', 'sk']) keys[`${kind}_${mode}`] = await issueKey(id, kind, mode, index);
      put(`partnerkeys:${id}`, index);
      console.log(`\nPartner created: ${name} (${id})\n`);
      console.log('Give the partner these keys over a private channel. They are shown ONCE and are not stored anywhere.\n');
      console.log(`  Test publishable  ${show(keys.pk_test)}`);
      console.log(`  Test secret       ${show(keys.sk_test)}`);
      console.log(`  Live publishable  ${show(keys.pk_live)}`);
      console.log(`  Live secret       ${show(keys.sk_live)}\n`);
      console.log('Publishable keys go in their app (only works from the sites/apps above). Secret keys stay on their server.');
      console.log('They set their webhook themselves: PUT https://api.goodcash.xyz/v1/webhooks with the secret key.\n');
      break;
    }
    case 'list': {
      if (DRY) return console.log('[dry-run] would list partner:* keys');
      const out = kv(['key', 'list', '--prefix', 'partner:']);
      const names = JSON.parse(out).map((k) => k.name);
      if (!names.length) return console.log('No partners yet.');
      for (const n of names) {
        const p = get(n);
        if (p) {
          const topups = p.topupEnabled ? '  [top-ups ON]' : '';
          const tag = topups + (p.selfServe ? (index_hasLive(get(`partnerkeys:${p.id}`)) ? '  [self-serve, live]' : p.liveRequestedAt ? '  [self-serve, LIVE REQUESTED]' : '  [self-serve, test]') : '');
          console.log(`${p.enabled ? 'ON ' : 'OFF'}  ${p.id}  ${p.name}  fee ${p.feePercent}%  sites: ${p.allowedOrigins.join(', ') || '-'}  apps: ${p.appIds.join(', ') || '-'}${tag}`);
        }
      }
      break;
    }
    case 'show': {
      const id = positional[0];
      const p = get(`partner:${id}`);
      if (!p) throw new Error(`No partner ${id}`);
      const { webhookSecretEnc, ...safe } = p;
      console.log(JSON.stringify({ ...safe, webhookSecretSet: { live: !!webhookSecretEnc?.live, test: !!webhookSecretEnc?.test } }, null, 2));
      break;
    }
    case 'update':
    case 'disable':
    case 'enable': {
      const id = positional[0];
      if (!id) throw new Error('Give the partner id');
      const p = DRY ? { id, name: 'dry', enabled: true, allowedOrigins: [], appIds: [], feePercent: 0 } : get(`partner:${id}`);
      if (!p) throw new Error(`No partner ${id}`);
      if (cmd === 'disable') p.enabled = false;
      if (cmd === 'enable') p.enabled = true;
      if (cmd === 'update') {
        if (flag('name')) p.name = flag('name');
        if (flag('origins') !== undefined) p.allowedOrigins = checkOrigins(parseList(flag('origins')));
        if (flag('apps') !== undefined) p.appIds = parseList(flag('apps'));
        if (flag('fee') !== undefined) p.feePercent = checkFee(flag('fee'));
        if (flag('logo')) p.logoUrl = flag('logo');
        if (flag('accent')) p.accentColor = flag('accent');
        if (flag('topups') !== undefined) {
          if (!['on', 'off'].includes(flag('topups'))) throw new Error('--topups must be on or off');
          p.topupEnabled = flag('topups') === 'on';
        }
      }
      put(`partner:${id}`, p);
      console.log(`${cmd === 'disable' ? 'Switched OFF' : cmd === 'enable' ? 'Switched ON' : 'Updated'}: ${p.name} (${id})`);
      break;
    }
    case 'rotate': {
      const id = positional[0];
      const kind = flag('kind');
      const mode = flag('mode');
      if (!id || !['pk', 'sk'].includes(kind) || !['live', 'test'].includes(mode)) throw new Error('Usage: rotate <partnerId> --kind pk|sk --mode live|test');
      const index = (DRY ? {} : get(`partnerkeys:${id}`)) ?? {};
      const old = index[`${kind}_${mode}`];
      const key = await issueKey(id, kind, mode, index);
      put(`partnerkeys:${id}`, index);
      if (old) del(`key:${old}`);
      console.log(`\nNew ${mode} ${kind === 'pk' ? 'publishable' : 'secret'} key (shown once): ${show(key)}\nThe old one has stopped working.\n`);
      break;
    }
    case 'approve-live': {
      const id = positional[0];
      if (!id) throw new Error('Usage: approve-live <partnerId> [--print]');
      const p = DRY ? { id, name: 'dry', enabled: true, contactEmail: 'dry@example.com' } : get(`partner:${id}`);
      if (!p) throw new Error(`No partner ${id}`);
      const index = (DRY ? {} : get(`partnerkeys:${id}`)) ?? {};
      if (index_hasLive(index)) {
        if (!argv.includes('--rotate')) throw new Error('This partner already has live keys. To replace BOTH and have the worker email the new ones as a one-time link, use: approve-live <partnerId> --rotate  (to replace one key by hand: rotate <partnerId> --kind pk|sk --mode live)');
        // Revoke the old live keys now (they stop working at once), then issue new ones the normal way
        for (const k of ['pk_live', 'sk_live']) {
          if (index[k]) {
            del(`key:${index[k]}`);
            delete index[k];
          }
        }
        put(`partnerkeys:${id}`, index);
        console.log(`Old live keys for ${p.name} (${id}) revoked.`);
      }
      if (!argv.includes('--print')) {
        // Default: the worker makes the keys and emails the partner a one-time link, so nothing is shown or sent by hand
        if (!p.contactEmail) throw new Error('This partner has no confirmed contact email. Use --print to make the keys here and send them yourself.');
        const queue = (DRY ? [] : get('liveapprove:queue')) ?? [];
        if (!queue.some((e) => e.id === id)) queue.push({ id, at: Date.now(), tries: 0 });
        put('liveapprove:queue', queue);
        console.log(`\nApproved: ${p.name} (${id}). Within about 10 minutes the worker emails ${p.contactEmail} a one-time link (24 hours) that shows the live keys once.`);
        console.log('Nothing to copy or send. You also get an email when it has gone out. Their live publishable key works only from: ' + ((p.allowedOrigins ?? []).join(', ') || '(no sites)'));
        console.log('Check first: they have finished the go-live checklist (docs/partners/go-live.md) and you have agreed the fee (update <id> --fee).\n');
        break;
      }
      const pk = await issueKey(id, 'pk', 'live', index);
      const sk = await issueKey(id, 'sk', 'live', index);
      put(`partnerkeys:${id}`, index);
      if (p.topupEnabled === undefined) put(`partner:${id}`, { ...p, topupEnabled: true }); // live keys come with top-ups (switch off with update --topups off)
      console.log(`\nLive keys issued for ${p.name} (${id}). Shown ONCE; give them over a private channel.\n`);
      console.log(`  Live publishable  ${show(pk)}`);
      console.log(`  Live secret       ${show(sk)}\n`);
      console.log(`Their live publishable key works only from: ${(p.allowedOrigins ?? []).join(', ') || '(no sites)'}`);
      if (p.contactEmail) console.log(`Contact: ${p.contactEmail}`);
      console.log('Check first: they have finished the go-live checklist (docs/partners/go-live.md) and you have agreed the fee.\n');
      break;
    }
    case 'ledger': {
      const [id, month] = positional;
      if (!id || !/^\d{4}-\d{2}$/.test(month ?? '')) throw new Error('Usage: ledger <partnerId> <YYYY-MM>');
      if (DRY) return console.log(`[dry-run] would total ledger:${id}:${month}:*`);
      const names = JSON.parse(kv(['key', 'list', '--prefix', `ledger:${id}:${month}:`])).map((k) => k.name);
      let partner = 0;
      let goodcash = 0;
      let notCharged = 0;
      for (const n of names) {
        const e = get(n);
        if (!e) continue;
        partner += e.partnerFeeUsdt;
        goodcash += e.goodcashFeeUsdt;
        if (!e.feeCharged) notCharged++;
      }
      console.log(`${id} ${month}: ${names.length} paid cash outs`);
      console.log(`  Partner's share to pay out:  $${partner.toFixed(4)} (USDT, from the GoodCash Safe)`);
      console.log(`  GoodCash's share:            $${goodcash.toFixed(4)}`);
      if (notCharged) console.log(`  ${notCharged} cash out(s) went through without the fee (the payout partner refused it): nothing owed on those.`);
      break;
    }
    case 'secrets-key': {
      console.log('Run this yourself in services/orders. It makes a random key and stores it as a secret without showing it:\n');
      console.log('  openssl rand -base64 32 | npx wrangler secret put PARTNER_SECRETS_KEY\n');
      console.log('Do it once. Changing it later makes existing webhook secrets unreadable (partners would need to rotate).');
      break;
    }
    default:
      console.log(fileURLToPath(import.meta.url));
      console.log('Commands: create, list, show, update, disable, enable, rotate, approve-live, ledger, secrets-key (add --dry-run to try safely)');
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
