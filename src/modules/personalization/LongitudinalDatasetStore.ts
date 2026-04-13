const KEY = 'ppg_longitudinal_sessions_v1';

export interface SessionSummary {
  ts: number;
  signalQuality: number;
  rhythmLabel?: string;
  spo2?: number;
  bp?: { sys: number; dia: number };
  glucose?: number;
  lipids?: { tc: number; tg: number };
}

export class LongitudinalDatasetStore {
  private sessions: SessionSummary[] = [];

  constructor() {
    try {
      const r = localStorage.getItem(KEY);
      if (r) this.sessions = JSON.parse(r) as SessionSummary[];
    } catch {
      this.sessions = [];
    }
  }

  append(s: SessionSummary): void {
    this.sessions.push(s);
    if (this.sessions.length > 200) this.sessions.shift();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.sessions));
    } catch { /* ignore */ }
  }

  recent(n = 30): SessionSummary[] {
    return this.sessions.slice(-n);
  }
}
