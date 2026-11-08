/** The film's script. Each feature scene plays a real screen recording of Koro (public/clips/<clip>). */
export type Scene = {
  id: string; kicker: string; title: string; bullets: string[]; accent: string;
  clip?: string; rate?: number; start?: number; // seconds into the clip
  side: 'left' | 'right';
};
export const FPS = 30;
export const INTRO = 4.5 * FPS, SCENE = 7 * FPS, OUTRO = 5.5 * FPS, T = 18; // T = transition frames

export const SCENES: Scene[] = [
  { id: 'today', kicker: 'TODAY', title: 'Your whole day,\nbriefed by AI', accent: '#F2C14E', clip: 'today.mp4', rate: 1.4, start: 1.2, side: 'left',
    bullets: ['A festival-aware brief from weather, tasks, cricket and news', 'Say “milk, eggs, call bank 10am, gym Mon Wed Fri” and it all lands', 'Pull down for only what changed'] },
  { id: 'player', kicker: 'NOW PLAYING', title: 'A holographic\nmusic player', accent: '#C38BFF', clip: 'player.mp4', rate: 1.5, start: 0.6, side: 'right',
    bullets: ['Synced lyrics, Up next, Like and Shuffle', 'Find any song and it plays in YT Music with a radio', 'Phone or Mac, whichever is playing'] },
  { id: 'mac', kicker: 'MAC REMOTE', title: 'Your Mac,\nin your pocket', accent: '#5EC8FF', clip: 'mac.mp4', rate: 2.3, start: 1, side: 'left',
    bullets: ['Volume and brightness with on-screen bars', 'Keep awake with Amphetamine · Sleep on / off', 'Work mode opens WhatsApp, Terminal and Gmail'] },
  { id: 'matches', kicker: 'CRICKET', title: 'India and MI,\nlive', accent: '#FF6B7A', clip: 'matches.mp4', rate: 1.35, start: 1.2, side: 'right',
    bullets: ['Live scores, scorecards and results', 'The buzz from X, milestones as a push', 'A live-score widget on your home screen'] },
  { id: 'news', kicker: 'NEWS & YOUTUBE', title: 'Read less,\nknow more', accent: '#7EE0A1', clip: 'news.mp4', rate: 1.35, start: 1.2, side: 'left',
    bullets: ['AI digests for World, India, AI and Startups', 'Any video, fully explained, saved as PDF or Markdown', 'Read later, offline'] },
  { id: 'well', kicker: 'WELLBEING', title: 'Time well\nspent', accent: '#F2C14E', clip: 'well.mp4', rate: 1.35, start: 1.2, side: 'right',
    bullets: ['A daily limit for any app', 'Water, focus and sleep timers', 'Screen time at a glance'] },
  { id: 'sync', kicker: 'ONE CLIPBOARD', title: 'Mac and phone,\nas one', accent: '#5EC8FF', side: 'left',
    bullets: ['Copy on the Mac, paste on the phone: text and images', 'Share to Koro, then ⌘V on the Mac', 'Find your phone from the menu bar'] },
];
export const TOTAL = INTRO + SCENES.length * SCENE + OUTRO - (SCENES.length + 1) * T;
