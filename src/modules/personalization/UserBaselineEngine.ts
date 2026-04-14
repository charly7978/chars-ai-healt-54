const KEY = 'ppg_user_baseline_v1';

export type PersonalizationState = 'NONE' | 'INITIALIZED' | 'PARTIAL' | 'STRONG';

export interface UserBaselines {
  glucoseEma: number;
  cholesterolEma: number;
  triglyceridesEma: number;
  spo2Ema: number;
  sessionsWithCalibration: number;
  personalizationState: PersonalizationState;
}

export class UserBaselineEngine {
  private baselines: UserBaselines;

  constructor() {
    this.baselines = UserBaselineEngine.load() ?? {
      glucoseEma: 0,
      cholesterolEma: 0,
      triglyceridesEma: 0,
      spo2Ema: 0,
      sessionsWithCalibration: 0,
      personalizationState: 'NONE',
    };
  }

  static load(): UserBaselines | null {
    try {
      const r = localStorage.getItem(KEY);
      return r ? (JSON.parse(r) as UserBaselines) : null;
    } catch {
      return null;
    }
  }

  get(): UserBaselines {
    return { ...this.baselines };
  }

  updateFromSession(partial: Partial<UserBaselines>): void {
    const b = { ...this.baselines };
    if (partial.glucoseEma !== undefined) {
      b.glucoseEma = b.glucoseEma > 0 ? b.glucoseEma * 0.88 + partial.glucoseEma * 0.12 : partial.glucoseEma;
    }
    if (partial.cholesterolEma !== undefined) {
      b.cholesterolEma = b.cholesterolEma > 0 ? b.cholesterolEma * 0.88 + partial.cholesterolEma * 0.12 : partial.cholesterolEma;
    }
    if (partial.triglyceridesEma !== undefined) {
      b.triglyceridesEma = b.triglyceridesEma > 0 ? b.triglyceridesEma * 0.88 + partial.triglyceridesEma * 0.12 : partial.triglyceridesEma;
    }
    if (partial.spo2Ema !== undefined) b.spo2Ema = partial.spo2Ema;
    if (partial.sessionsWithCalibration !== undefined) b.sessionsWithCalibration = partial.sessionsWithCalibration;
    this.baselines = b;
    if (this.baselines.sessionsWithCalibration >= 8) this.baselines.personalizationState = 'STRONG';
    else if (this.baselines.sessionsWithCalibration >= 3) this.baselines.personalizationState = 'PARTIAL';
    else if (this.baselines.glucoseEma > 0 || this.baselines.cholesterolEma > 0) this.baselines.personalizationState = 'INITIALIZED';
    else this.baselines.personalizationState = 'NONE';
    try {
      localStorage.setItem(KEY, JSON.stringify(this.baselines));
    } catch { /* ignore */ }
  }

  recordCalibrationEvent(): void {
    this.updateFromSession({ sessionsWithCalibration: this.baselines.sessionsWithCalibration + 1 });
  }
}
