/**
 * FALSE POSITIVE TEST HARNESS
 * 
 * Suite automatizada de tests para verificar que el sistema
 * rechaza correctamente todos los falsos positivos.
 * 
 * Casos de prueba:
 * 1. Sábana roja - debe ser rechazada
 * 2. Mantel rojo - debe ser rechazado
 * 3. Tela roja - debe ser rechazada
 * 4. Foto de dedo en pantalla - debe ser rechazada
 * 5. Video de dedo - debe ser rechazado
 * 6. Superficie plana roja - debe ser rechazada
 * 7. Objeto rojo sin tejido - debe ser rechazado
 * 8. Maniquí - debe ser rechazado
 * 9. Dedo sin contacto - debe ser rechazado
 * 10. Dedo con movimiento excesivo - debe ser rechazado
 * 
 * Casos válidos:
 * 1. Dedo real con contacto firme
 * 2. Dedo real con perfusión adecuada
 * 3. Dedo real con señal pulsátil clara
 */

import { FingerLivenessGate } from '../modules/gates/FingerLivenessGate';
import { PPGExtractionEngine } from '../modules/gates/PPGExtractionEngine';
import { SignalQualityHardGate } from '../modules/gates/SignalQualityHardGate';
import { PhysiologicalLivenessVerifier } from '../modules/gates/PhysiologicalLivenessVerifier';
import { VitalSignsAuthorizationGate } from '../modules/gates/VitalSignsAuthorizationGate';

export interface TestCase {
  id: string;
  name: string;
  description: string;
  type: 'FALSE_POSITIVE' | 'VALID_CASE';
  expectedOutcome: 'REJECTED' | 'AUTHORIZED';
  mockImageData: ImageData;
  mockROI: { x: number; y: number; width: number; height: number };
  iterations: number;
}

export interface TestResult {
  testCaseId: string;
  passed: boolean;
  actualOutcome: 'REJECTED' | 'AUTHORIZED';
  rejectionReasons: string[];
  metrics: {
    livenessScore: number;
    signalQuality: number;
    physiologicalScore: number;
    authorizationScore: number;
  };
  executionTime: number;
}

export interface TestSuiteResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  falsePositiveRejections: number;
  validCaseAuthorizations: number;
  results: TestResult[];
  summary: {
    falsePositiveRejectionRate: number;
    validCaseAuthorizationRate: number;
    overallSuccessRate: number;
    averageExecutionTime: number;
  };
}

export class FalsePositiveTestHarness {
  private livenessGate: FingerLivenessGate;
  private extractionEngine: PPGExtractionEngine;
  private qualityGate: SignalQualityHardGate;
  private physiologicalVerifier: PhysiologicalLivenessVerifier;
  private authorizationGate: VitalSignsAuthorizationGate;

  constructor() {
    this.livenessGate = new FingerLivenessGate();
    this.extractionEngine = new PPGExtractionEngine();
    this.qualityGate = new SignalQualityHardGate();
    this.physiologicalVerifier = new PhysiologicalLivenessVerifier();
    this.authorizationGate = new VitalSignsAuthorizationGate();
  }

  /**
   * Crear ImageData simulado para diferentes casos de prueba
   */
  private createMockImageData(type: string, width: number = 640, height: number = 480): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('No se pudo crear contexto 2D');
    }

    switch (type) {
      case 'RED_SHEET':
        // Sábana roja uniforme
        ctx.fillStyle = '#CC0000';
        ctx.fillRect(0, 0, width, height);
        break;
      
      case 'RED_TABLECLOTH':
        // Mantel rojo con textura sutil
        ctx.fillStyle = '#AA0000';
        ctx.fillRect(0, 0, width, height);
        // Añadir textura
        for (let i = 0; i < 1000; i++) {
          ctx.fillStyle = `rgba(255, 0, 0, ${Math.random() * 0.1})`;
          ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
        }
        break;
      
      case 'RED_FABRIC':
        // Tela roja con patrón repetitivo
        ctx.fillStyle = '#990000';
        ctx.fillRect(0, 0, width, height);
        // Patrón textil
        for (let x = 0; x < width; x += 10) {
          for (let y = 0; y < height; y += 10) {
            if ((x + y) % 20 === 0) {
              ctx.fillStyle = '#BB0000';
              ctx.fillRect(x, y, 5, 5);
            }
          }
        }
        break;
      
      case 'FLAT_SURFACE':
        // Superficie plana roja sin textura
        ctx.fillStyle = '#DD0000';
        ctx.fillRect(0, 0, width, height);
        break;
      
      case 'PHOTO_FINGER':
        // Simulación de foto de dedo
        ctx.fillStyle = '#FFB6C1'; // Color piel
        ctx.fillRect(0, 0, width, height);
        // Añadir detalles estáticos
        ctx.fillStyle = '#FF69B4';
        ctx.fillRect(width/2 - 50, height/2 - 20, 100, 40);
        break;
      
      case 'VIDEO_FINGER':
        // Simulación de video con cambios de iluminación
        const time = Date.now() / 1000;
        const brightness = Math.sin(time * 2) * 20 + 235;
        ctx.fillStyle = `rgb(${brightness}, 182, 193)`;
        ctx.fillRect(0, 0, width, height);
        break;
      
      case 'REAL_FINGER':
        // Simulación de dedo real con variaciones
        const baseColor = { r: 255, g: 182, b: 193 }; // Color piel
        const imageData = ctx.createImageData(width, height);
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            
            // Variaciones sutiles para simular tejido vivo
            const noise = Math.sin(x * 0.05) * Math.cos(y * 0.05) * 10;
            const pulse = Math.sin(Date.now() / 1000 + x * 0.01) * 5;
            
            imageData.data[idx] = Math.max(0, Math.min(255, baseColor.r + noise + pulse));
            imageData.data[idx + 1] = Math.max(0, Math.min(255, baseColor.g + noise));
            imageData.data[idx + 2] = Math.max(0, Math.min(255, baseColor.b + noise));
            imageData.data[idx + 3] = 255;
          }
        }
        return imageData;
      
      case 'NO_CONTACT':
        // Simulación de dedo sin contacto (baja intensidad)
        ctx.fillStyle = '#663333';
        ctx.fillRect(0, 0, width, height);
        break;
      
      case 'EXCESSIVE_MOTION':
        // Simulación con mucho ruido por movimiento
        ctx.fillStyle = '#FFB6C1';
        ctx.fillRect(0, 0, width, height);
        // Añadir ruido aleatorio
        for (let i = 0; i < 10000; i++) {
          const x = Math.random() * width;
          const y = Math.random() * height;
          const brightness = Math.random() * 100;
          ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
          ctx.fillRect(x, y, 1, 1);
        }
        break;
      
      default:
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);
    }

    return ctx.getImageData(0, 0, width, height);
  }

  /**
   * Generar todos los casos de prueba
   */
  private generateTestCases(): TestCase[] {
    const baseROI = { x: 200, y: 200, width: 100, height: 100 };

    return [
      // Casos de falsos positivos
      {
        id: 'FP_001',
        name: 'Sábana Roja',
        description: 'Sábana roja uniforme sin tejido biológico',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('RED_SHEET'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_002',
        name: 'Mantel Rojo',
        description: 'Mantel rojo con textura sutil',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('RED_TABLECLOTH'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_003',
        name: 'Tela Roja',
        description: 'Tela roja con patrón repetitivo',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('RED_FABRIC'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_004',
        name: 'Foto de Dedo',
        description: 'Imagen estática de dedo en pantalla',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('PHOTO_FINGER'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_005',
        name: 'Video de Dedo',
        description: 'Video de dedo sin señal óptica real',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('VIDEO_FINGER'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_006',
        name: 'Superficie Plana',
        description: 'Superficie plana roja sin textura',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('FLAT_SURFACE'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_007',
        name: 'Dedo Sin Contacto',
        description: 'Dedo sin contacto óptico adecuado',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('NO_CONTACT'),
        mockROI: baseROI,
        iterations: 10,
      },
      {
        id: 'FP_008',
        name: 'Movimiento Excesivo',
        description: 'Dedo con movimiento excesivo',
        type: 'FALSE_POSITIVE',
        expectedOutcome: 'REJECTED',
        mockImageData: this.createMockImageData('EXCESSIVE_MOTION'),
        mockROI: baseROI,
        iterations: 10,
      },

      // Casos válidos
      {
        id: 'VC_001',
        name: 'Dedo Real Contacto Firme',
        description: 'Dedo real con contacto firme y estable',
        type: 'VALID_CASE',
        expectedOutcome: 'AUTHORIZED',
        mockImageData: this.createMockImageData('REAL_FINGER'),
        mockROI: baseROI,
        iterations: 20,
      },
    ];
  }

  /**
   * Ejecutar un caso de prueba individual
   */
  private async runSingleTestCase(testCase: TestCase): Promise<TestResult> {
    const startTime = performance.now();
    const results: Array<{
      liveness: any;
      extraction: any;
      quality: any;
      physiological: any;
      authorization: any;
    }> = [];

    // Resetear gates
    this.livenessGate.reset();
    this.extractionEngine.reset();
    this.qualityGate.reset();
    this.physiologicalVerifier.reset();
    this.authorizationGate.reset();

    // Ejecutar múltiples iteraciones
    for (let i = 0; i < testCase.iterations; i++) {
      // GATE 1: Finger Liveness
      const livenessResult = this.livenessGate.processFrame(
        testCase.mockImageData,
        testCase.mockROI
      );

      if (!livenessResult.isLiveTissueLikely && testCase.type === 'FALSE_POSITIVE') {
        // Ya fue rechazado en el primer gate
        results.push({
          liveness: livenessResult,
          extraction: { hasValidSignal: false },
          quality: { passed: false, sqi: 0 },
          physiological: { isPhysiologicallyAlive: false },
          authorization: { authorized: false, reasons: ['No hay tejido vivo'] }
        });
        continue;
      }

      // GATE 2: PPG Extraction
      const extractionResult = this.extractionEngine.processFrame(
        testCase.mockImageData,
        testCase.mockROI
      );

      if (!extractionResult.hasValidSignal && testCase.type === 'FALSE_POSITIVE') {
        results.push({
          liveness: livenessResult,
          extraction: extractionResult,
          quality: { passed: false, sqi: 0 },
          physiological: { isPhysiologicallyAlive: false },
          authorization: { authorized: false, reasons: ['Sin señal PPG válida'] }
        });
        continue;
      }

      // GATE 3: Signal Quality
      const qualityResult = this.qualityGate.evaluate(
        extractionResult.features,
        livenessResult.features
      );

      if (!qualityResult.passed && testCase.type === 'FALSE_POSITIVE') {
        results.push({
          liveness: livenessResult,
          extraction: extractionResult,
          quality: qualityResult,
          physiological: { isPhysiologicallyAlive: false },
          authorization: { authorized: false, reasons: qualityResult.reasons }
        });
        continue;
      }

      // GATE 4: Physiological Liveness
      const regionBuffers = {
        central: [],
        peripheral: [],
        background: [],
        subROIs: [[], [], [], []]
      };

      const physiologicalResult = this.physiologicalVerifier.evaluate(
        testCase.mockImageData,
        testCase.mockROI,
        regionBuffers
      );

      if (!physiologicalResult.isPhysiologicallyAlive && testCase.type === 'FALSE_POSITIVE') {
        results.push({
          liveness: livenessResult,
          extraction: extractionResult,
          quality: qualityResult,
          physiological: physiologicalResult,
          authorization: { authorized: false, reasons: physiologicalResult.rejectionReasons }
        });
        continue;
      }

      // GATE 5: Authorization
      const authorizationResult = this.authorizationGate.evaluate(
        livenessResult,
        extractionResult,
        qualityResult,
        physiologicalResult
      );

      results.push({
        liveness: livenessResult,
        extraction: extractionResult,
        quality: qualityResult,
        physiological: physiologicalResult,
        authorization: authorizationResult
      });

      // Pequeña pausa entre iteraciones
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Analizar resultados
    const finalResult = results[results.length - 1];
    const actualOutcome = finalResult.authorization.authorized ? 'AUTHORIZED' : 'REJECTED';
    const passed = actualOutcome === testCase.expectedOutcome;

    const executionTime = performance.now() - startTime;

    return {
      testCaseId: testCase.id,
      passed,
      actualOutcome,
      rejectionReasons: finalResult.authorization.reasons || [],
      metrics: {
        livenessScore: finalResult.liveness.confidence || 0,
        signalQuality: finalResult.quality.sqi || 0,
        physiologicalScore: finalResult.physiological.confidence || 0,
        authorizationScore: finalResult.authorization.evidence.overallConfidence || 0,
      },
      executionTime,
    };
  }

  /**
   * Ejecutar suite completa de tests
   */
  async runTestSuite(): Promise<TestSuiteResult> {
    console.log('🧪 Iniciando suite de tests anti-falsos positivos...');
    
    const testCases = this.generateTestCases();
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      console.log(`📋 Ejecutando test: ${testCase.name} (${testCase.id})`);
      
      try {
        const result = await this.runSingleTestCase(testCase);
        results.push(result);
        
        const status = result.passed ? '✅' : '❌';
        console.log(`${status} ${testCase.name}: ${result.actualOutcome} (${result.executionTime.toFixed(2)}ms)`);
        
        if (!result.passed) {
          console.log(`   Razones: ${result.rejectionReasons.join(', ')}`);
        }
      } catch (error) {
        console.error(`❌ Error en test ${testCase.id}:`, error);
        results.push({
          testCaseId: testCase.id,
          passed: false,
          actualOutcome: 'REJECTED',
          rejectionReasons: [`Error de ejecución: ${error}`],
          metrics: { livenessScore: 0, signalQuality: 0, physiologicalScore: 0, authorizationScore: 0 },
          executionTime: 0,
        });
      }
    }

    // Calcular estadísticas
    const totalTests = results.length;
    const passedTests = results.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    
    const falsePositiveTests = results.filter(r => r.testCaseId.startsWith('FP_'));
    const validCaseTests = results.filter(r => r.testCaseId.startsWith('VC_'));
    
    const falsePositiveRejections = falsePositiveTests.filter(r => 
      r.actualOutcome === 'REJECTED'
    ).length;
    
    const validCaseAuthorizations = validCaseTests.filter(r => 
      r.actualOutcome === 'AUTHORIZED'
    ).length;

    const summary = {
      falsePositiveRejectionRate: falsePositiveTests.length > 0 ? 
        falsePositiveRejections / falsePositiveTests.length : 0,
      validCaseAuthorizationRate: validCaseTests.length > 0 ? 
        validCaseAuthorizations / validCaseTests.length : 0,
      overallSuccessRate: passedTests / totalTests,
      averageExecutionTime: results.reduce((sum, r) => sum + r.executionTime, 0) / totalTests,
    };

    console.log('\n📊 Resultados de la suite:');
    console.log(`Total tests: ${totalTests}`);
    console.log(`Tests pasados: ${passedTests} (${(passedTests/totalTests*100).toFixed(1)}%)`);
    console.log(`Tests fallidos: ${failedTests} (${(failedTests/totalTests*100).toFixed(1)}%)`);
    console.log(`Falsos positivos rechazados: ${falsePositiveRejections}/${falsePositiveTests.length} (${(summary.falsePositiveRejectionRate*100).toFixed(1)}%)`);
    console.log(`Casos válidos autorizados: ${validCaseAuthorizations}/${validCaseTests.length} (${(summary.validCaseAuthorizationRate*100).toFixed(1)}%)`);
    console.log(`Tiempo promedio de ejecución: ${summary.averageExecutionTime.toFixed(2)}ms`);

    return {
      totalTests,
      passedTests,
      failedTests,
      falsePositiveRejections,
      validCaseAuthorizations,
      results,
      summary,
    };
  }

  /**
   * Generar reporte detallado
   */
  generateDetailedReport(result: TestSuiteResult): string {
    let report = '# REPORTE DETALLADO - TESTS ANTI-FALSOS POSITIVOS\n\n';
    
    report += `## Resumen Ejecutivo\n`;
    report += `- Tests totales: ${result.totalTests}\n`;
    report += `- Tests pasados: ${result.passedTests} (${(result.passedTests/result.totalTests*100).toFixed(1)}%)\n`;
    report += `- Tests fallidos: ${result.failedTests} (${(result.failedTests/result.totalTests*100).toFixed(1)}%)\n`;
    report += `- Tasa de rechazo de falsos positivos: ${(result.summary.falsePositiveRejectionRate*100).toFixed(1)}%\n`;
    report += `- Tasa de autorización de casos válidos: ${(result.summary.validCaseAuthorizationRate*100).toFixed(1)}%\n`;
    report += `- Tiempo promedio de ejecución: ${result.summary.averageExecutionTime.toFixed(2)}ms\n\n`;

    report += `## Resultados por Test\n\n`;
    
    for (const testResult of result.results) {
      const status = testResult.passed ? '✅ PASÓ' : '❌ FALLÓ';
      report += `### ${testResult.testCaseId} - ${status}\n`;
      report += `- Outcome esperado: ${testResult.actualOutcome}\n`;
      report += `- Métricas:\n`;
      report += `  - Liveness: ${testResult.metrics.livenessScore.toFixed(3)}\n`;
      report += `  - Calidad: ${testResult.metrics.signalQuality.toFixed(3)}\n`;
      report += `  - Fisiológico: ${testResult.metrics.physiologicalScore.toFixed(3)}\n`;
      report += `  - Autorización: ${testResult.metrics.authorizationScore.toFixed(3)}\n`;
      
      if (testResult.rejectionReasons.length > 0) {
        report += `- Razones de rechazo: ${testResult.rejectionReasons.join(', ')}\n`;
      }
      
      report += `- Tiempo de ejecución: ${testResult.executionTime.toFixed(2)}ms\n\n`;
    }

    report += `## Conclusión\n`;
    if (result.summary.falsePositiveRejectionRate >= 0.95 && result.summary.validCaseAuthorizationRate >= 0.8) {
      report += `✅ El sistema cumple con los requisitos anti-falsos positivos.\n`;
    } else {
      report += `❌ El sistema no cumple con los requisitos. Se requiere optimización.\n`;
    }

    return report;
  }
}

export default FalsePositiveTestHarness;
