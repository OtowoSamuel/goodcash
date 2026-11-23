import { staticFile } from 'remotion';

// GoodCash brand (goodcash-brand skill) for the video's own frame, captions and cards
export const BRAND = {
  lilac: '#cdb8ff',
  ink: '#111111',
  purple: '#7b39fc',
  yellow: '#ffd23f',
  mint: '#8cf0c0',
  white: '#ffffff',
};

// The partner docs site's own palette (scripts/build-docs.mjs), so the rebuilt pages look like the real ones
export const DOCS = {
  bg: '#ffffff',
  fg: '#14111f',
  mut: '#5d5873',
  line: '#e6e2f2',
  brand: '#7b39fc',
  soft: '#f5f1ff',
  code: '#f3f1f8',
};

export const SYS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const HEAD = '"Bricolage", system-ui, sans-serif';
export const MONO = '"SF Mono", Menlo, Consolas, monospace';

export const FPS = 30;

export const fontCss = `
@font-face { font-family: 'Bricolage'; src: url('${staticFile('BricolageGrotesque-Bold.ttf')}') format('truetype'); font-weight: 700 800; }
`;

// Fictional partner shown throughout. Keys are made up and masked; nothing real appears on screen.
export const DEMO = {
  name: 'Demo Game',
  email: 'dev@demogame.example',
  site: 'https://demogame.example',
  pkTest: 'gc_pk_test_7Qm2••••••••••••••••',
  skTest: 'gc_sk_test_4Rx9••••••••••••••••',
  pkLive: 'gc_pk_live_9Ld3••••••••••••••••',
  skLive: 'gc_sk_live_2Wf8••••••••••••••••',
};
