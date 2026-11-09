/**
 * Webhook endpoint example (no framework):
 *   GOODCASH_WEBHOOK_SECRET=whsec_... node webhook.mjs
 * Then set it with: PUT https://api.goodcash.xyz/v1/webhooks  { "url": "https://<your-host>/goodcash" }
 */
import { createServer } from 'node:http';
import { verifyWebhook } from '@goodcash/sdk/server';

const seen = new Set(); // use your database in production

createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/goodcash') return res.writeHead(404).end();
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8'); // the RAW body, before any JSON parsing
  try {
    const event = await verifyWebhook(raw, req.headers['goodcash-signature'], process.env.GOODCASH_WEBHOOK_SECRET);
    if (!seen.has(event.id)) {
      seen.add(event.id);
      console.log(event.type, event.data?.id, event.data?.partnerRef);
    }
    res.writeHead(200).end('ok');
  } catch (e) {
    console.warn('rejected webhook:', e.detail ?? e.message);
    res.writeHead(400).end();
  }
}).listen(3000, () => console.log('Listening on http://localhost:3000/goodcash'));
