// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SRC = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/widget.js'), 'utf8');
const WIDGET = 'https://pay.goodcash.xyz';
const KEY = 'gc_pk_test_' + 'a'.repeat(32);
const WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

type Win = Window & { GoodCash: { open: (o: Record<string, unknown>) => { close: () => void } } };
const g = () => window as unknown as Win;

function permit(over: Record<string, unknown> = {}, domain: Record<string, unknown> = {}) {
  return {
    types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }] },
    primaryType: 'ReceiveWithAuthorization',
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC, ...domain },
    message: { from: WALLET, to: '0xccc88a9d1b4ed6b0eaba998850414b24f1c315be', value: '3500000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 1800), nonce: '0x' + '11'.repeat(32), ...over },
  };
}

describe('widget.js: top-up signed by the partner page', () => {
  let child: { closed: boolean; close: () => void; postMessage: ReturnType<typeof vi.fn> };
  let opened: string;

  beforeEach(() => {
    delete (window as unknown as { GoodCash?: unknown }).GoodCash;
    child = { closed: false, close: () => undefined, postMessage: vi.fn() };
    window.open = vi.fn((u: string) => ((opened = u), child)) as never;
    new Function(SRC)();
  });

  const ask = async (data: unknown, extra: Record<string, unknown> = {}) => {
    const ev = new MessageEvent('message', { data: { source: 'goodcash', type: 'sign_typed_data_request', id: 'r1', typedData: data, ...extra }, origin: WIDGET });
    Object.defineProperty(ev, 'source', { value: child });
    window.dispatchEvent(ev);
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalled());
    return child.postMessage.mock.calls[0] as [Record<string, unknown>, string];
  };

  it('tells the page the app can sign the permit, so no connect step is shown', () => {
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signer: { request: vi.fn() } });
    const q = new URL(opened).searchParams;
    expect([q.get('flow'), q.get('wallet'), q.get('bridge'), q.get('typed')]).toEqual(['topup', WALLET, '1', '1']);
  });
  it('does not claim it can sign the permit when the app only sends transactions', () => {
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signer: async () => '0x' });
    expect(new URL(opened).searchParams.get('typed')).toBeNull();
  });
  it('does not claim it for a cash out', () => {
    g().GoodCash.open({ publishableKey: KEY, wallet: WALLET, signer: { request: vi.fn() } });
    expect(new URL(opened).searchParams.get('typed')).toBeNull();
  });

  it('signs the permit with the app\'s wallet and returns the signature to GoodCash only', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => (method === 'eth_chainId' ? '0xa4ec' : method === 'eth_signTypedData_v4' ? '0x' + 'cd'.repeat(65) : null));
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signer: { request } });
    const [msg, target] = await ask(permit());
    expect(msg).toMatchObject({ source: 'goodcash-host', type: 'sign_result', id: 'r1', signature: '0x' + 'cd'.repeat(65) });
    expect(target).toBe(WIDGET);
    const sign = request.mock.calls.find((c) => (c[0] as { method: string }).method === 'eth_signTypedData_v4')![0] as unknown as { params: [string, string] };
    expect(sign.params[0]).toBe(WALLET);
    expect(JSON.parse(sign.params[1]).types.EIP712Domain).toHaveLength(4);
    // moved to Base for the signature, then put back
    const switches = request.mock.calls.filter((c) => (c[0] as { method: string }).method === 'wallet_switchEthereumChain').map((c) => (c[0] as unknown as { params: [{ chainId: string }] }).params[0].chainId);
    expect(switches).toEqual(['0x2105', '0xa4ec']);
  });
  it('still signs when the wallet cannot switch network (an email sign-in wallet)', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain') throw new Error('cannot switch');
      return method === 'eth_chainId' ? '0xa4ec' : '0x' + 'cd'.repeat(65);
    });
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signer: { request } });
    const [msg] = await ask(permit());
    expect(msg.signature).toBe('0x' + 'cd'.repeat(65));
  });
  it('works with a signTypedData function', async () => {
    const signTypedData = vi.fn(async () => '0x' + 'ef'.repeat(65));
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signTypedData });
    const [msg] = await ask(permit());
    expect(msg.signature).toBe('0x' + 'ef'.repeat(65));
    expect(signTypedData).toHaveBeenCalledOnce();
  });

  it('never signs anything but this wallet\'s USDC permit on Base, for a short time', async () => {
    const bad = [
      permit({ from: '0x1111111111111111111111111111111111111111' }),
      permit({}, { chainId: 1 }),
      permit({}, { verifyingContract: '0x2222222222222222222222222222222222222222' }),
      permit({ validBefore: String(Math.floor(Date.now() / 1000) + 86400) }),
      permit({ validBefore: '1' }),
      { ...permit(), primaryType: 'Permit' },
    ];
    for (const b of bad) {
      child.postMessage.mockClear();
      const request = vi.fn();
      g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signer: { request } });
      const [msg] = await ask(b);
      expect(msg.signature).toBeUndefined();
      expect(msg.error).toBeTruthy();
      expect(request).not.toHaveBeenCalled();
    }
  });
  it('ignores a signing request from any window that is not the GoodCash page', async () => {
    const request = vi.fn();
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signer: { request } });
    for (const [origin, source] of [['https://evil.example', child], [WIDGET, {}]] as const) {
      const ev = new MessageEvent('message', { data: { source: 'goodcash', type: 'sign_typed_data_request', id: 'x', typedData: permit() }, origin });
      Object.defineProperty(ev, 'source', { value: source });
      window.dispatchEvent(ev);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(request).not.toHaveBeenCalled();
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('hands your own check the order and its maximum, and refuses an amount above it itself', async () => {
    const signTypedData = vi.fn(async () => '0x' + 'ef'.repeat(65));
    g().GoodCash.open({ publishableKey: KEY, flow: 'topup', wallet: WALLET, signTypedData });
    const [msg] = await ask(permit(), { orderId: 'ord-1', maxUsdc: '3500000' });
    expect(msg.signature).toBeTruthy();
    expect(signTypedData).toHaveBeenCalledWith(expect.anything(), { orderId: 'ord-1', maxUsdc: '3500000', wallet: WALLET });

    child.postMessage.mockClear();
    signTypedData.mockClear();
    const [over] = await ask(permit(), { orderId: 'ord-1', maxUsdc: '3499999' });
    expect(over.signature).toBeUndefined();
    expect(String((over.error as { message: string }).message)).toMatch(/above what this order may convert/);
    expect(signTypedData).not.toHaveBeenCalled();
  });
  it('says which version this is', () => {
    expect((g().GoodCash as unknown as { version: string }).version).toBe('0.4.0');
  });
});
