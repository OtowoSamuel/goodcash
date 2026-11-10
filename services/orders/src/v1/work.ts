/**
 * "Something may be waiting" markers, so the 10-minute schedule can skip storage list calls when nothing is open.
 * (Cloudflare's free plan allows 1,000 list calls a day; the schedule alone used about 700.)
 *
 * - Whoever creates an open item sets the marker (`markWork`).
 * - The schedule lists only while the marker is set, and clears it after a list that found nothing open, but never
 *   if the marker was set after that list began (`clearWorkIfIdle`).
 * - Safety net: once an hour the schedule lists anyway, so a missed marker (or work that already existed when this was
 *   deployed) is picked up within the hour.
 */
import type { Env } from './types';

const MARKER_TTL = 3 * 86400;
const SAFETY_SLOT_MS = 10 * 60_000;
const SAFETY_EVERY_SLOTS = 6;

const key = (name: string) => `work:${name}`;

export async function markWork(env: Env, name: string, now = Date.now()): Promise<void> {
  await env.ORDER_STORE.put(key(name), String(now), { expirationTtl: MARKER_TTL });
}

/** True when there may be work, or when this is the hourly safety run. */
export async function shouldList(env: Env, name: string, now = Date.now()): Promise<boolean> {
  if (Math.floor(now / SAFETY_SLOT_MS) % SAFETY_EVERY_SLOTS === 0) return true;
  return (await env.ORDER_STORE.get(key(name))) !== null;
}

/** Call after a complete list that found nothing open. `listStartedAt` is the time just before that list. */
export async function clearWorkIfIdle(env: Env, name: string, listStartedAt: number): Promise<void> {
  const raw = await env.ORDER_STORE.get(key(name));
  if (raw === null) return;
  const markedAt = Number(raw);
  if (Number.isFinite(markedAt) && markedAt > listStartedAt) return; // something was added while we were looking
  await env.ORDER_STORE.delete(key(name));
}
