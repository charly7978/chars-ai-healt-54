import { BandpassFilter } from './BandpassFilter';

/**
 * WINNER-TAKES-ALL MULTI-CHANNEL SIGNAL SELECTOR
 * 
 * Evalúa múltiples señales candidatas por ventana (R, G, B, R-G, G-B, CHROM-like),
 * las rankea por SNR espectral, consistencia morfológica y estabilidad temporal,
 * y selecciona automáticamente la mejor señal para el pipeline downstream.
 * 
 * Evita dependencia de un único canal fijo (ej: solo verde) — adapta dinámicamente
 * al dispositivo, condiciones de iluminación y perfusión del sujeto.
 * 
 * Referencias:
 * - De Haan & Jeanne (2013): CHROM color-combination for rPPG
 * - Wang et al. (2017): POS projection for pulse extraction
 * - Verkruysse et al. (2008): Green channel dominance in PPG
 */

export interface CandidateSignal {
  id: string;
  label: string;
  snr: number;
  morphologyScore: number;
  stabilityScore: number;
  compositeScore: number;
  filteredValue: number;
  rawValue: number;
}

export interface WTAResult {
  /** Best signal's filtered value to use downstream */
  filteredValue: number;
  /** Best signal's raw (inverted) value */
  rawValue: number;
  /** Winning channel ID */
  winnerId: string;
  /** Winning channel label for display */
  winnerLabel: string;
  /** All candidates with scores (for debug) */
  candidates: CandidateSignal[];
  /** Composite score of winner (0-100) */
  winnerScore: number;
}

const CHANNEL_DEFS = [
  { id: 'G',    label: 'Green',  extract: (r: number, g: number, b: number) => g },
  { id: 'R',    label: 'Red',    extract: (r: number, g: number, b: number) => r },
  { id: 'B',    label: 'Blue',   extract: (r: number, g: number, b: number) => b },
  { id: 'RG',   label: 'R−G',    extract: (r: number, g: number, b: number) => r - g },
  { id: 'GB',   label: 'G−B',    extract: (r: number, g: number, b: number) => g - b },
  { id: 'CHROM', label: 'CHROM', extract: (r: number, g: number, b: number) => {
    // Simplified CHROM: 3R - 2G (De Haan & Jeanne 2013 approximation)
    return 3 * r - 2 * g;
  }},
] as const;

const WINDOW_SIZE = 120;  // 4 seconds @ 30fps
const MIN_SAMPLES = 45;   // 1.5s minimum for evaluation
const MEMORY_ALPHA = 0.3; // Smoothing for winner transitions (prevents jitter)

export class WinnerTakesAllSelector {
  private channelBuffers: Map<string, number[]> = new Map();
  private channelFilters: Map<string, BandpassFilter> = new Map();
  private channelFilteredBuffers: Map<string, number[]> = new Map();
  
  private currentWinnerId: string = 'G'; // Default to green (literature standard)
  private smoothedScores: Map<string, number> = new Map();
  private frameCount: number = 0;
  private lastEvalTime: number = 0;
  
  constructor() {
    for (const ch of CHANNEL_DEFS) {
      this.channelBuffers.set(ch.id, []);
      this.channelFilters.set(ch.id, new BandpassFilter(30));
      this.channelFilteredBuffers.set(ch.id, []);
      this.smoothedScores.set(ch.id, ch.id === 'G' ? 50 : 30); // Slight green bias initially
    }
  }

  /**
   * Feed a new RGB sample and get the best signal
   */
  process(rawRed: number, rawGreen: number, rawBlue: number): WTAResult {
    this.frameCount++;
    
    // 1. Extract and filter each candidate channel
    const candidates: CandidateSignal[] = [];
    
    for (const ch of CHANNEL_DEFS) {
      const raw = ch.extract(rawRed, rawGreen, rawBlue);
      const inverted = (ch.id === 'RG' || ch.id === 'GB' || ch.id === 'CHROM') 
        ? raw  // Differential channels: don't invert
        : 255 - raw;  // Single channels: invert for PPG convention
      
      // Buffer raw
      const buf = this.channelBuffers.get(ch.id)!;
      buf.push(inverted);
      if (buf.length > WINDOW_SIZE) buf.shift();
      
      // Filter
      const filter = this.channelFilters.get(ch.id)!;
      const filtered = filter.filter(inverted);
      
      const filtBuf = this.channelFilteredBuffers.get(ch.id)!;
      filtBuf.push(filtered);
      if (filtBuf.length > WINDOW_SIZE) filtBuf.shift();
      
      candidates.push({
        id: ch.id,
        label: ch.label,
        snr: 0,
        morphologyScore: 0,
        stabilityScore: 0,
        compositeScore: 0,
        filteredValue: filtered,
        rawValue: inverted,
      });
    }

    // 2. Evaluate every ~1 second (30 frames) when we have enough data
    const now = Date.now();
    if (now - this.lastEvalTime >= 1000 && this.frameCount >= MIN_SAMPLES) {
      this.lastEvalTime = now;
      this.evaluateCandidates(candidates);
    } else {
      // Use smoothed scores from last evaluation
      for (const c of candidates) {
        c.compositeScore = this.smoothedScores.get(c.id) || 0;
      }
    }

    // 3. Select winner (highest smoothed composite score)
    let bestCandidate = candidates[0];
    for (const c of candidates) {
      const score = this.smoothedScores.get(c.id) || 0;
      if (score > (this.smoothedScores.get(bestCandidate.id) || 0)) {
        bestCandidate = c;
      }
    }
    
    this.currentWinnerId = bestCandidate.id;

    return {
      filteredValue: bestCandidate.filteredValue,
      rawValue: bestCandidate.rawValue,
      winnerId: bestCandidate.id,
      winnerLabel: bestCandidate.label,
      candidates: candidates.sort((a, b) => 
        (this.smoothedScores.get(b.id) || 0) - (this.smoothedScores.get(a.id) || 0)
      ),
      winnerScore: this.smoothedScores.get(bestCandidate.id) || 0,
    };
  }

  /**
   * Full evaluation of all candidates — runs ~1Hz
   */
  private evaluateCandidates(candidates: CandidateSignal[]): void {
    for (const c of candidates) {
      const filtBuf = this.channelFilteredBuffers.get(c.id)!;
      if (filtBuf.length < MIN_SAMPLES) {
        c.compositeScore = 0;
        continue;
      }

      c.snr = this.calculateSNR(filtBuf);
      c.morphologyScore = this.calculateMorphologyScore(filtBuf);
      c.stabilityScore = this.calculateStabilityScore(filtBuf);

      // Composite: SNR is king (50%), morphology (30%), stability (20%)
      const rawScore = c.snr * 0.50 + c.morphologyScore * 0.30 + c.stabilityScore * 0.20;
      c.compositeScore = rawScore;

      // Smooth scores to prevent jitter
      const prev = this.smoothedScores.get(c.id) || 0;
      // Faster rise, slower fall (hysteresis for stability)
      const alpha = rawScore > prev ? 0.4 : MEMORY_ALPHA;
      this.smoothedScores.set(c.id, prev * (1 - alpha) + rawScore * alpha);
    }
  }

  /**
   * SNR: Signal power in cardiac band vs noise
   * Higher = better signal
   */
  private calculateSNR(buffer: number[]): number {
    if (buffer.length < 30) return 0;
    
    const recent = buffer.slice(-90);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.1) return 0;
    
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    let variance = 0;
    for (let i = 0; i < recent.length; i++) {
      variance += (recent[i] - mean) ** 2;
    }
    variance /= recent.length;
    const stdDev = Math.sqrt(variance);
    
    // SNR approximation: range / noise
    const snr = range / (stdDev + 0.01);
    return Math.min(100, Math.max(0, snr * 15));
  }

  /**
   * Morphology: quasi-periodicity check
   * Looks for consistent peak-to-peak intervals (cardiac rhythm)
   */
  private calculateMorphologyScore(buffer: number[]): number {
    if (buffer.length < 45) return 0;
    
    const recent = buffer.slice(-90);
    
    // Find zero crossings (positive slope)
    const crossings: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1] <= 0 && recent[i] > 0) {
        crossings.push(i);
      }
    }
    
    if (crossings.length < 3) return 0;
    
    // Calculate intervals between crossings
    const intervals: number[] = [];
    for (let i = 1; i < crossings.length; i++) {
      intervals.push(crossings[i] - crossings[i - 1]);
    }
    
    // Check if intervals are physiologically plausible (10-50 frames = 36-180 BPM @ 30fps)
    const validIntervals = intervals.filter(iv => iv >= 10 && iv <= 50);
    if (validIntervals.length < 2) return 0;
    
    // Consistency: coefficient of variation of intervals
    const meanIv = validIntervals.reduce((a, b) => a + b, 0) / validIntervals.length;
    let ivVar = 0;
    for (const iv of validIntervals) ivVar += (iv - meanIv) ** 2;
    const cv = Math.sqrt(ivVar / validIntervals.length) / (meanIv + 0.01);
    
    // Lower CV = more periodic = better morphology
    // CV < 0.15 is excellent, > 0.5 is poor
    const periodicity = Math.max(0, Math.min(1, 1 - cv * 2));
    
    // Fraction of valid intervals
    const validFraction = validIntervals.length / Math.max(1, intervals.length);
    
    return Math.min(100, (periodicity * 70 + validFraction * 30));
  }

  /**
   * Stability: frame-to-frame consistency (low jitter = good)
   */
  private calculateStabilityScore(buffer: number[]): number {
    if (buffer.length < 20) return 0;
    
    const recent = buffer.slice(-60);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    const range = max - min;
    
    if (range < 0.1) return 0;
    
    // Average absolute difference between consecutive samples
    let totalDiff = 0;
    let maxJump = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = Math.abs(recent[i] - recent[i - 1]);
      totalDiff += diff;
      if (diff > maxJump) maxJump = diff;
    }
    const avgDiff = totalDiff / (recent.length - 1);
    
    // Normalize by range — lower relative jitter = more stable
    const relativeJitter = avgDiff / (range + 0.01);
    const jumpPenalty = maxJump / (range + 0.01);
    
    const jitterScore = Math.max(0, Math.min(1, 1 - relativeJitter * 3));
    const jumpScore = Math.max(0, Math.min(1, 1 - jumpPenalty * 1.5));
    
    return Math.min(100, (jitterScore * 60 + jumpScore * 40));
  }

  /**
   * Get current winner info for debug display
   */
  getWinnerInfo(): { winnerId: string; winnerLabel: string; winnerScore: number; allScores: Record<string, number> } {
    const allScores: Record<string, number> = {};
    for (const ch of CHANNEL_DEFS) {
      allScores[ch.id] = Math.round(this.smoothedScores.get(ch.id) || 0);
    }
    const winnerLabel = CHANNEL_DEFS.find(c => c.id === this.currentWinnerId)?.label || this.currentWinnerId;
    return {
      winnerId: this.currentWinnerId,
      winnerLabel,
      winnerScore: Math.round(this.smoothedScores.get(this.currentWinnerId) || 0),
      allScores,
    };
  }

  reset(): void {
    for (const ch of CHANNEL_DEFS) {
      this.channelBuffers.set(ch.id, []);
      this.channelFilters.get(ch.id)!.reset();
      this.channelFilteredBuffers.set(ch.id, []);
      this.smoothedScores.set(ch.id, ch.id === 'G' ? 50 : 30);
    }
    this.currentWinnerId = 'G';
    this.frameCount = 0;
    this.lastEvalTime = 0;
  }
}
