
export interface HeartBeatResult {
  bpm: number;
  confidence: number;
  isPeak: boolean;
  filteredValue?: number;
  arrhythmiaCount: number;
  signalQuality?: number;
}

export class HeartBeatProcessor {
  private rriHistory: number[] = [];
  private lastPeakTime: number | null = null;
  private isProcessing = false;
  private sessionId: string;
  private currentBPM = 0;
  private confidence = 0;
  private arrhythmiaCount = 0;
  private arrhythmiaDetected = false;

  constructor(public onHeartBeat?: (rri: number, bpm: number) => void) {
    this.sessionId = (() => {
      const randomBytes = new Uint32Array(1);
      crypto.getRandomValues(randomBytes);
      return randomBytes[0].toString(36);
    })();
    
    console.log('💓 HeartBeatProcessor inicializado');
  }

  public start(): void {
    this.isProcessing = true;
    console.log('💓 HeartBeatProcessor iniciado');
  }

  public stop(): void {
    this.isProcessing = false;
    console.log('💓 HeartBeatProcessor detenido');
  }

  public processSignal(ppgValue: number, timestamp?: number): HeartBeatResult {
    if (!this.isProcessing) {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0
      };
    }

    const currentTime = timestamp || Date.now();
    const isPeak = this.isPeak(ppgValue);
    
    // Simple peak detection
    if (isPeak) {
      if (this.lastPeakTime !== null) {
        const rri = currentTime - this.lastPeakTime;
        this.rriHistory.push(rri);
        
        // Keep only last 10 RR intervals
        if (this.rriHistory.length > 10) {
          this.rriHistory.shift();
        }
        
        // Calculate BPM
        const avgRRI = this.rriHistory.reduce((a, b) => a + b, 0) / this.rriHistory.length;
        const bpm = 60000 / avgRRI; // Convert ms to BPM
        
        if (bpm > 40 && bpm < 200) {
          this.currentBPM = Math.round(bpm);
          this.confidence = Math.min(1, this.rriHistory.length / 5);
        }
        
        if (this.onHeartBeat) {
          this.onHeartBeat(rri, this.currentBPM);
        }
      }
      
      this.lastPeakTime = currentTime;
    }

    return {
      bpm: this.currentBPM,
      confidence: this.confidence,
      isPeak,
      arrhythmiaCount: this.arrhythmiaCount,
      signalQuality: this.calculateSignalQuality(ppgValue)
    };
  }

  private isPeak(value: number): boolean {
    // Simple threshold-based peak detection
    return value > 75; // Adjust threshold as needed
  }

  private calculateSignalQuality(value: number): number {
    // Basic signal quality based on value range and stability
    if (value < 20 || value > 200) return 0;
    return Math.min(100, value);
  }

  public getRRIntervals(): { intervals: number[], lastPeakTime: number | null } {
    return {
      intervals: [...this.rriHistory],
      lastPeakTime: this.lastPeakTime
    };
  }

  public getLastPeakTime(): number | null {
    return this.lastPeakTime;
  }

  public setArrhythmiaDetected(detected: boolean): void {
    this.arrhythmiaDetected = detected;
    if (detected) {
      this.arrhythmiaCount++;
    }
  }

  public reset(): void {
    this.rriHistory = [];
    this.lastPeakTime = null;
    this.currentBPM = 0;
    this.confidence = 0;
    this.arrhythmiaCount = 0;
    this.arrhythmiaDetected = false;
    console.log('💓 HeartBeatProcessor reiniciado');
  }
}
