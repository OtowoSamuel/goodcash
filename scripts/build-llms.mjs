// Builds docs/partners/llms-full.txt from the partner docs, so it never drifts from them.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/partners');
const parts = ['llms.txt', 'README.md', 'quickstarts/ai-builder.md', 'quickstarts/game.md', 'quickstarts/react.md', 'quickstarts/react-native.md', 'quickstarts/fintech-server.md', 'FEES.md', 'test-mode.md', 'webhooks.md', 'errors.md', 'go-live.md'];
const out = parts.map((p) => `\n\n<!-- ${p} -->\n\n${readFileSync(path.join(dir, p), 'utf8').trim()}`).join('');
writeFileSync(path.join(dir, 'llms-full.txt'), `# GoodCash Partner API: full reference for AI coding tools\n(Generated from docs/partners by scripts/build-llms.mjs. The API reference is openapi.yaml.)${out}\n`);
console.log('wrote llms-full.txt');
