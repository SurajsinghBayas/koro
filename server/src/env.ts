// All configuration comes from environment variables (see .env.example).
const str = (k: string, d = '') => (process.env[k] ?? d).trim();
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d;
};

export const env = {
  PORT: num('PORT', 8787),
  HOST: str('HOST', '0.0.0.0'),
  /** Neon pooled URL in production. `pglite:<dir>` runs an embedded Postgres for local dev. */
  DATABASE_URL: str('DATABASE_URL', 'pglite:./data/pglite'),
  DATA_DIR: str('DATA_DIR', './data'),
  /** One-time code you type into the app (and Mac script) to pair a device. */
  SETUP_CODE: str('SETUP_CODE'),
  TZ: str('APP_TZ', 'Asia/Kolkata'),

  // Cricket sources (all optional; without keys the server uses the free Cricinfo RSS only)
  CRICKETDATA_API_KEY: str('CRICKETDATA_API_KEY'),
  CRICKETDATA_DAILY_BUDGET: num('CRICKETDATA_DAILY_BUDGET', 95),
  SPORTMONKS_API_TOKEN: str('SPORTMONKS_API_TOKEN'),
  TRACK_INDIA_WOMEN: str('TRACK_INDIA_WOMEN') === '1',

  // Push (Firebase Cloud Messaging). Optional: without it, alerts are kept in an in-app inbox.
  FCM_SERVICE_ACCOUNT_JSON: str('FCM_SERVICE_ACCOUNT_JSON'), // raw JSON or path to file
  /** Public Firebase app config handed to the phone so it can register for push. */
  FIREBASE_APP_ID: str('FIREBASE_APP_ID'),
  FIREBASE_API_KEY: str('FIREBASE_API_KEY'),
  FIREBASE_SENDER_ID: str('FIREBASE_SENDER_ID'),
  FIREBASE_PROJECT_ID: str('FIREBASE_PROJECT_ID'),

  // AI via Bedrock Mantle (OpenAI-compatible)
  AI_API_KEY: str('AI_API_KEY') || str('OPENAI_API_KEY'),
  AI_BASE_URL: str('AI_BASE_URL') || str('OPENAI_BASE_URL'),
  AI_MODEL: str('AI_MODEL', 'zai.glm-5'),

  /** Set to 0 in tests to disable background jobs. */
  JOBS: str('JOBS', '1') !== '0',
};

export const aiEnabled = () => Boolean(env.AI_API_KEY && env.AI_BASE_URL);
