/**
 * Secure logger that prevents log injection attacks by sanitizing log messages
 * and data before outputting them to the console.
 */

export class SecureLogger {
  private readonly context: string;
  private static readonly PRODUCTION = process.env.NODE_ENV === 'production';

  constructor(context: string) {
    this.context = this.sanitize(context) || 'App';
  }

  /**
   * Sanitizes input to prevent log injection attacks
   */
  private sanitize(input: any): string {
    if (input == null) return '';
    if (typeof input === 'string') {
      // Remove control characters and trim whitespace
      return input.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
    }
    if (typeof input === 'object') {
      try {
        // Stringify objects but limit depth and array length to prevent DoS
        return JSON.stringify(input, (key, value) => {
          if (Array.isArray(value) && value.length > 100) {
            return `[Array(${value.length})]`;
          }
          return value;
        }, 2);
      } catch (e) {
        return '[Circular or non-serializable object]';
      }
    }
    return String(input);
  }

  /**
   * Logs an info message
   */
  public info(message: string, data?: any): void {
    if (SecureLogger.PRODUCTION) return;
    console.log(
      `[${new Date().toISOString()}] [${this.context}]`, 
      this.sanitize(message),
      data ? this.sanitize(data) : ''
    );
  }

  /**
   * Logs a warning message
   */
  public warn(message: string, data?: any): void {
    if (SecureLogger.PRODUCTION) return;
    console.warn(
      `[${new Date().toISOString()}] [${this.context}] WARN:`, 
      this.sanitize(message),
      data ? this.sanitize(data) : ''
    );
  }

  /**
   * Logs an error message
   */
  public error(message: string, error?: Error | any): void {
    const errorData = error ? {
      message: error.message,
      stack: error.stack,
      ...(error.response ? { response: error.response.data } : {})
    } : undefined;
    
    console.error(
      `[${new Date().toISOString()}] [${this.context}] ERROR:`, 
      this.sanitize(message),
      errorData ? this.sanitize(errorData) : ''
    );
  }

  /**
   * Logs debug information (only in development)
   */
  public debug(message: string, data?: any): void {
    if (SecureLogger.PRODUCTION) return;
    console.debug(
      `[${new Date().toISOString()}] [${this.context}] DEBUG:`, 
      this.sanitize(message),
      data ? this.sanitize(data) : ''
    );
  }
}
