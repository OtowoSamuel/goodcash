import { Composition } from 'remotion';
import { LiveKeysVideo, LiveKeysSquare, FULL_FRAMES, SHORT_FRAMES } from './Video';
import { FPS } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="LiveKeys" component={LiveKeysVideo} durationInFrames={FULL_FRAMES} fps={FPS} width={1920} height={1080} />
    <Composition id="LiveKeysSquare" component={LiveKeysSquare} durationInFrames={SHORT_FRAMES} fps={FPS} width={1080} height={1080} />
  </>
);
