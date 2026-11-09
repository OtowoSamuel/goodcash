/** Tiny, dependency-free helpers for the fixed-size ABI encoding GoodCash needs. */

export type Hex = `0x${string}`;

export function strip0x(h: string): string {
  return h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
}

export function isAddress(a: unknown): a is Hex {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
}

export function isTxHash(h: unknown): h is Hex {
  return typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h);
}

/** A uint256 as 64 hex characters. Throws for negative or oversized values. */
export function uintWord(v: bigint): string {
  if (v < 0n) throw new Error('Negative value cannot be encoded');
  const s = v.toString(16);
  if (s.length > 64) throw new Error('Value too large to encode');
  return s.padStart(64, '0');
}

export function addressWord(a: string): string {
  if (!isAddress(a)) throw new Error('Not an address');
  return strip0x(a).toLowerCase().padStart(64, '0');
}

export function bytes32Word(h: string): string {
  const s = strip0x(h);
  if (!/^[0-9a-fA-F]{64}$/.test(s)) throw new Error('Not 32 bytes');
  return s.toLowerCase();
}

/** Plain ASCII text (order ids) to hex. Refuses anything outside ASCII so the result is predictable. */
export function asciiToHex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 127) throw new Error('Only plain ASCII text can be encoded here');
    out += c.toString(16).padStart(2, '0');
  }
  return out;
}

/** Word number `index` (0-based) of ABI-encoded data, as a bigint. */
export function readWord(data: string, index: number): bigint {
  const s = strip0x(data);
  const w = s.slice(index * 64, index * 64 + 64);
  if (w.length !== 64) throw new Error('Data is too short');
  return BigInt(`0x${w}`);
}

export function readAddressWord(data: string, index: number): Hex {
  const s = strip0x(data);
  const w = s.slice(index * 64, index * 64 + 64);
  if (w.length !== 64 || !/^0{24}/.test(w)) throw new Error('Not an address word');
  return `0x${w.slice(24)}` as Hex;
}
