export class HeartBeatProcessor {
  private rriHistory: number[] = [];
  private lastPeakTime: number | null = null;
  private isProcessing = false;
  private sessionId: string;

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

  public processSignal(ppgValue: number): void {
    if (!this.isProcessing) return;

    const currentTime = Date.now();
    
    // Simple peak detection
    if (this.isPeak(ppgValue)) {
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
        
        if (this.onHeartBeat) {
          this.onHeartBeat(rri, bpm);
        }
      }
      
      this.lastPeakTime = currentTime;
    }
  }

  private isPeak(value: number): boolean {
    // Simple threshold-based peak detection
    return value > 75; // Adjust threshold as needed
  }

  public getRRIntervals(): number[] {
    return [...this.rriHistory];
  }

  public getLastPeakTime(): number | null {
    return this.lastPeakTime;
  }

  public reset(): void {
    this.rriHistory = [];
    this.lastPeakTime = null;
    console.log('💓 HeartBeatProcessor reiniciado');
  }
}
