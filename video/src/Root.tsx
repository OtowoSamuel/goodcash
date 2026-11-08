import { Composition } from 'remotion';
import { FPS, GoodCashDemo, TOTAL_FRAMES } from './Video';

export const RemotionRoot: React.FC = () => (
  <Composition id="GoodCashDemo" component={GoodCashDemo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
