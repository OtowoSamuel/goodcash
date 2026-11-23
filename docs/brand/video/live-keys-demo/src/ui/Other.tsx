import React from 'react';
import { BRAND, DOCS, SYS, MONO, HEAD, DEMO } from '../theme';

/** A plain, made-up inbox showing one GoodCash email (text from services/orders/src/v1/signup.ts and liveKeys.ts) */
export const MailPage: React.FC<{ subject: string; lead: React.ReactNode; button: string; note: string; pressed?: number }> = ({ subject, lead, button, note, pressed = 0 }) => (
  <div style={{ position: 'absolute', inset: 0, background: '#f6f7fb', fontFamily: SYS, color: '#1f1f1f', fontSize: 16 }}>
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 420, background: '#fff', borderRight: '1px solid #e3e5ec' }}>
      <div style={{ padding: '22px 24px', fontWeight: 700, fontSize: 20 }}>Inbox</div>
      {[
        { from: 'GoodCash', sub: subject, on: true },
        { from: 'Team chat', sub: 'Standup notes', on: false },
        { from: 'Design', sub: 'New level art', on: false },
      ].map((m) => (
        <div key={m.sub} style={{ padding: '14px 24px', background: m.on ? '#efe8ff' : 'transparent', borderLeft: m.on ? `4px solid ${DOCS.brand}` : '4px solid transparent' }}>
          <div style={{ fontWeight: m.on ? 700 : 500 }}>{m.from}</div>
          <div style={{ color: '#5f6368', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.sub}</div>
        </div>
      ))}
    </div>
    <div style={{ position: 'absolute', left: 460, top: 40, right: 60 }}>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{subject}</div>
      <div style={{ color: '#5f6368', fontSize: 14, margin: '6px 0 28px' }}>GoodCash to {DEMO.email}</div>
      <div style={{ background: '#fff', border: '1px solid #e3e5ec', borderRadius: 12, padding: '28px 32px', lineHeight: 1.6 }}>
        <p style={{ margin: '0 0 18px' }}>{lead}</p>
        <div
          style={{
            display: 'inline-block',
            background: DOCS.brand,
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 10,
            fontWeight: 700,
            transform: `scale(${1 - pressed * 0.05})`,
          }}
        >
          {button}
        </div>
        <p style={{ margin: '18px 0 0', fontSize: 13, color: DOCS.mut }}>{note}</p>
      </div>
    </div>
  </div>
);
export const MAIL_BUTTON = { x: 560, y: 233 };

const C = { kw: '#c792ea', str: '#c3e88d', fn: '#82aaff', com: '#7f8c98', txt: '#d6deeb', tag: '#f07178' };

export const CodeLines: React.FC<{ lines: React.ReactNode[]; highlight?: number[]; fontSize?: number }> = ({ lines, highlight = [], fontSize = 17 }) => (
  <div style={{ fontFamily: MONO, fontSize, lineHeight: 1.75, color: C.txt }}>
    {lines.map((l, i) => (
      <div key={i} style={{ display: 'flex', background: highlight.includes(i) ? 'rgba(255,210,63,0.16)' : 'transparent' }}>
        <span style={{ width: 44, color: '#4b5263', textAlign: 'right', paddingRight: 16, flexShrink: 0 }}>{i + 1}</span>
        <span style={{ whiteSpace: 'pre' }}>{l}</span>
      </div>
    ))}
  </div>
);

export const k = (t: string) => <span style={{ color: C.kw }}>{t}</span>;
export const s = (t: string) => <span style={{ color: C.str }}>{t}</span>;
export const f = (t: string) => <span style={{ color: C.fn }}>{t}</span>;
export const cm = (t: string) => <span style={{ color: C.com }}>{t}</span>;
export const tg = (t: string) => <span style={{ color: C.tag }}>{t}</span>;

/** The game quickstart snippet (docs/partners/quickstarts/game.md), with the key passed in */
export const widgetLines = (key: React.ReactNode) => [
  <>{tg('<script')} src={s('"https://pay.goodcash.xyz/widget.js"')}{tg('></script>')}</>,
  <>{tg('<script>')}</>,
  <>  {k('function')} {f('cashOut')}(playerId, gBalance) {'{'}</>,
  <>    GoodCash.{f('open')}({'{'}</>,
  <>      publishableKey: {key},</>,
  <>      mode: {s("'popup'")},</>,
  <>      amountG: gBalance,</>,
  <>      partnerRef: playerId,</>,
  <>    {'}'});</>,
  <>  {'}'}</>,
  <>{tg('</script>')}</>,
];

/** Code editor on the left, the partner's (made-up) game page on the right */
export const BuildPage: React.FC<{ pressed?: number; status?: 'idle' | 'sent' | 'processing' | 'paid' }> = ({ pressed = 0, status = 'idle' }) => {
  const label = { idle: '', sent: 'Sent', processing: 'Processing', paid: 'Paid to your bank!' }[status];
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <div style={{ width: 760, background: '#1e2230', padding: '18px 0' }}>
        <div style={{ fontFamily: SYS, color: '#9aa3b5', fontSize: 14, padding: '0 22px 14px' }}>index.html</div>
        <CodeLines lines={widgetLines(s("'" + DEMO.pkTest.slice(0, 11) + "...'"))} highlight={[4]} />
      </div>
      <div style={{ flex: 1, background: '#0f1a2e', fontFamily: SYS, color: '#fff', position: 'relative' }}>
        <div style={{ position: 'absolute', top: 24, left: 24, right: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 22 }}>Demo Game</b>
          <span style={{ background: BRAND.yellow, color: BRAND.ink, fontWeight: 700, fontSize: 13, padding: '4px 10px', borderRadius: 20 }}>Test mode, no real money</span>
        </div>
        <div style={{ position: 'absolute', top: 240, left: 0, right: 0, textAlign: 'center' }}>
          <div style={{ color: '#9fb0cc' }}>Your balance</div>
          <div style={{ fontSize: 48, fontWeight: 800, margin: '4px 0 26px' }}>5,000 G$</div>
          <div
            style={{
              display: 'inline-block',
              background: BRAND.mint,
              color: BRAND.ink,
              fontWeight: 800,
              fontSize: 20,
              padding: '14px 26px',
              borderRadius: 14,
              border: `3px solid ${BRAND.ink}`,
              transform: `scale(${1 - pressed * 0.06})`,
            }}
          >
            Cash out to my bank
          </div>
        </div>
        {status !== 'idle' && (
          <div style={{ position: 'absolute', left: 90, right: 90, top: 520, background: '#fff', color: BRAND.ink, borderRadius: 14, padding: '16px 20px', border: `3px solid ${BRAND.ink}`, fontWeight: 700, fontSize: 18, textAlign: 'center' }}>
            {status === 'paid' ? '✅ ' : '⏳ '}
            {label}
            <div style={{ fontWeight: 400, fontSize: 14, color: DOCS.mut, marginTop: 4 }}>Test Bank A, TEST ACCOUNT. Webhook: cashout.{status}</div>
          </div>
        )}
      </div>
    </div>
  );
};
export const CASHOUT_BTN = { x: 1100, y: 393 };

/** A terminal on the partner's server */
export const TerminalPage: React.FC<{ cmd: string; out: number }> = ({ cmd, out }) => (
  <div style={{ position: 'absolute', inset: 0, background: '#14161f', fontFamily: MONO, fontSize: 21, color: '#e6e6e6', padding: '28px 34px', lineHeight: 1.7 }}>
    <div style={{ color: '#7f8c98', marginBottom: 10 }}>demo-game-server ~</div>
    <div style={{ whiteSpace: 'pre-wrap' }}>
      <span style={{ color: BRAND.mint }}>$ </span>
      {cmd}
      {out === 0 && <span style={{ background: '#e6e6e6', marginLeft: 2 }}>&nbsp;</span>}
    </div>
    {out > 0 && (
      <div style={{ opacity: out, marginTop: 18, whiteSpace: 'pre', color: '#d6deeb' }}>
        {'{\n  '}
        <span style={{ color: '#82aaff' }}>"status"</span>: <span style={{ color: '#c3e88d' }}>"requested"</span>
        {',\n  '}
        <span style={{ color: '#82aaff' }}>"message"</span>: <span style={{ color: '#c3e88d' }}>"Thanks. GoodCash will review this and contact you by email."</span>
        {'\n}'}
      </div>
    )}
  </div>
);
export const LIVE_ACCESS_CMD = `curl -X POST https://api.goodcash.xyz/v1/live-access \\\n  -H "Authorization: Bearer ${DEMO.skTest}"`;

/** GoodCash review card (brand style). Items are from docs/partners/go-live.md. */
export const ReviewPage: React.FC<{ ticks: number; approved: number }> = ({ ticks, approved }) => {
  const items = ['Agreement with GoodCash signed', 'Allowed websites listed', 'Tested end to end in test mode', 'Secret key kept on the server'];
  return (
    <div style={{ position: 'absolute', inset: 0, background: BRAND.lilac, fontFamily: SYS, color: BRAND.ink }}>
      <div style={{ position: 'absolute', left: 340, top: 110, width: 760, background: BRAND.white, border: `4px solid ${BRAND.ink}`, borderRadius: 26, boxShadow: `10px 10px 0 ${BRAND.ink}`, padding: '36px 44px' }}>
        <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 36, lineHeight: 1.1 }}>Live access request</div>
        <div style={{ color: DOCS.mut, margin: '6px 0 22px', fontSize: 18 }}>{DEMO.name}, {DEMO.email}</div>
        {items.map((it, i) => (
          <div key={it} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 21, margin: '12px 0', opacity: ticks > i ? 1 : 0.45 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, border: `3px solid ${BRAND.ink}`, background: ticks > i ? BRAND.mint : BRAND.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
              {ticks > i ? '✓' : ''}
            </div>
            {it}
          </div>
        ))}
        <div
          style={{
            marginTop: 26,
            display: 'inline-block',
            background: BRAND.yellow,
            border: `3px solid ${BRAND.ink}`,
            borderRadius: 14,
            boxShadow: `5px 5px 0 ${BRAND.ink}`,
            padding: '12px 22px',
            fontFamily: HEAD,
            fontWeight: 800,
            fontSize: 24,
            opacity: approved,
            transform: `scale(${0.85 + 0.15 * approved})`,
          }}
        >
          Approved. Live keys on their way.
        </div>
      </div>
    </div>
  );
};

/** The switch: test keys become live keys, in the app and on the server */
export const SwitchPage: React.FC<{ t: number }> = ({ t }) => {
  const key = t < 1 ? s("'gc_pk_test_...'") : s("'gc_pk_live_...'");
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: '#1e2230' }}>
      <div style={{ padding: '18px 0', flex: 1 }}>
        <div style={{ fontFamily: SYS, color: '#9aa3b5', fontSize: 14, padding: '0 22px 14px' }}>index.html</div>
        <CodeLines lines={widgetLines(key)} highlight={[4]} fontSize={19} />
      </div>
      <div style={{ padding: '18px 0 26px', borderTop: '1px solid #2e3446', background: '#191c28' }}>
        <div style={{ fontFamily: SYS, color: '#9aa3b5', fontSize: 14, padding: '0 22px 10px' }}>server .env (never in the app)</div>
        <CodeLines lines={[<>GOODCASH_SECRET_KEY={s(t < 1 ? 'gc_sk_test_...' : 'gc_sk_live_...')}</>]} highlight={[0]} fontSize={19} />
      </div>
    </div>
  );
};
