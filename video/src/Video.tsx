import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import '@fontsource/bricolage-grotesque/600.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './app.css';
import {
  C, CashOutScreen, HomeScreen, ModalFrame, Phone, PrimaryBtn, ReviewScreen, Screen, StepBar, Tap, usePop, useProgress,
} from './ui';

export const FPS = 30;
const S = (sec: number) => Math.round(sec * FPS);
/** Scene lengths in seconds. They add up to 45. */
export const SCENES = { hook: 5.5, cashout: 8.5, tracker: 6.5, add: 9.5, ready: 8, outro: 7 } as const;
export const TOTAL_FRAMES = S(45);

const sfx = (name: string, at: number, volume = 1) => (
  <Sequence from={at} durationInFrames={S(1.5)} layout="none">
    <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
  </Sequence>
);
const vo = (name: string, at = S(0.35)) => (
  <Sequence from={at} layout="none">
    <Audio src={staticFile(`vo/${name}.wav`)} volume={1} />
  </Sequence>
);

/** Background: lilac with a few slow stickers. */
const Backdrop: React.FC = () => {
  const f = useCurrentFrame();
  const bob = (k: number, a: number) => Math.sin((f + k) / 28) * a;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div style={{ position: 'absolute', left: -200, top: 820 + bob(0, 14), width: 420, height: 420, borderRadius: 999, background: C.ye, border: '5px solid #111' }} />
      <div style={{ position: 'absolute', right: 80, top: -140 + bob(40, 10), width: 360, height: 360, borderRadius: 999, background: C.mi, border: '5px solid #111' }} />
      {f < S(38) && <div style={{ position: 'absolute', left: 1100, top: 930 + bob(80, 12), width: 130, height: 130, borderRadius: 40, background: '#fff', border: '5px solid #111', transform: 'rotate(14deg)' }} />}
    </AbsoluteFill>
  );
};

/** Big words on the left, and the spoken line as a caption along the bottom. */
const Words: React.FC<{ kicker: string; title: React.ReactNode; lines?: string[]; caption: string }> = ({ kicker, title, lines = [], caption }) => {
  const pop = usePop(2);
  const f = useCurrentFrame();
  return (
    <>
      <div style={{ position: 'absolute', left: 130, top: 250, width: 820, opacity: pop, transform: `translateY(${(1 - pop) * 30}px)` }}>
        <div style={{ display: 'inline-block', fontFamily: 'Inter', fontWeight: 800, fontSize: 28, letterSpacing: 2, color: C.ink, background: '#fff', border: '4px solid #111', borderRadius: 99, padding: '8px 22px', boxShadow: '5px 5px 0 #111' }}>{kicker}</div>
        <div style={{ fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 112, lineHeight: 1.02, marginTop: 34, color: C.ink }}>{title}</div>
        <div style={{ marginTop: 34, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {lines.map((l, i) => {
            const p = interpolate(f, [24 + i * 22, 38 + i * 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div key={l} style={{ opacity: p, transform: `translateX(${(1 - p) * -24}px)`, fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 42, color: C.ink, display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ width: 22, height: 22, borderRadius: 99, background: C.pu, border: '4px solid #111', display: 'inline-block' }} />
                {l}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 130, bottom: 64, width: 960 }}>
        <div style={{ display: 'inline-block', fontFamily: 'Inter', fontWeight: 700, fontSize: 30, lineHeight: 1.35, color: C.ink, background: '#fff', border: '4px solid #111', borderRadius: 18, padding: '14px 28px', boxShadow: '5px 5px 0 #111' }}>{caption}</div>
      </div>
    </>
  );
};

const PhoneSlot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pop = usePop(0, 18);
  return (
    <div style={{ position: 'absolute', right: 150, top: 80, transform: `translateY(${(1 - pop) * 120}px) rotate(${(1 - pop) * 4}deg)`, opacity: Math.min(1, pop * 2) }}>
      <Phone>{children}</Phone>
    </div>
  );
};

/* ───────────────────────────── Scene 1: hook ───────────────────────────── */
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const bal = Math.round(interpolate(f, [10, 55], [0, 50000], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  return (
    <AbsoluteFill>
      <Words kicker="GOODCASH" title={<>G$ in.<br />Naira out.</>} lines={['Cash out to your bank', 'Add G$ with naira']} caption="Got G dollars? Turn them into naira, or add more, right from your phone." />
      <PhoneSlot>
        <HomeScreen balance={bal.toLocaleString('en-US') + '.0'} naira="₦7,774" />
      </PhoneSlot>
      {sfx('whoosh', 0, 0.7)}
      {sfx('pop', 12)}
      {vo('s1')}
    </AbsoluteFill>
  );
};

/* ─────────────────────── Scene 2: cash out (off-ramp) ─────────────────────── */
const typed = ['', '5', '50', '500', '5,000'];
const CashOut: React.FC = () => {
  const f = useCurrentFrame();
  const typedStep = f < 40 ? 0 : f < 52 ? 1 : f < 64 ? 2 : f < 76 ? 3 : 4;
  const naira = typedStep === 4 ? '₦727' : typedStep === 3 ? '₦73' : typedStep === 2 ? '₦7' : '₦0';
  return (
    <AbsoluteFill>
      <Words kicker="CASH OUT" title={<>See it.<br />Confirm once.</>} lines={['Exact naira before you commit', 'One confirmation in your wallet']} caption="To cash out, enter an amount and see exactly what you'll get. Then confirm once in your wallet." />
      <PhoneSlot>
        <Screen from={0} to={130} slide={false}>
          <CashOutScreen amount={typed[typedStep]} naira={naira} usd={typedStep === 4 ? '$0.57' : '$0.00'} pressed={f > 112 && f < 124} />
          <Tap x={195} y={745} at={112} />
        </Screen>
        <Screen from={128} to={999}>
          <ReviewScreen pressed={f > 205 && f < 216} working={f >= 214} />
          <Tap x={195} y={750} at={205} />
        </Screen>
      </PhoneSlot>
      {sfx('tick', 40, 0.9)}{sfx('tick', 52, 0.9)}{sfx('tick', 64, 0.9)}{sfx('tick', 76, 0.9)}
      {sfx('tap', 112)}
      {sfx('whoosh', 126, 0.5)}
      {sfx('tap', 205)}
      {vo('s2')}
    </AbsoluteFill>
  );
};

/* ───────────────────────────── Scene 3: tracker ───────────────────────────── */
const TrackerRow: React.FC<{ label: string; at: number }> = ({ label, at }) => {
  const p = useProgress(at, 10);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.35 + 0.65 * p }}>
      <span style={{ width: 28, height: 28, borderRadius: 99, border: '2.5px solid #111', background: p > 0.5 ? C.mi : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>{p > 0.5 ? '✓' : ''}</span>
      <span className="gc-sm" style={{ fontWeight: 800, fontSize: 15 }}>{label}</span>
    </div>
  );
};
const Tracker: React.FC = () => {
  const done = useProgress(110, 10);
  const email = usePop(140, 16);
  return (
    <AbsoluteFill>
      <Words kicker="CASH OUT" title={<>Watch it<br />land.</>} lines={['Live status, no refreshing', 'Email when the naira is sent']} caption="Now just watch it go. Your naira lands in your bank, and we can email you the moment it does." />
      <PhoneSlot>
        <div style={{ position: 'absolute', inset: 0, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="gc-top" style={{ position: 'relative' }}>
            <span className="gc-back">✕</span>
            <span className="gc-title" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Your cash out</span>
            <span style={{ width: 34 }} />
          </div>
          <StepBar steps={['Amount', 'Review', 'Confirm', 'Done']} at={done > 0.5 ? 3 : 2} />
          <div className="gc-card" style={{ background: done > 0.5 ? C.mi : '#fff' }}>
            <div className="gc-lab">{done > 0.5 ? 'PAID TO YOUR BANK' : 'ON ITS WAY'}</div>
            <div className="gc-big">₦727</div>
            <div className="gc-sm">Moniepoint MFB · ADA OBI</div>
          </div>
          <div className="gc-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <TrackerRow label="G$ converted" at={26} />
            <TrackerRow label="Sent to payout partner" at={62} />
            <TrackerRow label="Naira paid to your bank" at={110} />
          </div>
          <div className="gc-note" style={{ opacity: email, transform: `translateY(${(1 - email) * 20}px)`, background: '#fff3c4' }}>
            ✉ <b>Email sent:</b> Your ₦727 has been sent to your bank.
          </div>
        </div>
      </PhoneSlot>
      {sfx('pop', 28)}{sfx('pop', 64)}{sfx('ding', 110)}{sfx('pop', 140, 0.7)}
      {vo('s3', S(0.3))}
    </AbsoluteFill>
  );
};

/* ───────────────────────── Scene 4: add G$ (on-ramp) ───────────────────────── */
const Bank: React.FC<{ k: string; v: string; big?: boolean; at: number }> = ({ k, v, big, at }) => {
  const p = usePop(at, 16);
  return (
    <div className="gc-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
      <div>
        <div className="gc-lab">{k}</div>
        <b style={{ fontSize: big ? 21 : 15 }}>{v}</b>
      </div>
      <span className="gc-pill">Copy</span>
    </div>
  );
};
const Add: React.FC = () => {
  const f = useCurrentFrame();
  const typedStep = f < 22 ? 0 : f < 34 ? 1 : f < 46 ? 2 : f < 58 ? 3 : 4;
  const modal = usePop(8, 18);
  const quote = useProgress(62, 12);
  return (
    <AbsoluteFill>
      <Words kicker="ADD G$" title={<>Pay by<br />bank transfer.</>} lines={['Pick an amount', 'Send to the account we show you']} caption="Need more G dollars? Add them with naira. Choose an amount, then send a bank transfer to the account we show you." />
      <PhoneSlot>
        <HomeScreen balance="0.0" naira="₦0" percent={0} />
        <ModalFrame title="Add G$" progress={modal} footer={<PrimaryBtn label={f < 165 ? 'Continue' : "I've sent the money"} pressed={(f > 100 && f < 110) || (f > 232 && f < 242)} />}>
          <StepBar steps={['Amount', 'Details', 'Pay', 'Get G$']} at={f < 100 ? 0 : f < 128 ? 1 : 2} />
          <div style={{ position: 'relative', flex: 1 }}>
          <Screen from={0} to={128} slide={false}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="gc-lab">HOW MUCH NAIRA DO YOU WANT TO ADD?</div>
              <div style={{ border: '2.5px solid #111', borderRadius: 12, padding: '10px 14px', fontFamily: 'Inter', fontWeight: 800, fontSize: 18 }}>{typedStep ? '₦' + ['', '5', '50', '500', '5,000'][typedStep] : '₦5,000'}</div>
              <div className="gc-note" style={{ background: C.mi, opacity: quote }}>
                <div className="gc-lab">YOU WILL GET ABOUT</div>
                <b style={{ fontSize: 24 }}>29,570 G$</b>
                <div className="gc-sm">for ₦5,000. Fees are included.</div>
              </div>
              <div className="gc-note">You pay by bank transfer, from your own bank account.</div>
            </div>
          </Screen>
          <Screen from={126} to={999}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="gc-note" style={{ background: '#fff3c4', fontSize: 12 }}>Send exactly <b>₦5,000</b> to this account, from <b>your own account</b>.</div>
              <Bank k="BANK" v="Moniepoint MFB" at={134} />
              <Bank k="ACCOUNT NUMBER" v="8012345678" big at={146} />
              <Bank k="AMOUNT" v="₦5,000" big at={158} />
              <div className="gc-sm">Pay within <b>29:41</b>.</div>
            </div>
          </Screen>
          </div>
        </ModalFrame>
        <Tap x={195} y={715} at={100} />
        <Tap x={195} y={715} at={232} />
      </PhoneSlot>
      {sfx('whoosh', 4, 0.5)}
      {sfx('tick', 22, 0.9)}{sfx('tick', 34, 0.9)}{sfx('tick', 46, 0.9)}{sfx('tick', 58, 0.9)}
      {sfx('pop', 64)}{sfx('tap', 100)}{sfx('whoosh', 124, 0.45)}
      {sfx('pop', 134, 0.6)}{sfx('pop', 146, 0.6)}{sfx('pop', 158, 0.6)}
      {sfx('tap', 232)}
      {vo('s4')}
    </AbsoluteFill>
  );
};

/* ──────────────────────── Scene 5: the money is here ──────────────────────── */
const Ready: React.FC = () => {
  const f = useCurrentFrame();
  const modal = usePop(0, 18);
  const bal = Math.round(interpolate(f, [150, 185], [0, 29570], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const arrivedNote = usePop(10);
  return (
    <AbsoluteFill>
      <Words kicker="ADD G$" title={<>It opens.<br />You tap.</>} lines={['The page opens by itself', 'One tap. No fee to sign.']} caption="When your money arrives, the page opens by itself. Tap once, and your G dollars are in your wallet." />
      <PhoneSlot>
        <HomeScreen balance={bal.toLocaleString('en-US') + '.0'} naira={bal > 0 ? '₦4,590' : '₦0'} percent={bal > 0 ? 100 : 0} />
        <ModalFrame
          title={f < 110 ? 'Get your G$ now' : f < 150 ? 'Getting your G$' : 'All done'}
          progress={f > 215 ? Math.max(0, 1 - (f - 215) / 14) : modal}
          footer={f >= 150 ? <PrimaryBtn label="Done" /> : <PrimaryBtn label="Get my G$" pressed={f > 92 && f < 102} />}
        >
          <StepBar steps={['Amount', 'Details', 'Pay', 'Get G$']} at={3} />
          {f < 110 && (
            <>
              <div className="gc-note" style={{ background: C.mi }}>
                <b style={{ fontSize: 18 }}>Your ₦5,000 has arrived!</b>
                <div className="gc-sm" style={{ marginTop: 4 }}>It is waiting for you. <b>Tap "Get my G$" below to receive your G$ in your wallet.</b></div>
              </div>
              <div className="gc-note">Your wallet may ask you to sign one message. It costs you no fee. Please keep this tab open.</div>
            </>
          )}
          {f >= 110 && f < 150 && (
            <div className="gc-note" style={{ background: '#fff3c4' }}><b>Almost there. Please keep this tab open.</b> It takes about a minute.</div>
          )}
          {f >= 150 && (
            <div className="gc-note" style={{ background: C.mi }}>
              <b style={{ fontSize: 20 }}>Your G$ has arrived.</b>
              <div className="gc-sm">It is in your wallet now. You can cash out any time.</div>
            </div>
          )}
        </ModalFrame>
        {f < 60 && <div className="gc-note" style={{ position: 'absolute', left: 16, right: 16, bottom: 120, background: C.mi, opacity: arrivedNote }}>✓ Your money has arrived. Tap "Get my G$" to finish.</div>}
        <Tap x={195} y={715} at={92} />
      </PhoneSlot>
      {sfx('whoosh', 0, 0.6)}{sfx('ding', 6)}
      {sfx('tap', 92)}
      {sfx('chime', 150, 0.9)}
      {vo('s5')}
    </AbsoluteFill>
  );
};

/* ───────────────────────────────── Scene 6 ───────────────────────────────── */
const Outro: React.FC = () => {
  const pop = usePop(4, 14);
  const chips = ['Non-custodial', 'Plain language', 'Open source'];
  const tagline = useProgress(24, 14);
  const urlPop = usePop(80, 16);
  const chipPops = [usePop(40, 16), usePop(48, 16), usePop(56, 16)];
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <div style={{ transform: `scale(${0.7 + 0.3 * pop})`, opacity: pop, fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 190, color: C.ink, letterSpacing: -4 }}>GoodCash</div>
        <div style={{ opacity: tagline, fontFamily: 'Bricolage Grotesque', fontWeight: 800, fontSize: 64, color: C.ink }}>Your money stays yours.</div>
        <div style={{ display: 'flex', gap: 22 }}>
          {chips.map((c, i) => {
            const p = chipPops[i];
            return <span key={c} style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)`, fontFamily: 'Inter', fontWeight: 800, fontSize: 32, color: C.ink, background: '#fff', border: '4px solid #111', borderRadius: 99, padding: '10px 28px', boxShadow: '5px 5px 0 #111' }}>{c}</span>;
          })}
        </div>
        <div style={{ opacity: urlPop, fontFamily: 'Inter', fontWeight: 800, fontSize: 44, background: C.pu, color: '#fff', border: '5px solid #111', borderRadius: 24, padding: '16px 44px', boxShadow: '7px 7px 0 #111' }}>goodcash.xyz</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 40, textAlign: 'center', fontFamily: 'Inter', fontWeight: 600, fontSize: 22, color: '#2b1d55' }}>Amounts shown are examples. Rates and fees change.</div>
      {sfx('pop', 6)}{sfx('pop', 42, 0.7)}{sfx('pop', 50, 0.7)}{sfx('pop', 58, 0.7)}{sfx('ding', 82)}
      {vo('s6', S(0.5))}
    </AbsoluteFill>
  );
};

/* ───────────────────────────────── the film ───────────────────────────────── */
export const GoodCashDemo: React.FC = () => {
  let t = 0;
  const seq = (sec: number, el: React.ReactNode, key: string) => {
    const from = t;
    t += S(sec);
    return (
      <Sequence key={key} from={from} durationInFrames={S(sec)}>
        {el}
      </Sequence>
    );
  };
  return (
    <AbsoluteFill>
      <Backdrop />
      {seq(SCENES.hook, <Hook />, 'hook')}
      {seq(SCENES.cashout, <CashOut />, 'cashout')}
      {seq(SCENES.tracker, <Tracker />, 'tracker')}
      {seq(SCENES.add, <Add />, 'add')}
      {seq(SCENES.ready, <Ready />, 'ready')}
      {seq(SCENES.outro, <Outro />, 'outro')}
    </AbsoluteFill>
  );
};
