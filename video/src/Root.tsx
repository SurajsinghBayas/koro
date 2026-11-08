import { Composition } from 'remotion';
import { Film } from './Film';
import { FPS, TOTAL } from './scenes';

export const Root = () => (
  <Composition id="KoroFilm" component={Film} durationInFrames={TOTAL} fps={FPS} width={3840} height={2160} />
);
