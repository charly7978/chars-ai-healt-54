export class AdvancedLogger {
  private static instance: AdvancedLogger;
  private logs: Array<{timestamp: number, level: string, message: string}> = [];

  private constructor() {}

  public static getInstance(): AdvancedLogger {
    if (!AdvancedLogger.instance) {
      AdvancedLogger.instance = new AdvancedLogger();
    }
    return AdvancedLogger.instance;
  }

  public log(level: string, message: string): void {
    this.logs.push({
      timestamp: Date.now(),
      level,
      message
    });
    
    // Keep only last 1000 logs
    if (this.logs.length > 1000) {
      this.logs.shift();
    }
  }

  public getLogs(): Array<{timestamp: number, level: string, message: string}> {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
  }
}
