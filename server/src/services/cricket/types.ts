export type Format = 't20' | 't20i' | 'odi' | 'test';
export type MatchState = 'upcoming' | 'live' | 'done';
export type RuleKey = 'ipl_mi' | 'india_t20' | 'india_odi' | 'india_test';

export type Innings = { team: string; inning: number; runs: number; wkts: number; overs: number };
export type Batter = { name: string; runs: number; balls: number; out: boolean };

export type Match = {
  id: string;                // stable key, e.g. "cd:<uuid>", "sm:<id>", "ci:<id>"
  source: 'cricketdata' | 'sportmonks' | 'cricinfo';
  name: string;              // "Mumbai Indians vs Chennai Super Kings, 12th Match"
  format: Format;
  teams: [string, string];
  short?: [string, string];
  startsAt?: string;         // ISO
  venue?: string;
  series?: string;
  status: string;            // provider status text, e.g. "India need 45 runs in 30 balls"
  state: MatchState;
  innings: Innings[];
  batters?: Batter[];
  rule?: RuleKey;
  updatedAt: string;
};

/** A provider that can list fixtures and/or live matches. All methods must be cheap to call when not configured. */
export interface ScoreSource {
  name: Match['source'];
  enabled(): boolean;
  fixtures?(): Promise<Match[]>;
  live(): Promise<Match[]>;
}
