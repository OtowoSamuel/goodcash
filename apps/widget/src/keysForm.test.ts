// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SRC = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/docs-assets/keys.js'), 'utf8');

function page() {
  document.body.innerHTML = `<form id="gcd-form"><input id="gcd-name" value="Jara"><input id="gcd-email" value="a@b.example"><textarea id="gcd-origins"></textarea><button id="gcd-submit"></button></form><p id="gcd-msg" hidden></p>`;
}

async function submit(websites: string) {
  page();
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'check_your_email' }), { status: 200 }));
  (window as unknown as { fetch: unknown }).fetch = fetchMock;
  new Function(SRC)();
  (document.getElementById('gcd-origins') as HTMLTextAreaElement).value = websites;
  document.getElementById('gcd-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { origins: string[] };
  return { sent: body.origins, shown: (document.getElementById('gcd-origins') as HTMLTextAreaElement).value };
}

describe('Get test keys form: website addresses', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('adds https:// to a bare domain (the mistake that blocked a partner)', async () => {
    expect((await submit('usejara.xyz')).sent).toEqual(['https://usejara.xyz']);
  });
  it('cleans a trailing slash or a path, and drops repeats', async () => {
    expect((await submit('https://a.example/\nhttps://a.example/page\nb.example')).sent).toEqual(['https://a.example', 'https://b.example']);
  });
  it('treats localhost as http for development, and leaves an exact address alone', async () => {
    expect((await submit('localhost:3000, https://game.example')).sent).toEqual(['http://localhost:3000', 'https://game.example']);
  });
  it('shows the customer what was sent', async () => {
    expect((await submit('usejara.xyz')).shown).toBe('https://usejara.xyz');
  });
  it('does not turn http:// into https:// (the server explains why it is refused)', async () => {
    expect((await submit('http://acme.example')).sent).toEqual(['http://acme.example']);
  });
});
