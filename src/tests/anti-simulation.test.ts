/**
 * @file anti-simulation.test.ts
 * @description Tests automatizados para detectar y prevenir simulaciones
 * TOLERANCIA CERO A SIMULACIONES
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { simulationEradicator } from '../security/SimulationEradicator';
import { obsoleteElementCleaner } from '../security/ObsoleteElementCleaner';
import { continuousValidator } from '../security/ContinuousValidator';
import { advancedLogger } from '../security/AdvancedLogger';

describe('Anti-Simulation Security Tests', () => {
  beforeEach(() => {
    simulationEradicator.clearDetections();
    obsoleteElementCleaner.clearObsoleteElements();
    continuousValidator.clearHistory();
  });

  describe('SimulationEradicator', () => {
    it('should detect Math.random() usage', () => {
      const codeWithMathRandom = `
        function generateValue() {
          return Math.random() * 100;
        }
      `;
      
      const detections = simulationEradicator.scanCode(codeWithMathRandom, 'test.ts');
      expect(detections).toHaveLength(1);
      expect(detections[0].pattern.severity).toBe('CRITICAL');
      expect(detections[0].pattern.description).toContain('Math.random()');
    });

    it('should detect simulation keywords', () => {
      const codeWithSimulation = `
        const fakeData = 123;
        const mockValue = simulate();
        const dummyResult = true;
      `;
      
      const detections = simulationEradicator.scanCode(codeWithSimulation, 'test.ts');
      expect(detections.length).toBeGreaterThan(0);
      expect(detections.some(d => d.pattern.severity === 'CRITICAL')).toBe(true);
    });

    it('should detect hardcoded BPM values', () => {
      const codeWithHardcodedBPM = `
        const bpm = 75;
        heartRate = 80;
      `;
      
      const detections = simulationEradicator.scanCode(codeWithHardcodedBPM, 'test.ts');
      expect(detections.some(d => d.pattern.description.includes('Hardcoded BPM'))).toBe(true);
    });

    it('should replace Math.random() with cryptographic random', () => {
      const codeWithMathRandom = 'const value = Math.random();';
      const cleanedCode = simulationEradicator.eradicateMathRandom(codeWithMathRandom);
      
      expect(cleanedCode).not.toContain('Math.random()');
      expect(cleanedCode).toContain('crypto.getRandomValues');
    });

    it('should generate cryptographically secure random numbers', () => {
      const random1 = simulationEradicator.generateCryptographicRandom();
      const random2 = simulationEradicator.generateCryptographicRandom();
      
      expect(random1).toBeGreaterThanOrEqual(0);
      expect(random1).toBeLessThan(1);
      expect(random2).toBeGreaterThanOrEqual(0);
      expect(random2).toBeLessThan(1);
      expect(random1).not.toBe(random2);
    });

    it('should validate code has no critical simulations', () => {
      const validCode = `
        function processRealData(ppgSignal: number[]) {
          return ppgSignal.filter(value => value > 0);
        }
      `;
      
      const isValid = simulationEradicator.validateNoSimulations(validCode, 'test.ts');
      expect(isValid).toBe(true);
    });

    it('should reject code with critical simulations', () => {
      const invalidCode = `
        function generateFakeData() {
          return Math.random() * 100; // simulate heartbeat
        }
      `;
      
      const isValid = simulationEradicator.validateNoSimulations(invalidCode, 'test.ts');
      expect(isValid).toBe(false);
    });
  });

  describe('ObsoleteElementCleaner', () => {
    it('should detect HeartRateDisplay usage', () => {
      const codeWithObsolete = `
        import HeartRateDisplay from './HeartRateDisplay';
        <HeartRateDisplay bpm={75} />
      `;
      
      const elements = obsoleteElementCleaner.scanForObsoleteElements(codeWithObsolete, 'test.tsx');
      expect(elements.some(e => e.name.includes('HeartRateDisplay'))).toBe(true);
    });

    it('should replace HeartRateDisplay with HeartRate', () => {
      const codeWithObsolete = `
        import HeartRateDisplay from './HeartRateDisplay';
        <HeartRateDisplay bpm={75} confidence={0.9} />
      `;
      
      const cleanedCode = obsoleteElementCleaner.replaceObsoleteElements(codeWithObsolete);
      expect(cleanedCode).not.toContain('HeartRateDisplay');
      expect(cleanedCode).toContain('HeartRate');
      expect(cleanedCode).toContain("@/components/HeartRate");
    });

    it('should detect deprecated CSS classes', () => {
      const codeWithDeprecated = `
        <div className="deprecated-style old-component">
      `;
      
      const elements = obsoleteElementCleaner.scanForObsoleteElements(codeWithDeprecated, 'test.tsx');
      expect(elements.some(e => e.reason.includes('Deprecated CSS'))).toBe(true);
    });

    it('should clean unused imports', () => {
      const codeWithUnusedImports = `
        import React from 'react';
        import { UnusedComponent } from './unused';
        import { UsedComponent } from './used';
        
        export default function Test() {
          return <UsedComponent />;
        }
      `;
      
      const cleanedCode = obsoleteElementCleaner.cleanUnusedImports(codeWithUnusedImports);
      expect(cleanedCode).toContain('UsedComponent');
      expect(cleanedCode).not.toContain('UnusedComponent');
    });
  });

  describe('ContinuousValidator', () => {
    it('should validate medical code against all rules', () => {
      const medicalCode = `
        function calculateBPM(ppgData: number[]) {
          // Real PPG processing
          return processPPGSignal(ppgData);
        }
      `;
      
      const result = continuousValidator.validateCode(medicalCode, 'test.ts');
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.score).toBe(100);
    });

    it('should detect critical violations', () => {
      const violatingCode = `
        function fakeBPM() {
          return Math.random() * 100; // simulate heartbeat
        }
      `;
      
      const result = continuousValidator.validateCode(violatingCode, 'test.ts');
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.severity === 'CRITICAL')).toBe(true);
      expect(result.score).toBeLessThan(100);
    });

    it('should detect non-physiological BPM values', () => {
      const codeWithInvalidBPM = `
        const bpm = 300; // Non-physiological value
      `;
      
      const result = continuousValidator.validateCode(codeWithInvalidBPM, 'test.ts');
      expect(result.violations.some(v => v.message.includes('Non-physiological BPM'))).toBe(true);
    });

    it('should detect non-physiological SpO2 values', () => {
      const codeWithInvalidSpO2 = `
        const spo2 = 150; // Non-physiological value
      `;
      
      const result = continuousValidator.validateCode(codeWithInvalidSpO2, 'test.ts');
      expect(result.violations.some(v => v.message.includes('Non-physiological SpO2'))).toBe(true);
    });

    it('should auto-fix violations when possible', () => {
      const violatingCode = `
        const randomValue = Math.random();
      `;
      
      const fixedCode = continuousValidator.autoFixViolations(violatingCode);
      expect(fixedCode).not.toContain('Math.random()');
      expect(fixedCode).toContain('crypto.getRandomValues');
    });

    it('should block commits with critical violations', () => {
      const criticalFile = {
        path: 'critical.ts',
        content: 'const fake = Math.random(); // simulate data'
      };
      
      const hook = continuousValidator.preCommitHook([criticalFile]);
      expect(hook.canCommit).toBe(false);
      expect(hook.blockedBy).toHaveLength(1);
    });

    it('should allow commits without critical violations', () => {
      const validFile = {
        path: 'valid.ts',
        content: 'function processRealData() { return true; }'
      };
      
      const hook = continuousValidator.preCommitHook([validFile]);
      expect(hook.canCommit).toBe(true);
      expect(hook.blockedBy).toHaveLength(0);
    });
  });

  describe('AdvancedLogger', () => {
    it('should log simulation attempts', () => {
      advancedLogger.logSimulationAttempt('MATH_RANDOM', 'test.ts:10', 'Math.random()', 'CRITICAL', true);
      
      const attempts = advancedLogger.getSimulationAttempts();
      expect(attempts).toHaveLength(1);
      expect(attempts[0].type).toBe('MATH_RANDOM');
      expect(attempts[0].blocked).toBe(true);
    });

    it('should log medical metrics', () => {
      advancedLogger.logMedicalMetric('BPM', 75, 0.9, 'REAL_SENSOR', 0.85);
      
      const metrics = advancedLogger.getMedicalMetrics('BPM');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].value).toBe(75);
      expect(metrics[0].source).toBe('REAL_SENSOR');
    });

    it('should generate security report', () => {
      advancedLogger.logCritical('SIMULATION', 'Test critical log');
      advancedLogger.logSimulationAttempt('FAKE_DATA', 'test.ts', 'fake data', 'HIGH', false);
      
      const report = advancedLogger.generateSecurityReport();
      expect(report.criticalLogs).toBeGreaterThan(0);
      expect(report.simulationAttempts).toBeGreaterThan(0);
    });

    it('should export audit trail', () => {
      advancedLogger.logInfo('AUDIT', 'Test audit entry');
      
      const auditTrail = advancedLogger.exportAuditTrail();
      expect(auditTrail.sessionId).toBeDefined();
      expect(auditTrail.logs).toHaveLength(1);
      expect(auditTrail.exportTimestamp).toBeDefined();
    });
  });

  describe('Integration Tests', () => {
    it('should detect and eradicate all simulations in complex code', () => {
      const complexCode = `
        import HeartRateDisplay from './deprecated/HeartRateDisplay';
        
        function generateVitals() {
          const bpm = Math.random() * 60 + 60; // fake heartbeat
          const spo2 = 98; // hardcoded value
          const mockPressure = "120/80"; // simulate BP
          
          return { bpm, spo2, pressure: mockPressure };
        }
        
        // @deprecated function
        function oldFunction() {
          return dummyData;
        }
      `;
      
      // Detectar simulaciones
      const simulations = simulationEradicator.scanCode(complexCode, 'complex.ts');
      expect(simulations.length).toBeGreaterThan(0);
      
      // Detectar elementos obsoletos
      const obsolete = obsoleteElementCleaner.scanForObsoleteElements(complexCode, 'complex.ts');
      expect(obsolete.length).toBeGreaterThan(0);
      
      // Validar código
      const validation = continuousValidator.validateCode(complexCode, 'complex.ts');
      expect(validation.passed).toBe(false);
      
      // Limpiar código
      let cleanCode = simulationEradicator.eradicateSimulations(complexCode);
      cleanCode = obsoleteElementCleaner.replaceObsoleteElements(cleanCode);
      cleanCode = continuousValidator.autoFixViolations(cleanCode);
      
      // Verificar que el código limpio pasa la validación
      const finalValidation = continuousValidator.validateCode(cleanCode, 'complex.ts');
      expect(finalValidation.score).toBeGreaterThan(validation.score);
    });

    it('should maintain audit trail of all operations', () => {
      const testCode = 'const fake = Math.random();';
      
      simulationEradicator.scanCode(testCode, 'audit.ts');
      continuousValidator.validateCode(testCode, 'audit.ts');
      
      const report = advancedLogger.generateSecurityReport();
      expect(report.totalLogs).toBeGreaterThan(0);
    });
  });
});

describe('Performance Tests', () => {
  it('should validate large codebases efficiently', () => {
    const largeCode = 'function valid() { return true; }\n'.repeat(1000);
    
    const startTime = performance.now();
    const result = continuousValidator.validateCode(largeCode, 'large.ts');
    const endTime = performance.now();
    
    expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
    expect(result.passed).toBe(true);
  });

  it('should handle multiple file validation efficiently', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({
      path: `file${i}.ts`,
      content: `function file${i}() { return ${i}; }`
    }));
    
    const startTime = performance.now();
    const result = continuousValidator.validateProjectIntegrity(files);
    const endTime = performance.now();
    
    expect(endTime - startTime).toBeLessThan(2000); // Should complete in under 2 seconds
    expect(result.passedFiles).toBe(50);
  });
});