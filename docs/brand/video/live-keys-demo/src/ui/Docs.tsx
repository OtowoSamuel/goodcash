import React from 'react';
import { DOCS, SYS, MONO, DEMO } from '../theme';

// Rebuild of pay.goodcash.xyz/docs at 1440x810 (measured from the real page at that size)
export const CONTENT_X = 448;
export const CONTENT_W = 796;

const NAV: [string, string[]][] = [
  ['START', ['Overview', 'Get test keys', 'Test mode', 'Go-live checklist']],
  ['QUICKSTARTS', ['Games', 'React apps', 'React Native', 'Fintech and servers', 'AI app builders', 'Add G$ with naira']],
  ['REFERENCE', ['Webhooks', 'Errors', 'Fees', 'Changelog']],
];

export const DocsShell: React.FC<{ active?: string; scroll?: number; children: React.ReactNode }> = ({ active, scroll = 0, children }) => (
  <div style={{ position: 'absolute', inset: 0, background: DOCS.bg, color: DOCS.fg, fontFamily: SYS, fontSize: 16, lineHeight: 1.6 }}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: -scroll, height: 2000 }}>
      <div style={{ position: 'absolute', left: 196, top: 94, width: 220 }}>
        {NAV.map(([group, items]) => (
          <div key={group} style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: DOCS.mut, marginBottom: 6 }}>{group}</div>
            {items.map((it) => (
              <div
                key={it}
                style={{
                  padding: '3px 8px',
                  borderRadius: 8,
                  fontSize: 15,
                  color: it === active ? DOCS.brand : DOCS.fg,
                  fontWeight: it === active ? 600 : 400,
                  background: it === active ? DOCS.soft : 'transparent',
                }}
              >
                {it}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: CONTENT_X, top: 80, width: CONTENT_W }}>{children}</div>
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 57, background: DOCS.bg, borderBottom: `1px solid ${DOCS.line}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
      <b style={{ fontSize: 18 }}>GoodCash</b>
      <span style={{ color: DOCS.mut }}>Partner docs</span>
    </div>
  </div>
);

export const H1: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 30, fontWeight: 700, margin: '4px 0 12px' }}>{children}</div>
);
export const H2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 22, fontWeight: 700, margin: '26px 0 6px' }}>{children}</div>
);

export const Field: React.FC<{ label: string; value: string; hint?: React.ReactNode; tall?: boolean; focus?: boolean; placeholder?: string }> = ({ label, value, hint, tall, focus, placeholder }) => (
  <div style={{ margin: '14px 0', fontWeight: 600 }}>
    {label}
    {hint && <div style={{ fontWeight: 400, color: DOCS.mut, fontSize: 14 }}>{hint}</div>}
    <div
      style={{
        marginTop: 6,
        height: tall ? 97 : 46,
        padding: '10px 12px',
        border: `1px solid ${focus ? DOCS.brand : DOCS.line}`,
        boxShadow: focus ? `0 0 0 3px ${DOCS.soft}` : 'none',
        borderRadius: 10,
        fontWeight: 400,
        color: value ? DOCS.fg : '#8a859c',
      }}
    >
      {value || placeholder}
      {focus && <span style={{ borderLeft: `2px solid ${DOCS.fg}`, marginLeft: 1 }} />}
    </div>
  </div>
);

export const Button: React.FC<{ children: React.ReactNode; pressed?: number; disabled?: boolean }> = ({ children, pressed = 0, disabled }) => (
  <div
    style={{
      display: 'inline-block',
      fontWeight: 700,
      color: '#fff',
      background: DOCS.brand,
      borderRadius: 10,
      padding: '10px 18px',
      transform: `scale(${1 - pressed * 0.05})`,
      opacity: disabled ? 0.6 : 1,
    }}
  >
    {children}
  </div>
);

export const Msg: React.FC<{ kind: 'ok' | 'warn' | 'info'; children: React.ReactNode; opacity?: number }> = ({ kind, children, opacity = 1 }) => (
  <div
    style={{
      padding: '12px 14px',
      borderRadius: 10,
      background: DOCS.soft,
      border: kind === 'ok' ? '1px solid #2a9d63' : kind === 'warn' ? '1px solid #d99a00' : '1px solid transparent',
      margin: '14px 0',
      opacity,
    }}
  >
    {children}
  </div>
);

const Code = ({ children }: { children: React.ReactNode }) => (
  <code style={{ fontFamily: MONO, fontSize: 13, background: DOCS.code, padding: '1px 5px', borderRadius: 5 }}>{children}</code>
);

/** Get test keys (the 'keys-form' page) */
export const SignupPage: React.FC<{ name: string; email: string; sites: string; focus?: 'name' | 'email' | 'sites'; pressed?: number; sent?: number }> = ({ name, email, sites, focus, pressed, sent = 0 }) => (
  <DocsShell active="Get test keys">
    <H1>Get test keys</H1>
    <div style={{ margin: '0 0 8px' }}>
      Test keys let you try the whole cash out flow, from your own app, with <b>no real money</b>. They work right away. Live keys come later, after you have tested and we have agreed the details.
    </div>
    <Field label="Your app or company name" value={name} focus={focus === 'name'} />
    <Field label="Your email" value={email} focus={focus === 'email'} />
    <Field
      label="Websites you will test from"
      hint={<>One per line. Exact addresses, like <Code>https://mygame.example</Code>. For development you can use <Code>http://localhost</Code>.</>}
      value={sites}
      placeholder="https://mygame.example"
      tall
      focus={focus === 'sites'}
    />
    <Button pressed={pressed} disabled={sent > 0}>Email me a link</Button>
    {sent > 0 && (
      <Msg kind="ok" opacity={sent}>
        Check your email. We sent a link to confirm it is you. It works once and expires in one hour. If nothing arrives in a few minutes, check your spam folder.
      </Msg>
    )}
  </DocsShell>
);

const KeyBlock: React.FC<{ title: string; text: string; value: string; copied?: boolean }> = ({ title, text, value, copied }) => (
  <>
    <H2>{title}</H2>
    <div>{text}</div>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
      <div style={{ flex: 1, fontFamily: MONO, fontSize: 15, background: DOCS.code, padding: '12px 14px', borderRadius: 10 }}>{value}</div>
      <Button>{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  </>
);

/** Your test keys / Your live keys (the confirm pages). Keys are masked stand-ins. */
export const KeysPage: React.FC<{ live?: boolean; scroll?: number; copiedSk?: boolean; reveal?: number }> = ({ live, scroll, copiedSk, reveal = 1 }) => (
  <DocsShell active={live ? undefined : 'Get test keys'} scroll={scroll}>
    <H1>{live ? 'Your live keys' : 'Your test keys'}</H1>
    {reveal < 1 ? (
      <Msg kind="info">One moment…</Msg>
    ) : (
      <>
        <Msg kind="warn">
          <b>Save these now.</b> They are shown only once and we cannot show them again.{' '}
          {live ? 'These keys move real money. If you lose them, contact GoodCash for new ones.' : 'If you lose them, ask for new test keys.'}
        </Msg>
        <div>
          Account: <b>{DEMO.name}</b>
          <br />
          Allowed websites: {DEMO.site}
        </div>
        <KeyBlock title="Publishable key" text="Goes in your website or app. It only works from the websites above." value={live ? DEMO.pkLive : DEMO.pkTest} />
        <KeyBlock
          title="Secret key"
          text={live ? 'Stays on your server only. It is refused from browsers. Never put it in an app or a repository, and never send it in a chat or an email.' : 'Stays on your server only. It is refused from browsers. Never put it in an app or a repository.'}
          value={live ? DEMO.skLive : DEMO.skTest}
          copied={copiedSk}
        />
      </>
    )}
  </DocsShell>
);
