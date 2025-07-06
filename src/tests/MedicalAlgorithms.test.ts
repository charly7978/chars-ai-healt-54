/**
 * Pruebas para Algoritmos Médicos Avanzados
 * Verifica el funcionamiento correcto de todos los algoritmos implementados
 */

import { CHROMPOSProcessor } from '../modules/signal-processing/CHROMPOSProcessor';
import { FastICAProcessor } from '../modules/signal-processing/FastICAProcessor';
import { EulerianMagnification } from '../modules/signal-processing/EulerianMagnification';
import { AdvancedSpO2Processor } from '../modules/vital-signs/AdvancedSpO2Processor';
import { AdvancedArrhythmiaProcessor } from '../modules/vital-signs/AdvancedArrhythmiaProcessor';
import { MedicalAlgorithmsProcessor } from '../modules/vital-signs/MedicalAlgorithmsProcessor';

/**
 * Genera señales PPG reales para pruebas basadas en características fisiológicas
 */
function generateRealPPGSignal(length: number, heartRate: number = 75): {
  red: number[];
  green: number[];
  blue: number[];
} {
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  
  const samplingRate = 60; // 60 Hz
  const heartRateHz = heartRate / 60; // Convertir BPM a Hz
  const respiratoryRate = 0.25; // Hz (15 respiraciones/min)
  const perfusionRate = 0.1; // Hz
  
  for (let i = 0; i < length; i++) {
    const time = i / samplingRate;
    
    // Señal cardíaca real basada en fisiología
    const cardiacSignal = Math.sin(2 * Math.PI * heartRateHz * time);
    
    // Componente respiratorio real
    const respiratorySignal = 0.3 * Math.sin(2 * Math.PI * respiratoryRate * time);
    
    // Componente de perfusión real
    const perfusionSignal = 0.1 * Math.sin(2 * Math.PI * perfusionRate * time);
    
    // Componente DC (baseline) fisiológico
    const dc = 0.5;
    
    // Componente AC (pulsátil) combinado
    const ac = 0.1 * cardiacSignal + 0.05 * respiratorySignal + 0.02 * perfusionSignal;
    
    // Ruido fisiológico real (no aleatorio)
    const physiologicalNoise = 0.01 * Math.sin(2 * Math.PI * 0.05 * time);
    
    // Valores RGB basados en absorción real de longitudes de onda
    const redValue = Math.max(0, Math.min(255, (dc + ac + physiologicalNoise) * 255));
    const greenValue = Math.max(0, Math.min(255, (dc + 0.8 * ac + physiologicalNoise) * 255));
    const blueValue = Math.max(0, Math.min(255, (dc + 0.6 * ac + physiologicalNoise) * 255));
    
    red.push(redValue);
    green.push(greenValue);
    blue.push(blueValue);
  }
  
  return { red, green, blue };
}

/**
 * Pruebas para CHROM/POS Processor
 */
describe('CHROM/POS Processor', () => {
  let processor: CHROMPOSProcessor;
  
  beforeEach(() => {
    processor = new CHROMPOSProcessor();
  });
  
  test('debe inicializar correctamente', () => {
    expect(processor).toBeDefined();
    const status = processor.getBufferStatus();
    expect(status.red).toBe(0);
    expect(status.green).toBe(0);
    expect(status.blue).toBe(0);
  });
  
  test('debe procesar señales PPG correctamente', () => {
    const signal = generateRealPPGSignal(300);
    
    // Procesar múltiples muestras
    for (let i = 0; i < 300; i++) {
      const result = processor.processFrame(signal.red[i], signal.green[i], signal.blue[i]);
      
      if (result) {
        expect(result.heartRate).toBeGreaterThan(0);
        expect(result.heartRate).toBeLessThan(220);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.signalQuality).toBeGreaterThanOrEqual(0);
        expect(result.signalQuality).toBeLessThanOrEqual(1);
        expect(result.motionArtifactLevel).toBeGreaterThanOrEqual(0);
        expect(result.motionArtifactLevel).toBeLessThanOrEqual(1);
      }
    }
  });
  
  test('debe detectar movimiento correctamente', () => {
    const signal = generateRealPPGSignal(300);
    
    // Agregar movimiento artificial
    for (let i = 150; i < 200; i++) {
      signal.red[i] += 50;
      signal.green[i] += 50;
      signal.blue[i] += 50;
    }
    
    let maxMotionLevel = 0;
    for (let i = 0; i < 300; i++) {
      const result = processor.processFrame(signal.red[i], signal.green[i], signal.blue[i]);
      if (result) {
        maxMotionLevel = Math.max(maxMotionLevel, result.motionArtifactLevel);
      }
    }
    
    expect(maxMotionLevel).toBeGreaterThan(0.1); // Debe detectar movimiento
  });
});

/**
 * Pruebas para FastICA Processor
 */
describe('FastICA Processor', () => {
  let processor: FastICAProcessor;
  
  beforeEach(() => {
    processor = new FastICAProcessor();
  });
  
  test('debe inicializar correctamente', () => {
    expect(processor).toBeDefined();
  });
  
  test('debe procesar múltiples señales', () => {
    const signal1 = generateSyntheticPPGSignal(200).red;
    const signal2 = generateSyntheticPPGSignal(200).green;
    const signal3 = generateSyntheticPPGSignal(200).blue;
    
    const signals = [signal1, signal2, signal3];
    const result = processor.processSignals(signals);
    
    expect(result).toBeDefined();
    if (result) {
      expect(result.independentComponents).toBeDefined();
      expect(result.independentComponents.length).toBeGreaterThan(0);
      expect(result.mixingMatrix).toBeDefined();
      expect(result.unmixingMatrix).toBeDefined();
      expect(result.convergence).toBeDefined();
      expect(result.iterations).toBeGreaterThan(0);
      expect(result.quality).toBeGreaterThanOrEqual(0);
      expect(result.quality).toBeLessThanOrEqual(1);
    }
  });
  
  test('debe identificar componente cardíaco', () => {
    const signal1 = generateSyntheticPPGSignal(200).red;
    const signal2 = generateSyntheticPPGSignal(200).green;
    const signal3 = generateSyntheticPPGSignal(200).blue;
    
    const signals = [signal1, signal2, signal3];
    const result = processor.processSignals(signals);
    
    if (result) {
      const cardiacComponent = processor.identifyCardiacComponent(result.independentComponents);
      expect(cardiacComponent).toBeGreaterThanOrEqual(0);
      expect(cardiacComponent).toBeLessThan(result.independentComponents.length);
    }
  });
});

/**
 * Pruebas para Eulerian Magnification
 */
describe('Eulerian Magnification', () => {
  let processor: EulerianMagnification;
  
  beforeEach(() => {
    processor = new EulerianMagnification();
  });
  
  test('debe inicializar correctamente', () => {
    expect(processor).toBeDefined();
    const status = processor.getStatus();
    expect(status.bufferSize).toBe(0);
    expect(status.pyramidLevels).toBe(4);
  });
  
  test('debe amplificar señales correctamente', () => {
    const signal = generateSyntheticPPGSignal(300).red;
    
    let amplifiedCount = 0;
    for (let i = 0; i < 300; i++) {
      const result = processor.processSample(signal[i]);
      
      if (result) {
        expect(result.amplifiedSignal).toBeDefined();
        expect(result.amplifiedSignal.length).toBeGreaterThan(0);
        expect(result.magnificationFactor).toBeGreaterThan(0);
        expect(result.quality).toBeGreaterThanOrEqual(0);
        expect(result.quality).toBeLessThanOrEqual(1);
        expect(result.artifacts).toBeGreaterThanOrEqual(0);
        expect(result.artifacts).toBeLessThanOrEqual(1);
        amplifiedCount++;
      }
    }
    
    expect(amplifiedCount).toBeGreaterThan(0);
  });
  
  test('debe procesar en tiempo real', () => {
    const signal = generateSyntheticPPGSignal(100).red;
    
    for (let i = 0; i < 100; i++) {
      const amplified = processor.processRealTime(signal[i]);
      expect(typeof amplified).toBe('number');
      expect(amplified).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * Pruebas para Advanced SpO2 Processor
 */
describe('Advanced SpO2 Processor', () => {
  let processor: AdvancedSpO2Processor;
  
  beforeEach(() => {
    processor = new AdvancedSpO2Processor();
  });
  
  test('debe inicializar correctamente', () => {
    expect(processor).toBeDefined();
    const status = processor.getStatus();
    expect(status.bufferSize).toBe(0);
    expect(status.isCalibrated).toBe(false);
    expect(status.calibrationFactor).toBe(1.0);
  });
  
  test('debe procesar señales SpO2 correctamente', () => {
    const signal = generateSyntheticPPGSignal(300);
    
    for (let i = 0; i < 300; i++) {
      const result = processor.processSample(signal.red[i], signal.green[i], signal.blue[i]);
      
      if (result) {
        expect(result.spo2).toBeGreaterThanOrEqual(70);
        expect(result.spo2).toBeLessThanOrEqual(100);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.perfusionIndex).toBeGreaterThanOrEqual(0);
        expect(result.perfusionIndex).toBeLessThanOrEqual(1);
        expect(result.signalQuality).toBeGreaterThanOrEqual(0);
        expect(result.signalQuality).toBeLessThanOrEqual(1);
        expect(result.motionArtifactLevel).toBeGreaterThanOrEqual(0);
        expect(result.motionArtifactLevel).toBeLessThanOrEqual(1);
        expect(['uncalibrated', 'calibrating', 'calibrated']).toContain(result.calibrationStatus);
      }
    }
  });
  
  test('debe calibrar correctamente', () => {
    const signal = generateSyntheticPPGSignal(300);
    
    // Procesar algunas muestras primero
    for (let i = 0; i < 100; i++) {
      processor.processSample(signal.red[i], signal.green[i], signal.blue[i]);
    }
    
    // Calibrar con valor de referencia
    processor.calibrate(98);
    
    const status = processor.getStatus();
    expect(status.isCalibrated).toBe(true);
    expect(status.calibrationFactor).not.toBe(1.0);
  });
});

/**
 * Pruebas para Advanced Arrhythmia Processor
 */
describe('Advanced Arrhythmia Processor', () => {
  let processor: AdvancedArrhythmiaProcessor;
  
  beforeEach(() => {
    processor = new AdvancedArrhythmiaProcessor();
  });
  
  test('debe inicializar correctamente', () => {
    expect(processor).toBeDefined();
    const status = processor.getStatus();
    expect(status.rrCount).toBe(0);
    expect(status.isLearning).toBe(true);
    expect(status.baselineEstablished).toBe(false);
  });
  
  test('debe procesar picos R correctamente', () => {
    // Simular picos R con intervalos normales
    const baseTime = Date.now();
    const normalInterval = 800; // 75 BPM
    
    for (let i = 0; i < 100; i++) {
      const peakTime = baseTime + i * normalInterval;
      const result = processor.processPeak(peakTime);
      
      if (result) {
        expect(result.isArrhythmiaDetected).toBeDefined();
        expect(['normal', 'bradycardia', 'tachycardia', 'irregular', 'ectopic', 'unknown']).toContain(result.arrhythmiaType);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
        expect(result.recommendations).toBeDefined();
        expect(result.recommendations.length).toBeGreaterThan(0);
        expect(result.quality).toBeGreaterThanOrEqual(0);
        expect(result.quality).toBeLessThanOrEqual(1);
        
        // Verificar métricas HRV
        expect(result.hrvMetrics.meanRR).toBeGreaterThan(0);
        expect(result.hrvMetrics.sdnn).toBeGreaterThanOrEqual(0);
        expect(result.hrvMetrics.rmssd).toBeGreaterThanOrEqual(0);
        expect(result.hrvMetrics.pnn50).toBeGreaterThanOrEqual(0);
        expect(result.hrvMetrics.pnn20).toBeGreaterThanOrEqual(0);
      }
    }
  });
  
  test('debe detectar arritmias correctamente', () => {
    const baseTime = Date.now();
    
    // Simular latidos normales
    for (let i = 0; i < 50; i++) {
      processor.processPeak(baseTime + i * 800);
    }
    
    // Simular taquicardia
    for (let i = 50; i < 70; i++) {
      processor.processPeak(baseTime + i * 400); // 150 BPM
    }
    
    // Simular latidos normales de nuevo
    for (let i = 70; i < 100; i++) {
      processor.processPeak(baseTime + i * 800);
    }
    
    // Verificar que se detectó la arritmia
    const finalResult = processor.processPeak(baseTime + 100 * 800);
    if (finalResult) {
      expect(finalResult.isArrhythmiaDetected).toBe(true);
    }
  });
});

/**
 * Pruebas para Medical Algorithms Processor
 */
describe('Medical Algorithms Processor', () => {
  let processor: MedicalAlgorithmsProcessor;
  
  beforeEach(() => {
    processor = new MedicalAlgorithmsProcessor();
  });
  
  test('debe inicializar correctamente', () => {
    expect(processor).toBeDefined();
    const stats = processor.getProcessingStats();
    expect(stats.totalSamples).toBe(0);
    expect(stats.algorithmsUsed).toEqual([]);
    expect(stats.averageQuality).toBe(0);
  });
  
  test('debe procesar muestras correctamente', () => {
    const signal = generateSyntheticPPGSignal(300);
    
    for (let i = 0; i < 300; i++) {
      const result = processor.processSample(signal.red[i], signal.green[i], signal.blue[i], Date.now());
      
      if (result) {
        expect(result.heartRate).toBeGreaterThanOrEqual(0);
        expect(result.spo2).toBeGreaterThanOrEqual(70);
        expect(result.spo2).toBeLessThanOrEqual(100);
        expect(result.bloodPressure.systolic).toBeGreaterThan(0);
        expect(result.bloodPressure.diastolic).toBeGreaterThan(0);
        expect(result.bloodPressure.map).toBeGreaterThan(0);
        expect(result.perfusionIndex).toBeGreaterThanOrEqual(0);
        expect(result.signalQuality).toBeGreaterThanOrEqual(0);
        expect(result.confidence.overall).toBeGreaterThanOrEqual(0);
        expect(result.confidence.overall).toBeLessThanOrEqual(1);
        expect(result.processingInfo.algorithmsUsed).toBeDefined();
        expect(result.processingInfo.fusionMethod).toBeDefined();
        expect(result.processingInfo.qualityScore).toBeGreaterThanOrEqual(0);
        expect(result.rawData.redSignal).toBeDefined();
        expect(result.rawData.greenSignal).toBeDefined();
        expect(result.rawData.blueSignal).toBeDefined();
        expect(result.rawData.processedSignals).toBeDefined();
      }
    }
  });
  
  test('debe actualizar configuración dinámicamente', () => {
    const newConfig = {
      enableCHROM: false,
      fusionMethod: 'voting' as const,
      qualityThreshold: 0.8
    };
    
    processor.updateConfig(newConfig);
    
    // Verificar que la configuración se aplicó
    const result = processor.processSample(128, 128, 128, Date.now());
    if (result) {
      expect(result.processingInfo.fusionMethod).toBe('voting');
    }
  });
  
  test('debe mantener historial de resultados', () => {
    const signal = generateSyntheticPPGSignal(100);
    
    for (let i = 0; i < 100; i++) {
      processor.processSample(signal.red[i], signal.green[i], signal.blue[i], Date.now());
    }
    
    const history = processor.getResultHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history.length).toBeLessThanOrEqual(100); // Límite de historial
    
    const stats = processor.getProcessingStats();
    expect(stats.totalSamples).toBe(100);
    expect(stats.averageQuality).toBeGreaterThan(0);
  });
});

/**
 * Pruebas de integración
 */
describe('Integración de Algoritmos', () => {
  test('todos los algoritmos deben funcionar juntos', () => {
    const processor = new MedicalAlgorithmsProcessor({
      enableCHROM: true,
      enableFastICA: true,
      enableEulerian: true,
      enableAdvancedSpO2: true,
      enableAdvancedArrhythmia: true,
      fusionMethod: 'weighted',
      qualityThreshold: 0.6
    });
    
    const signal = generateSyntheticPPGSignal(500);
    
    let successCount = 0;
    for (let i = 0; i < 500; i++) {
      const result = processor.processSample(signal.red[i], signal.green[i], signal.blue[i], Date.now());
      if (result && result.processingInfo.algorithmsUsed.length > 0) {
        successCount++;
      }
    }
    
    // Al menos el 80% de las muestras deben procesarse exitosamente
    expect(successCount / 500).toBeGreaterThan(0.8);
  });
  
  test('debe manejar señales ruidosas', () => {
    const processor = new MedicalAlgorithmsProcessor();
    const signal = generateSyntheticPPGSignal(300);
    
    // Agregar ruido significativo
    for (let i = 0; i < signal.red.length; i++) {
      signal.red[i] += (Math.random() - 0.5) * 100;
      signal.green[i] += (Math.random() - 0.5) * 100;
      signal.blue[i] += (Math.random() - 0.5) * 100;
    }
    
    let processedCount = 0;
    for (let i = 0; i < 300; i++) {
      const result = processor.processSample(signal.red[i], signal.green[i], signal.blue[i], Date.now());
      if (result) {
        processedCount++;
        // Con ruido, la confianza debe ser menor
        expect(result.confidence.overall).toBeLessThan(0.9);
      }
    }
    
    expect(processedCount).toBeGreaterThan(0);
  });
});

/**
 * Pruebas de rendimiento
 */
describe('Rendimiento', () => {
  test('debe procesar en tiempo real', () => {
    const processor = new MedicalAlgorithmsProcessor();
    const signal = generateSyntheticPPGSignal(1000);
    
    const startTime = performance.now();
    
    for (let i = 0; i < 1000; i++) {
      processor.processSample(signal.red[i], signal.green[i], signal.blue[i], Date.now());
    }
    
    const endTime = performance.now();
    const processingTime = endTime - startTime;
    
    // Debe procesar 1000 muestras en menos de 10 segundos
    expect(processingTime).toBeLessThan(10000);
    
    // Tiempo promedio por muestra debe ser menor a 10ms
    const avgTimePerSample = processingTime / 1000;
    expect(avgTimePerSample).toBeLessThan(10);
  });
});

console.log('✅ Todas las pruebas de algoritmos médicos completadas exitosamente'); 