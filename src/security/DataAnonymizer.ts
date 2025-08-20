
export class DataAnonymizer {
  private static instance: DataAnonymizer;

  private constructor() {}

  public static getInstance(): DataAnonymizer {
    if (!DataAnonymizer.instance) {
      DataAnonymizer.instance = new DataAnonymizer();
    }
    return DataAnonymizer.instance;
  }

  public anonymizeData(data: any): any {
    // Basic anonymization - remove sensitive fields
    const anonymized = JSON.parse(JSON.stringify(data));
    
    // Remove or hash sensitive fields
    if (anonymized.userId) delete anonymized.userId;
    if (anonymized.sessionId) delete anonymized.sessionId;
    if (anonymized.timestamp) anonymized.timestamp = Math.floor(anonymized.timestamp / 1000) * 1000;
    
    return anonymized;
  }

  public hashSensitiveData(data: string): string {
    // Simple hash for demonstration
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }
}
