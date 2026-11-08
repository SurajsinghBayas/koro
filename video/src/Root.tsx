import { Composition } from 'remotion';
import { Film } from './Film';
import { Reel, REEL_DURATION, REEL_FPS } from './Reel';
import { Cinema, CINE_DURATION, CINE_FPS } from './Cinema';
import { FPS, TOTAL } from './scenes';

export const Root = () => (
  <>
    <Composition id="KoroFilm" component={Film} durationInFrames={TOTAL} fps={FPS} width={3840} height={2160} />
    <Composition id="KoroReel" component={Reel} durationInFrames={REEL_DURATION} fps={REEL_FPS} width={2160} height={3840} />
    {/* No text: the building blocks for the edit in the Edits app */}
    <Composition id="KoroReelClean" component={Reel} defaultProps={{ clean: true }} durationInFrames={REEL_DURATION} fps={REEL_FPS} width={2160} height={3840} />
    {/* The cinematic cut: 3D devices, macro shots, camera moves. Song added in Edits from 0:34.78. */}
    <Composition id="KoroCinema" component={Cinema} durationInFrames={CINE_DURATION} fps={CINE_FPS} width={1440} height={2560} />
  </>
);
