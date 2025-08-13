/**
 * Secure logging utility to prevent log injection attacks
 */

const sanitizeLogData = (data: any): string => {
  if (typeof data === 'string') {
    // Remove potential injection characters
    return data.replace(/[\r\n\t]/g, ' ').substring(0, 500);
  }
  
  if (data instanceof Error) {
    return `Error: ${data.message}`.replace(/[\r\n\t]/g, ' ').substring(0, 500);
  }
  
  try {
    return JSON.stringify(data, null, 0).replace(/[\r\n\t]/g, ' ').substring(0, 500);
  } catch {
    return String(data).replace(/[\r\n\t]/g, ' ').substring(0, 500);
  }
};

export const secureLog = {
  info: (message: string, data?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[INFO] ${sanitizeLogData(message)}`, data ? sanitizeLogData(data) : '');
    }
  },
  
  error: (message: string, error?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[ERROR] ${sanitizeLogData(message)}`, error ? sanitizeLogData(error) : '');
    }
  },
  
  warn: (message: string, data?: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[WARN] ${sanitizeLogData(message)}`, data ? sanitizeLogData(data) : '');
    }
  }
};