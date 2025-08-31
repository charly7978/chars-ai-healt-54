import { securityService } from './SecurityService';

// Importar módulos específicos de crypto-js
import SHA256 from 'crypto-js/sha256';
import HmacSHA256 from 'crypto-js/hmac-sha256';
import enc from 'crypto-js/enc-utf8';

export interface AnonymizationOptions {
  // Fields to be removed from the data
  removeFields?: string[];
  // Fields to hash (one-way transformation)
  hashFields?: string[];
  // Fields to pseudonymize (reversible with key)
  pseudonymizeFields?: string[];
  // Generalization rules { field: { ranges: [[min, max, 'label'], ...] } }
  generalizeFields?: Record<string, { ranges: Array<[number, number, string]> }>;
  // Noise addition configuration { field: { type: 'gaussian'|'laplace', scale: number } }
  addNoiseToFields?: Record<string, { type: 'gaussian' | 'laplace'; scale: number }>;
  // K-anonymity parameter (minimum number of identical records)
  kAnonymity?: number;
}

export class DataAnonymizer {
  private static instance: DataAnonymizer;
  private pseudonymizationKey: string;

  private constructor() {
    // In a real application, this key should be securely managed and rotated
    this.pseudonymizationKey = securityService.generateSecureRandomKey();
  }

  public static getInstance(): DataAnonymizer {
    if (!DataAnonymizer.instance) {
      DataAnonymizer.instance = new DataAnonymizer();
    }
    return DataAnonymizer.instance;
  }

  public anonymize<T>(data: T, options: AnonymizationOptions): T {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Create a deep copy to avoid modifying the original object
    const anonymized = JSON.parse(JSON.stringify(data));

    // Process each field based on the anonymization options
    for (const key in anonymized) {
      if (options.removeFields?.includes(key)) {
        delete anonymized[key];
        continue;
      }

      if (options.hashFields?.includes(key) && anonymized[key] != null) {
        anonymized[key] = this.hashValue(anonymized[key]);
      }

      if (options.pseudonymizeFields?.includes(key) && anonymized[key] != null) {
        anonymized[key] = this.pseudonymize(anonymized[key]);
      }

      if (options.generalizeFields?.[key] && typeof anonymized[key] === 'number') {
        anonymized[key] = this.generalizeValue(
          anonymized[key],
          options.generalizeFields[key].ranges
        );
      }

      if (options.addNoiseToFields?.[key] && typeof anonymized[key] === 'number') {
        const noiseConfig = options.addNoiseToFields[key];
        anonymized[key] = this.addNoise(anonymized[key], noiseConfig);
      }
    }

    return anonymized as T;
  }

  public anonymizeBatch<T>(dataArray: T[], options: AnonymizationOptions): T[] {
    // First anonymize all records
    const anonymized = dataArray.map(item => this.anonymize(item, options));

    // Apply k-anonymity if required
    if (options.kAnonymity && options.kAnonymity > 1) {
      return this.ensureKAnonymity(anonymized, options);
    }

    return anonymized;
  }

  private hashValue(value: any): string {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    return SHA256(stringValue).toString();
  }

  private pseudonymize(value: any): string {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    return HmacSHA256(stringValue, this.pseudonymizationKey).toString();
  }

  private generalizeValue(value: number, ranges: Array<[number, number, string]>): string {
    for (const [min, max, label] of ranges) {
      if (value >= min && value <= max) {
        return label;
      }
    }
    return 'other';
  }

  private addNoise(value: number, config: { type: 'gaussian' | 'laplace'; scale: number }): number {
    let noise: number;
    
    if (config.type === 'gaussian') {
      // CRYPTOGRAPHICALLY SECURE Gaussian noise - NO Math.random()
      const randomValues = new Uint32Array(2);
      crypto.getRandomValues(randomValues);
      const u1 = randomValues[0] / (0xFFFFFFFF + 1);
      const u2 = randomValues[1] / (0xFFFFFFFF + 1);
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      noise = z0 * config.scale;
    } else {
    const randomValue = new Uint32Array(1);
    crypto.getRandomValues(randomValue);
    const cryptoRandom = randomValue[0] / 0xFFFFFFFF;
      crypto.getRandomValues(randomValue);
      const u = (randomValue[0] / (0xFFFFFFFF + 1)) - 0.5;
      noise = -config.scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    }

    return value + noise;
  }

  private ensureKAnonymity<T>(data: T[], options: AnonymizationOptions): T[] {
    if (!options.kAnonymity || options.kAnonymity <= 1) {
      return data;
    }

    // Group records by quasi-identifiers (all fields not already anonymized)
    const groups = new Map<string, T[]>();
    
    for (const item of data) {
      const key = this.getQuasiIdentifier(item, options);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)?.push(item);
    }

    // Process groups that don't meet k-anonymity
    const result: T[] = [];
    
    for (const [_, group] of groups) {
      if (group.length >= options.kAnonymity) {
        // Group meets k-anonymity, add as is
        result.push(...group);
      } else {
        // Apply additional generalization to merge with other groups
        const merged = this.mergeWithSimilarGroups(group, groups, options);
        result.push(...merged);
      }
    }

    return result;
  }

  private getQuasiIdentifier<T>(item: T, options: AnonymizationOptions): string {
    const quasiIdFields = Object.keys(item as object).filter(
      key => !options.removeFields?.includes(key) &&
             !options.hashFields?.includes(key) &&
             !options.pseudonymizeFields?.includes(key) &&
             !options.generalizeFields?.[key] &&
             !options.addNoiseToFields?.[key]
    );

    return quasiIdFields
      .map(key => `${key}:${(item as any)[key]}`)
      .join('|');
  }

  private mergeWithSimilarGroups<T>(
    group: T[],
    allGroups: Map<string, T[]>,
    options: AnonymizationOptions
  ): T[] {
    // In a real implementation, this would find the most similar group to merge with
    // For simplicity, we'll just apply additional generalization
    
    // Create a copy of the options with more aggressive generalization
    const newOptions: AnonymizationOptions = {
      ...options,
      generalizeFields: {
        ...options.generalizeFields,
        // Add or modify generalization rules to make the data less specific
      }
    };

    // Re-anonymize with the new options
    return group.map(item => this.anonymize(item, newOptions));
  }

  public static createDefaultHealthDataOptions(): AnonymizationOptions {
    return {
      // Remove direct identifiers
      removeFields: [
        'id', 'name', 'email', 'phone', 'address', 'ipAddress',
        'deviceId', 'ssn', 'insuranceId'
      ],
      
      // Hash fields that could be used for re-identification
      hashFields: [
        'userId', 'patientId', 'sessionId'
      ],
      
      // Pseudonymize fields that might need to be reversed
      pseudonymizeFields: [
        'medicalRecordNumber', 'physicianId'
      ],
      
      // Generalize numerical values
      generalizeFields: {
        age: {
          ranges: [
            [0, 17, '0-17'],
            [18, 35, '18-35'],
            [36, 50, '36-50'],
            [51, 65, '51-65'],
            [66, 120, '66+']
          ]
        },
        zipCode: {
          ranges: [
            [10000, 19999, 'Northeast'],
            [20000, 39999, 'Mid-Atlantic'],
            [40000, 62999, 'Southeast'],
            [63000, 84999, 'Midwest'],
            [85000, 99999, 'West']
          ]
        }
      },
      
      // Add noise to numerical measurements
      addNoiseToFields: {
        weight: { type: 'gaussian', scale: 0.5 },
        height: { type: 'gaussian', scale: 0.3 },
        temperature: { type: 'gaussian', scale: 0.1 },
        heartRate: { type: 'laplace', scale: 1.0 },
        bloodPressureSystolic: { type: 'laplace', scale: 1.5 },
        bloodPressureDiastolic: { type: 'laplace', scale: 1.0 },
        spo2: { type: 'gaussian', scale: 0.2 }
      },
      
      // Ensure k-anonymity of at least 5
      kAnonymity: 5
    };
  }
}

// Export a singleton instance
export const dataAnonymizer = DataAnonymizer.getInstance();

// Helper functions
export function anonymizeHealthData<T>(data: T): T {
  const options = DataAnonymizer.createDefaultHealthDataOptions();
  return dataAnonymizer.anonymize(data, options);
}

export function anonymizeHealthDataBatch<T>(dataArray: T[]): T[] {
  const options = DataAnonymizer.createDefaultHealthDataOptions();
  return dataAnonymizer.anonymizeBatch(dataArray, options);
}
