/**
 * Pages Function for pay.goodcash.xyz: the widget page may be framed ONLY by the sites on the partner's allowed list
 * (asked from the partner API with the publishable key in the address). Everything else: no framing at all.
 */
import { widgetCsp } from '../src/csp';

interface Env {
  API_BASE?: string;
}

const KEY_RE = /^gc_pk_(live|test)_[A-Za-z0-9]{24,64}$/;
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/;

export const onRequest = async (ctx: { request: Request; env: Env; next: () => Promise<Response> }): Promise<Response> => {
  const res = await ctx.next();
  if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res;
  const url = new URL(ctx.request.url);
  const api = ctx.env.API_BASE ?? 'https://api.goodcash.xyz';

  let ancestors = "'none'";
  const key = url.searchParams.get('key') ?? '';
  if (url.searchParams.get('mode') === 'embed' && KEY_RE.test(key)) {
    try {
      const r = await fetch(`${api}/v1/partner`, { headers: { Authorization: `Bearer ${key}`, Origin: url.origin } });
      if (r.ok) {
        const p = (await r.json()) as { allowedOrigins?: unknown };
        const list = Array.isArray(p.allowedOrigins) ? p.allowedOrigins.filter((o): o is string => typeof o === 'string' && ORIGIN_RE.test(o)) : [];
        if (list.length) ancestors = list.join(' ');
      }
    } catch {
      // keep 'none'
    }
  }

  const headers = new Headers(res.headers);
  headers.set('Content-Security-Policy', widgetCsp(api, ancestors));
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
