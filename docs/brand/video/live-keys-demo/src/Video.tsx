import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Stage, typed, CameraKeyframe } from './kit/Stage';
import { CursorPoint, press } from './kit/Cursor';
import { BRAND, HEAD, SYS, DEMO } from './theme';
import { SignupPage, KeysPage } from './ui/Docs';
import { MailPage, BuildPage, TerminalPage, LIVE_ACCESS_CMD, ReviewPage, SwitchPage } from './ui/Other';

// Captions only, no voice. 30 fps. Scene lengths (frames):
//   intro 120 | 1 form 330 | 1 email 180 | 1 test keys 210 | 2 build 270 | 3 live access 240
//   4 review 180 | 5 email 180 | 5 live keys 210 | 6 switch 180 | outro 150   = 2250 (75 s)

const SquareCtx = React.createContext(false);
const useSq = () => React.useContext(SquareCtx);

const fade = (frame: number, a: number, b: number) => interpolate(frame, [a, b], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

/** Brand frame: logo, step chip and progress at the top, the caption card at the bottom */
const Overlay: React.FC<{ step: number; title: string; text: string }> = ({ step, title, text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sq = useSq();
  const inn = spring({ frame: frame - 4, fps, config: { damping: 200 }, durationInFrames: 16 });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', top: sq ? 44 : 30, left: sq ? 44 : 160, right: sq ? 44 : 160, display: 'flex', alignItems: 'center', gap: 14 }}>
        <Img src={staticFile('logo.png')} style={{ width: sq ? 64 : 56, height: sq ? 64 : 56 }} />
        <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: sq ? 34 : 30, color: BRAND.ink }}>GoodCash</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} style={{ width: n === step ? 34 : 14, height: 14, borderRadius: 7, border: `3px solid ${BRAND.ink}`, background: n <= step ? BRAND.yellow : BRAND.white }} />
          ))}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: sq ? 44 : 250,
          right: sq ? 44 : 250,
          bottom: sq ? 44 : 26,
          background: BRAND.white,
          border: `4px solid ${BRAND.ink}`,
          borderRadius: 22,
          boxShadow: `8px 8px 0 ${BRAND.ink}`,
          padding: sq ? '22px 28px' : '16px 26px',
          display: 'flex',
          flexDirection: sq ? 'column' : 'row',
          alignItems: sq ? 'flex-start' : 'center',
          gap: sq ? 8 : 22,
          opacity: inn,
          transform: `translateY(${(1 - inn) * 30}px)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <div style={{ background: BRAND.yellow, border: `3px solid ${BRAND.ink}`, borderRadius: 12, padding: '4px 12px', fontFamily: HEAD, fontWeight: 800, fontSize: sq ? 24 : 22 }}>
            Step {step} of 6
          </div>
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: sq ? 38 : 34, color: BRAND.ink, lineHeight: 1.05 }}>{title}</div>
        </div>
        <div style={{ fontFamily: SYS, fontSize: sq ? 27 : 24, color: BRAND.ink, lineHeight: 1.3 }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};

/** The stage sits in an outlined box between the header and the caption; the square cut zooms in further */
const Screen: React.FC<{ url?: string; camera: CameraKeyframe[]; path?: CursorPoint[]; clicks?: number[]; sqZoom?: number; children: React.ReactNode }> = ({ url, camera, path, clicks, sqZoom = 1.25, children }) => {
  const sq = useSq();
  const box = sq ? { x: 44, y: 128, w: 992, h: 724 } : { x: 160, y: 108, w: 1600, h: 800 };
  const winH = 810 + (url ? 40 : 0);
  const fit = Math.min(1, box.h / winH / (box.w / 1440));
  const cam = sq ? camera.map((c) => ({ ...c, z: c.z * sqZoom })) : camera;
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        border: `4px solid ${BRAND.ink}`,
        borderRadius: 22,
        boxShadow: `10px 10px 0 ${BRAND.ink}`,
        overflow: 'hidden',
        background: '#efe8ff',
      }}
    >
      <Stage
        url={url ?? ''}
        chromeHeight={url ? 40 : 0}
        camera={cam}
        path={path}
        clicks={clicks}
        fit={fit}
        viewWidth={box.w - 8}
        viewHeight={box.h - 8}
        background="#efe8ff"
        windowShadow="none"
        rippleColor="rgba(123,57,252,0.55)"
      >
        {children}
      </Stage>
    </div>
  );
};

const still = (x: number, y: number, z = 1): CameraKeyframe[] => [{ f: 0, z, x, y }];

// ---- Scenes ---------------------------------------------------------------------------

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sq = useSq();
  const a = spring({ frame, fps, config: { damping: 14 } });
  const b = fade(frame, 18, 34);
  return (
    <AbsoluteFill style={{ background: BRAND.lilac, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 80 }}>
      <Img src={staticFile('logo.png')} style={{ width: sq ? 190 : 170, transform: `scale(${a})` }} />
      <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: sq ? 92 : 104, lineHeight: 1.02, color: BRAND.ink, marginTop: 34, opacity: b }}>
        From test keys
        <br />
        to live keys
      </div>
      <div style={{ fontFamily: SYS, fontSize: sq ? 34 : 36, color: BRAND.ink, marginTop: 24, opacity: fade(frame, 32, 48) }}>
        How partners go live with GoodCash, in 6 steps
      </div>
    </AbsoluteFill>
  );
};

const FormScene: React.FC = () => {
  const frame = useCurrentFrame();
  const C = { name: 22, email: 64, sites: 120, send: 194 };
  const path = [
    { f: 0, x: 1050, y: 720 },
    { f: 18, x: 700, y: 262 },
    { f: 58, x: 700, y: 262 },
    { f: 62, x: 700, y: 355 },
    { f: 114, x: 700, y: 355 },
    { f: 118, x: 700, y: 492 },
    { f: 176, x: 700, y: 492 },
    { f: 190, x: 520, y: 582 },
  ];
  const focus = frame >= C.send ? undefined : frame >= C.sites ? 'sites' : frame >= C.email ? 'email' : frame >= C.name ? 'name' : undefined;
  return (
    <>
      <Screen
        url="pay.goodcash.xyz/docs/get-test-keys"
        camera={[
          { f: 0, z: 1, x: 720, y: 405 },
          { f: 16, z: 1, x: 720, y: 405 },
          { f: 40, z: 1.32, x: 846, y: 360 },
          { f: 150, z: 1.32, x: 846, y: 360 },
          { f: 185, z: 1.32, x: 846, y: 520 },
        ]}
        path={path}
        clicks={Object.values(C)}
      >
        <SignupPage
          name={frame >= C.name ? typed(frame, DEMO.name, C.name + 4, 3) : ''}
          email={frame >= C.email ? typed(frame, DEMO.email, C.email + 4, 2) : ''}
          sites={frame >= C.sites ? typed(frame, DEMO.site, C.sites + 4, 2) : ''}
          focus={focus}
          pressed={press(frame, C.send)}
          sent={fade(frame, C.send + 10, C.send + 22)}
        />
      </Screen>
      <Overlay step={1} title="Get test keys" text="Tell us your app, your email and the websites you will test from." />
    </>
  );
};

const MailScene: React.FC<{ live?: boolean }> = ({ live }) => {
  const frame = useCurrentFrame();
  const click = 110;
  return (
    <>
      <Screen
        url="mail.example.com/inbox"
        camera={[
          { f: 0, z: 1, x: 720, y: 405 },
          { f: 20, z: 1, x: 720, y: 405 },
          { f: 50, z: 1.3, x: 860, y: 300 },
        ]}
        path={[
          { f: 0, x: 1200, y: 650 },
          { f: 40, x: 1200, y: 650 },
          { f: 100, x: 575, y: 228 },
        ]}
        clicks={[click]}
      >
        {live ? (
          <MailPage
            subject="Your GoodCash live keys are ready"
            lead={<>Your GoodCash live keys for <b>{DEMO.name}</b> are ready.</>}
            button="Get my live keys"
            note="This link works once and expires in 24 hours. The page it opens shows your live keys one time, so keep them somewhere safe. The secret key stays on your server only."
            pressed={press(frame, click)}
          />
        ) : (
          <MailPage
            subject="Confirm your email for GoodCash test keys"
            lead={<>Confirm your email to get GoodCash test keys for <b>{DEMO.name}</b>.</>}
            button="Get my test keys"
            note="This link works once and expires in one hour. The page it opens shows your keys one time, so keep them somewhere safe. Test keys never move real money."
            pressed={press(frame, click)}
          />
        )}
      </Screen>
      {live ? (
        <Overlay step={5} title="Live keys by email" text="Once approved, we email you a one time link. It works for 24 hours." />
      ) : (
        <Overlay step={1} title="Confirm your email" text="We email you a link to confirm it is you. It works once." />
      )}
    </>
  );
};

const KeysScene: React.FC<{ live?: boolean }> = ({ live }) => {
  const frame = useCurrentFrame();
  const copy = 140;
  return (
    <>
      <Screen
        url={live ? 'pay.goodcash.xyz/docs/get-live-keys/confirm' : 'pay.goodcash.xyz/docs/get-test-keys/confirm'}
        camera={[
          { f: 0, z: 1, x: 720, y: 405 },
          { f: 24, z: 1, x: 720, y: 405 },
          { f: 50, z: 1.35, x: 846, y: 250 },
          { f: 95, z: 1.35, x: 846, y: 250 },
          { f: 125, z: 1.35, x: 846, y: 520 },
        ]}
        path={[
          { f: 0, x: 1300, y: 760 },
          { f: 100, x: 1300, y: 760 },
          { f: 132, x: 1208, y: 553 },
        ]}
        clicks={[copy]}
      >
        <KeysPage live={live} reveal={frame >= 14 ? 1 : 0} copiedSk={frame >= copy + 4} />
      </Screen>
      {live ? (
        <Overlay step={5} title="Save your live keys" text="Shown one time only. The secret key stays on your server, never in an app or a chat." />
      ) : (
        <Overlay step={1} title="Save your test keys" text="Shown one time only. Test keys never move real money." />
      )}
    </>
  );
};

const BuildScene: React.FC = () => {
  const frame = useCurrentFrame();
  const click = 100;
  const status = frame < click + 6 ? 'idle' : frame < 150 ? 'sent' : frame < 200 ? 'processing' : 'paid';
  return (
    <>
      <Screen
        url="demogame.example"
        camera={[
          { f: 0, z: 1, x: 720, y: 405 },
          { f: 12, z: 1, x: 720, y: 405 },
          { f: 34, z: 1.4, x: 380, y: 230 },
          { f: 64, z: 1.4, x: 380, y: 230 },
          { f: 86, z: 1.25, x: 1100, y: 430 },
        ]}
        path={[
          { f: 0, x: 600, y: 700 },
          { f: 60, x: 600, y: 700 },
          { f: 94, x: 1100, y: 395 },
        ]}
        clicks={[click]}
      >
        <BuildPage pressed={press(frame, click)} status={status} />
      </Screen>
      <Overlay step={2} title="Build and test" text="Add the widget with two lines, then try full cash outs. No real money moves." />
    </>
  );
};

const TerminalScene: React.FC = () => {
  const frame = useCurrentFrame();
  const done = 14 + LIVE_ACCESS_CMD.length;
  return (
    <>
      <Screen sqZoom={1} camera={[{ f: 0, z: 1, x: 720, y: 405 }, { f: 10, z: 1, x: 720, y: 405 }, { f: 40, z: 1.25, x: 400, y: 230 }]}>
        <TerminalPage cmd={typed(frame, LIVE_ACCESS_CMD, 14, 1)} out={fade(frame, done + 22, done + 34)} />
      </Screen>
      <Overlay step={3} title="Ask for live access" text="One call from your server, with your test secret key." />
    </>
  );
};

const ReviewScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ticks = [22, 44, 66, 88].filter((t) => frame >= t).length;
  return (
    <>
      <Screen camera={still(720, 405)}>
        <ReviewPage ticks={ticks} approved={spring({ frame: frame - 112, fps, config: { damping: 12 } })} />
      </Screen>
      <Overlay step={4} title="GoodCash reviews it" text="A person at GoodCash checks your setup against the go live checklist." />
    </>
  );
};

const SwitchScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <Screen camera={[{ f: 0, z: 1, x: 720, y: 405 }, { f: 12, z: 1, x: 720, y: 405 }, { f: 40, z: 1.3, x: 560, y: 330 }, { f: 100, z: 1.3, x: 560, y: 330 }, { f: 125, z: 1.3, x: 560, y: 600 }]}>
        <SwitchPage t={frame >= 70 ? 1 : 0} />
      </Screen>
      <Overlay step={6} title="Switch to live" text="Swap test for live, then do one small real cash out yourself first." />
    </>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sq = useSq();
  const a = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  return (
    <AbsoluteFill style={{ background: BRAND.lilac, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 70 }}>
      <Img src={staticFile('logo.png')} style={{ width: 140, opacity: a }} />
      <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: sq ? 84 : 96, color: BRAND.ink, margin: '26px 0 30px', lineHeight: 1.02, opacity: a }}>
        Get your test keys today
      </div>
      <div
        style={{
          background: BRAND.yellow,
          border: `4px solid ${BRAND.ink}`,
          borderRadius: 22,
          boxShadow: `8px 8px 0 ${BRAND.ink}`,
          padding: '18px 32px',
          fontFamily: HEAD,
          fontWeight: 800,
          fontSize: sq ? 40 : 46,
          color: BRAND.ink,
          opacity: fade(frame, 12, 26),
        }}
      >
        pay.goodcash.xyz/docs/get-test-keys
      </div>
      <div style={{ fontFamily: SYS, fontSize: sq ? 30 : 30, color: BRAND.ink, marginTop: 30, opacity: fade(frame, 26, 40) }}>
        Your users cash out G$ to their Nigerian bank, right inside your app.
      </div>
    </AbsoluteFill>
  );
};

// ---- Timelines ------------------------------------------------------------------------

/** Length in frames, the scene, and its voice line (public/voice/<line>.wav, from voice/lines.json) */
type Part = [number, React.FC, string];
const LiveMail = () => <MailScene live />;
const LiveKeys = () => <KeysScene live />;
const TestMail = () => <MailScene />;
const TestKeys = () => <KeysScene />;

const FULL: Part[] = [
  [135, Intro, 'intro'], [330, FormScene, 'form'], [180, TestMail, 'testmail'], [210, TestKeys, 'testkeys'], [270, BuildScene, 'build'],
  [240, TerminalScene, 'terminal'], [180, ReviewScene, 'review'], [180, LiveMail, 'livemail'], [210, LiveKeys, 'livekeys'],
  [180, SwitchScene, 'switch'], [150, Outro, 'outro'],
];
// Short square cut for X, Telegram and LinkedIn: one shot per step
const SHORT: Part[] = [
  [135, Intro, 'intro'], [330, FormScene, 'form'], [270, BuildScene, 'build'], [240, TerminalScene, 'terminal'], [180, ReviewScene, 'review'],
  [180, LiveMail, 'livemail'], [180, SwitchScene, 'switch'], [150, Outro, 'outro'],
];
// Each line starts this many frames into its scene, once the caption card is in
const VOICE_LEAD = 8;

const total = (parts: Part[]) => parts.reduce((n, [d]) => n + d, 0);
export const FULL_FRAMES = total(FULL);
export const SHORT_FRAMES = total(SHORT);

// Hold every frame until the heading font has loaded
const useBricolage = () => {
  const [handle] = React.useState(() => delayRender('Bricolage font'));
  React.useEffect(() => {
    new FontFace('Bricolage', `url(${staticFile('BricolageGrotesque-Bold.ttf')})`, { weight: '700 800' })
      .load()
      .then((f) => {
        (document.fonts as unknown as { add: (x: FontFace) => void }).add(f);
        continueRender(handle);
      });
  }, [handle]);
};

const Timeline: React.FC<{ parts: Part[]; square: boolean }> = ({ parts, square }) => {
  useBricolage();
  let at = 0;
  return (
    <SquareCtx.Provider value={square}>
      <AbsoluteFill style={{ background: BRAND.lilac }}>
        {parts.map(([d, Comp, line], i) => {
          const from = at;
          at += d;
          return (
            <Sequence key={i} from={from} durationInFrames={d}>
              <Comp />
              <Sequence from={VOICE_LEAD}>
                <Audio src={staticFile(`voice/${line}.wav`)} />
              </Sequence>
            </Sequence>
          );
        })}
      </AbsoluteFill>
    </SquareCtx.Provider>
  );
};

export const LiveKeysVideo: React.FC = () => <Timeline parts={FULL} square={false} />;
export const LiveKeysSquare: React.FC = () => <Timeline parts={SHORT} square />;
