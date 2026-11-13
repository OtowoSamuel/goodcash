/**
 * Test stand-in for the KEY_LOCK Durable Object namespace. It runs the REAL KeyLock class, and handles one request at a
 * time per name, the way Cloudflare does. Only imported by tests.
 */
import { KeyLock } from './lock';

export function fakeLockNamespace(): DurableObjectNamespace {
  const objects = new Map<string, { lock: KeyLock; chain: Promise<unknown> }>();
  const make = (): { lock: KeyLock; chain: Promise<unknown> } => {
    const data = new Map<string, unknown>();
    const state = {
      storage: {
        get: async (k: string) => data.get(k),
        put: async (k: string, v: unknown) => void data.set(k, v),
        delete: async (k: string) => void data.delete(k),
      },
    } as unknown as DurableObjectState;
    return { lock: new KeyLock(state), chain: Promise.resolve() };
  };
  return {
    idFromName: (name: string) => name,
    get: (id: string) => {
      const obj = objects.get(id) ?? make();
      objects.set(id, obj);
      return {
        fetch: (url: string, init?: RequestInit) => {
          const run = obj.chain.then(() => obj.lock.fetch(new Request(url, init)));
          obj.chain = run.catch(() => undefined);
          return run;
        },
      };
    },
  } as unknown as DurableObjectNamespace;
}
