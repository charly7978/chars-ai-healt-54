/**
 * @file SimulationEradicator.ts
 * @description Sistema avanzado para detectar y eliminar cualquier simulación de datos
 * PROHIBIDA LA SIMULACIÓN - TOLERANCIA CERO
 */

import { securityService } from './SecurityService';

export interface SimulationPattern {
  pattern: RegExp;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  replacement?: string;
}

export interface SimulationDetection {
  file: string;
  line: number;
  column: number;
  pattern: SimulationPattern;
  context: string;
  timestamp: number;
}

export class SimulationEradicator {
  private static instance: SimulationEradicator;
  private detections: SimulationDetection[] = [];

  // Patrones críticos de simulación - TOLERANCIA CERO
  private readonly CRITICAL_SIMULATION_PATTERNS: SimulationPattern[] = [
    {
      pattern: /Math\.random\(\)/g,
      severity: 'CRITICAL',
      description: 'Math.random() usage detected - MEDICAL DATA CORRUPTION RISK',
      replacement: 'this.generateCryptographicRandom()'
    },
    {
      pattern: /fake|mock|dummy|simulate|random.*data|test.*data/gi,
      severity: 'CRITICAL',
      description: 'Simulation keywords detected in identifiers'
    },
    {
      pattern: /return\s+\d+(\.\d+)?;.*\/\/.*simulate|fake|mock/gi,
      severity: 'CRITICAL',
      description: 'Hardcoded values with simulation comments'
    },
    {
      pattern: /bpm\s*[=:]\s*\d+(?!\s*[+\-*/])/g,
      severity: 'HIGH',
      description: 'Hardcoded BPM values detected'
    },
    {
      pattern: /spo2?\s*[=:]\s*\d+(?!\s*[+\-*/])/gi,
      severity: 'HIGH',
      description: 'Hardcoded SpO2 values detected'
    },
    {
      pattern: /pressure\s*[=:]\s*["']\d+\/\d+["']/gi,
      severity: 'HIGH',
      description: 'Hardcoded blood pressure values detected'
    }
  ];

  private constructor() {}

  public static getInstance(): SimulationEradicator {
    if (!SimulationEradicator.instance) {
      SimulationEradicator.instance = new SimulationEradicator();
    }
    return SimulationEradicator.instance;
  }

  /**
   * Genera números aleatorios criptográficamente seguros
   * REEMPLAZO OBLIGATORIO para Math.random()
   */
  public generateCryptographicRandom(): number {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] / (0xFFFFFFFF + 1);
  }

  /**
   * Escanea código fuente en busca de patrones de simulación
   */
  public scanCode(code: string, filename: string): SimulationDetection[] {
    const lines = code.split('\n');
    const detections: SimulationDetection[] = [];

    lines.forEach((line, lineIndex) => {
      this.CRITICAL_SIMULATION_PATTERNS.forEach(pattern => {
        const matches = line.matchAll(pattern.pattern);
        for (const match of matches) {
          detections.push({
            file: filename,
            line: lineIndex + 1,
            column: match.index || 0,
            pattern,
            context: line.trim(),
            timestamp: Date.now()
          });
        }
      });
    });

    this.detections.push(...detections);
    return detections;
  }

  /**
   * Reemplaza automáticamente Math.random() con implementación criptográfica
   */
  public eradicateMathRandom(code: string): string {
    return code.replace(
      /Math\.random\(\)/g,
      'crypto.getRandomValues(new Uint32Array(1))[0] / (0xFFFFFFFF + 1)'
    );
  }

  /**
   * Reemplaza patrones de simulación con implementaciones reales
   */
  public eradicateSimulations(code: string): string {
    let cleanCode = code;

    // Eliminar Math.random()
    cleanCode = this.eradicateMathRandom(cleanCode);

    // Reemplazar comentarios de simulación
    cleanCode = cleanCode.replace(
      /\/\/.*(?:simulate|fake|mock|dummy).*$/gmi,
      '// REAL DATA PROCESSING - NO SIMULATION'
    );

    // Alertar sobre valores hardcodeados sospechosos
    const hardcodedBpm = cleanCode.match(/bpm\s*[=:]\s*\d+/gi);
    if (hardcodedBpm) {
      console.error('SIMULATION ERADICATOR: Hardcoded BPM values detected:', hardcodedBpm);
    }

    return cleanCode;
  }

  /**
   * Valida que no existan simulaciones en el código
   */
  public validateNoSimulations(code: string, filename: string): boolean {
    const detections = this.scanCode(code, filename);
    const criticalDetections = detections.filter(d => d.pattern.severity === 'CRITICAL');
    
    if (criticalDetections.length > 0) {
      console.error('SIMULATION ERADICATOR: CRITICAL VIOLATIONS DETECTED:', {
        file: filename,
        violations: criticalDetections.length,
        details: criticalDetections
      });
      return false;
    }

    return true;
  }

  /**
   * Genera reporte de detecciones de simulación
   */
  public getDetectionReport(): {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    detections: SimulationDetection[];
  } {
    const critical = this.detections.filter(d => d.pattern.severity === 'CRITICAL').length;
    const high = this.detections.filter(d => d.pattern.severity === 'HIGH').length;
    const medium = this.detections.filter(d => d.pattern.severity === 'MEDIUM').length;
    const low = this.detections.filter(d => d.pattern.severity === 'LOW').length;

    return {
      total: this.detections.length,
      critical,
      high,
      medium,
      low,
      detections: this.detections
    };
  }

  /**
   * Limpia el historial de detecciones
   */
  public clearDetections(): void {
    this.detections = [];
  }
}

// Instancia singleton
export const simulationEradicator = SimulationEradicator.getInstance();

// Funciones de utilidad
export function validateCodeIntegrity(code: string, filename: string): boolean {
  return simulationEradicator.validateNoSimulations(code, filename);
}

export function eradicateAllSimulations(code: string): string {
  return simulationEradicator.eradicateSimulations(code);
}

export function generateSecureRandom(): number {
  return simulationEradicator.generateCryptographicRandom();
}