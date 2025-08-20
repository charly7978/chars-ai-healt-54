
import { SecurityService } from './SecurityService';
import { AdvancedLogger } from './AdvancedLogger';
import { DataAnonymizer } from './DataAnonymizer';

interface ValidationResult {
  isValid: boolean;
  violations: string[];
  riskLevel: 'low' | 'medium' | 'high';
}

export class ContinuousValidator {
  private static instance: ContinuousValidator;
  private securityService: SecurityService;
  private logger: AdvancedLogger;
  private dataAnonymizer: DataAnonymizer;
  private validationHistory: ValidationResult[] = [];

  private constructor() {
    this.securityService = new SecurityService();
    this.logger = AdvancedLogger.getInstance(); // Use singleton
    this.dataAnonymizer = DataAnonymizer.getInstance(); // Use singleton
  }

  public static getInstance(): ContinuousValidator {
    if (!ContinuousValidator.instance) {
      ContinuousValidator.instance = new ContinuousValidator();
    }
    return ContinuousValidator.instance;
  }

  public validateVitalSigns(data: any): ValidationResult {
    const violations: string[] = [];
    
    // Basic validation checks
    if (!data || typeof data !== 'object') {
      violations.push('Invalid data structure');
    }
    
    // Check for reasonable vital sign ranges
    if (data.heartRate && (data.heartRate < 30 || data.heartRate > 200)) {
      violations.push('Heart rate out of physiological range');
    }
    
    if (data.spo2 && (data.spo2 < 70 || data.spo2 > 100)) {
      violations.push('SpO2 out of valid range');
    }
    
    const riskLevel = violations.length > 2 ? 'high' : violations.length > 0 ? 'medium' : 'low';
    
    const result: ValidationResult = {
      isValid: violations.length === 0,
      violations,
      riskLevel
    };
    
    this.validationHistory.push(result);
    if (this.validationHistory.length > 100) {
      this.validationHistory.shift();
    }
    
    return result;
  }

  public getValidationHistory(): ValidationResult[] {
    return [...this.validationHistory];
  }

  public reset(): void {
    this.validationHistory = [];
  }
}
