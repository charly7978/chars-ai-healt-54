// Simplified SignalProcessingService without rxjs
export class SignalProcessingService {
  private currentSignal: any = null;
  private listeners: Array<(signal: any) => void> = [];

  public processSignal(signal: any): void {
    this.currentSignal = signal;
    this.notifyListeners(signal);
  }

  public subscribe(callback: (signal: any) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(signal: any): void {
    this.listeners.forEach(listener => listener(signal));
  }

  public getCurrentSignal(): any {
    return this.currentSignal;
  }
}

export const signalProcessingService = new SignalProcessingService();