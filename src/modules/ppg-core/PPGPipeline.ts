/**
 * PPG PIPELINE UNIFICADO
 * 
 * Orquesta todo el flujo de procesamiento:
 * Captura -> Calibración -> Extracción -> Filtrado -> HDEM -> SQI -> Vitales
 * 
 * Características:
 * - Un solo punto de entrada
 * - Estado centralizado
 * - Sin duplicación de buffers
 * - 100% datos reales de cámara
 * - Zero simulación o randomización
 * 
 * Referencias:
 * - Chakraborty et al., Symmetry 2022 (HDEM)
 * - PMC5597264 (Multi-SQI)
 * - Frontiers Digital Health 2023 (ZLO Calibration)
 */

import { AdaptiveBandpass } from './AdaptiveBandpass';
import { RGBCalibrator, CalibratedRGB } from './RGBCalibrator';
import { MultiSQIValidator, SQIResult, ConfidenceLevel } from './MultiSQIValidator';
import { PeakDetectorHDEM } from './PeakDetectorHDEM';
import { HilbertTransform } from './HilbertTransform';

export interface PPGReading {
  timestamp: number;
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
}

export interface ProcessedPPGFrame {
  timestamp: number;
  
  // Señal procesada
  filteredValue: number;
  rawValue: number;
  
  // Estado de dedo
  fingerDetected: boolean;
  
  // Calibración RGB
  calibratedRGB: CalibratedRGB;
  
  // AC/DC components
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
  
  // Perfusion Index
  perfusionIndex: number;
  
  // Ratio R para SpO2
  ratioR: number;
  
  // Detección de pico
  isPeak: boolean;
  
  // BPM
  instantBPM: number;
  smoothedBPM: number;
  
  // RR Intervals
  rrInterval: number | null;
  rrIntervals: number[];
  
  // HRV
  hrv: {
    sdnn: number;
    rmssd: number;
    pnn50: number;
  };
  
  // Calidad de señal
  signalQuality: SQIResult;
  confidence: ConfidenceLevel;
  
  // SpO2 calculado
  spo2: number;
}

export interface PipelineState {
  isCalibrating: boolean;
  calibrationProgress: number;
  isProcessing: boolean;
  framesProcessed: number;
  lastBPM: number;
  lastSpO2: number;
  lastConfidence: ConfidenceLevel;
}

export type PipelineEventType = 
  | 'calibration_start'
  | 'calibration_complete'
  | 'peak_detected'
  | 'quality_change'
  | 'vitals_update';

export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: number;
  data?: any;
}

type EventCallback = (event: PipelineEvent) => void;

export class PPGPipeline {
  private sampleRate: number = 30;
  
  // Módulos de procesamiento
  private bandpass: AdaptiveBandpass;
  private calibrator: RGBCalibrator;
  private sqiValidator: MultiSQIValidator;
  private peakDetector: PeakDetectorHDEM;
  private hilbert: HilbertTransform;
  
  // Buffers de señal
  private redBuffer: number[] = [];
  private greenBuffer: number[] = [];
  private blueBuffer: number[] = [];
  private filteredBuffer: number[] = [];
  private readonly BUFFER_SIZE = 300; // 10 segundos @ 30fps
  private readonly ACDC_WINDOW = 90; // 3 segundos para AC/DC (reducido)
  private readonly MIN_ACDC_FRAMES = 30; // 1 segundo mínimo
  
  // AC/DC actuales
  private redAC: number = 0;
  private redDC: number = 0;
  private greenAC: number = 0;
  private greenDC: number = 0;
  
  // NUEVO: Validación temporal de dedo (5 frames consecutivos - reducido)
  private consecutiveFingerFrames: number = 0;
  private readonly MIN_FINGER_FRAMES = 5; // 166ms @ 30fps (era 10, muy estricto)
  private fingerStabilityBuffer: number[] = [];
  
  // Estado
  private state: PipelineState = {
    isCalibrating: false,
    calibrationProgress: 0,
    isProcessing: false,
    framesProcessed: 0,
    lastBPM: 0,
    lastSpO2: 0,
    lastConfidence: 'INVALID'
  };
  
  // Callbacks
  private onFrameProcessed?: (frame: ProcessedPPGFrame) => void;
  private eventListeners: Map<PipelineEventType, EventCallback[]> = new Map();
  
  // Logging
  private lastLogTime: number = 0;
  private logCounter: number = 0;
  
  constructor(options?: {
    sampleRate?: number;
    onFrameProcessed?: (frame: ProcessedPPGFrame) => void;
  }) {
    if (options?.sampleRate) {
      this.sampleRate = options.sampleRate;
    }
    if (options?.onFrameProcessed) {
      this.onFrameProcessed = options.onFrameProcessed;
    }
    
    // Inicializar módulos
    this.bandpass = new AdaptiveBandpass(this.sampleRate, { 
      enableNotch: false, // A 30fps no tiene sentido filtrar 50/60Hz
      filterOrder: 2 
    });
    this.calibrator = new RGBCalibrator();
    this.sqiValidator = new MultiSQIValidator(this.sampleRate);
    this.peakDetector = new PeakDetectorHDEM(this.sampleRate);
    this.hilbert = new HilbertTransform(this.sampleRate);
    
    console.log('✅ PPGPipeline inicializado');
  }
  
  /**
   * INICIAR PROCESAMIENTO
   */
  start(): void {
    if (this.state.isProcessing) return;
    
    this.state.isProcessing = true;
    this.state.framesProcessed = 0;
    console.log('🚀 PPGPipeline: Procesamiento iniciado');
  }
  
  /**
   * DETENER PROCESAMIENTO
   */
  stop(): void {
    this.state.isProcessing = false;
    console.log('🛑 PPGPipeline: Procesamiento detenido');
  }
  
  /**
   * INICIAR CALIBRACIÓN ZLO
   * Llamar cuando la cámara está lista pero SIN dedo
   */
  startCalibration(): void {
    this.calibrator.startCalibration();
    this.state.isCalibrating = true;
    this.state.calibrationProgress = 0;
    this.emitEvent('calibration_start', {});
  }
  
  /**
   * FORZAR CALIBRACIÓN DESDE MEDICIÓN ACTIVA
   */
  forceCalibration(): void {
    if (this.redBuffer.length > 0 && this.greenBuffer.length > 0) {
      const lastRed = this.redBuffer[this.redBuffer.length - 1];
      const lastGreen = this.greenBuffer[this.greenBuffer.length - 1];
      const lastBlue = this.blueBuffer[this.blueBuffer.length - 1] || 0;
      
      this.calibrator.forceCalibrationFromMeasurement(lastRed, lastGreen, lastBlue);
      this.state.isCalibrating = false;
      this.state.calibrationProgress = 100;
    }
  }
  
  /**
   * PROCESAR FRAME DE IMAGEN
   * Punto de entrada principal para cada frame de cámara
   */
  processFrame(imageData: ImageData): ProcessedPPGFrame | null {
    if (!this.state.isProcessing) return null;
    
    const timestamp = Date.now();
    this.state.framesProcessed++;
    this.logCounter++;
    
    // 1. EXTRAER RGB DE ROI (85%)
    const { rawRed, rawGreen, rawBlue } = this.extractROI(imageData);
    
    // 2. AUTO-CALIBRACIÓN INSTANTÁNEA (sin esperar frames sin dedo)
    // Detectar si hay dedo ANTES de calibrar
    const fingerDetected = this.detectFinger(rawRed, rawGreen);
    
    if (!this.calibrator.isCalibrated()) {
      if (fingerDetected && rawRed > 100) {
        // Hay dedo con buena señal - calibrar instantáneamente desde medición activa
        this.calibrator.forceCalibrationFromMeasurement(rawRed, rawGreen, rawBlue);
        this.state.isCalibrating = false;
        this.state.calibrationProgress = 100;
        this.emitEvent('calibration_complete', { calibration: this.calibrator.getCalibration() });
        console.log('⚡ Calibración instantánea desde dedo detectado');
      } else if (this.state.isCalibrating) {
        // Sin dedo - calibración ZLO tradicional
        const complete = this.calibrator.addCalibrationSample(rawRed, rawGreen, rawBlue);
        this.state.calibrationProgress = this.calibrator.getCalibrationProgress();
        
        if (complete) {
          this.state.isCalibrating = false;
          this.emitEvent('calibration_complete', { calibration: this.calibrator.getCalibration() });
        }
      }
    }
    
    // 3. CALIBRAR RGB
    const calibratedRGB = this.calibrator.calibrate(rawRed, rawGreen, rawBlue);
    
    // 4. GUARDAR EN BUFFERS
    this.redBuffer.push(calibratedRGB.linearRed);
    this.greenBuffer.push(calibratedRGB.linearGreen);
    this.blueBuffer.push(calibratedRGB.linearBlue);
    
    if (this.redBuffer.length > this.BUFFER_SIZE) {
      this.redBuffer.shift();
      this.greenBuffer.shift();
      this.blueBuffer.shift();
    }
    
    // 5. CALCULAR AC/DC (ahora con menos frames mínimos)
    if (this.redBuffer.length >= this.MIN_ACDC_FRAMES) {
      this.calculateACDC();
    }
    
    // 6. CALCULAR PERFUSION INDEX DESDE CANAL ROJO (mejor SNR)
    const perfusionIndex = this.redDC > 0 ? (this.redAC / this.redDC) * 100 : 0;
    
    // 7. VALIDAR PI FISIOLÓGICO (gatekeeper pero más tolerante)
    // Con dedo real: PI típico 0.05% - 20% (rango ampliado)
    // Sin dedo (ruido puro): PI = 0 o muy bajo/alto
    const piIsValid = perfusionIndex >= 0.05 && perfusionIndex <= 20;
    
    // 8. SELECCIONAR CANAL ROJO COMO PRIMARIO (mejor SNR con flash LED)
    // Solo usar verde como fallback si rojo está saturado
    const redSaturated = rawRed > 250;
    const signalSource = redSaturated ? calibratedRGB.linearGreen : calibratedRGB.linearRed;
    
    // NO INVERTIR - modo reflectivo con flash no requiere inversión
    // La inversión amplificaba ruido cuando no hay dedo
    const filtered = this.bandpass.filter(signalSource);
    
    this.filteredBuffer.push(filtered);
    if (this.filteredBuffer.length > this.BUFFER_SIZE) {
      this.filteredBuffer.shift();
    }
    
    // 9. DETECTAR PICO SOLO SI HAY DEDO VÁLIDO Y PI EN RANGO
    // CRÍTICO: Bloquear detección si no hay dedo real
    let peakResult = { isPeak: false, bpm: 0, rrInterval: null as number | null, confidence: 0 };
    
    // CORRECCIÓN: Procesar picos siempre que hay dedo detectado
    // El PI se usa para filtrar DESPUÉS, no como gatekeeper
    if (fingerDetected) {
      peakResult = this.peakDetector.processSample(filtered, timestamp, perfusionIndex);
    }
    
    // 10. CALCULAR CALIDAD DE SEÑAL
    const signalQuality = this.sqiValidator.validate(
      this.filteredBuffer.slice(-90),
      this.redAC, // Usar red AC (canal principal)
      this.redDC  // Usar red DC (canal principal)
    );
    
    // 11. CALCULAR SpO2
    const ratioR = this.calculateRatioR();
    const spo2 = this.calculateSpO2(ratioR, perfusionIndex);
    
    // 12. CALCULAR HRV
    const rrIntervals = this.peakDetector.getRRIntervals();
    const hrv = this.peakDetector.calculateHRV(rrIntervals);
    
    // ACTUALIZAR ESTADO
    this.state.lastBPM = peakResult.bpm;
    this.state.lastSpO2 = spo2;
    this.state.lastConfidence = fingerDetected && piIsValid ? signalQuality.confidence : 'INVALID';
    
    // EMITIR EVENTOS
    if (peakResult.isPeak) {
      this.emitEvent('peak_detected', { timestamp, bpm: peakResult.bpm });
    }
    
    // LOG CADA SEGUNDO
    if (timestamp - this.lastLogTime >= 1000) {
      this.lastLogTime = timestamp;
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`📊 PPGPipeline | Frame #${this.state.framesProcessed}`);
      console.log(`   👆 DEDO: ${fingerDetected ? '✅ DETECTADO' : '❌ NO'} | Frames: ${this.consecutiveFingerFrames}`);
      console.log(`   🔴 RED:   AC=${this.redAC.toFixed(3)} DC=${this.redDC.toFixed(1)}`);
      console.log(`   🟢 GREEN: AC=${this.greenAC.toFixed(3)} DC=${this.greenDC.toFixed(1)}`);
      console.log(`   📈 PI=${perfusionIndex.toFixed(2)}% ${piIsValid ? '✅' : '❌'} | R=${ratioR.toFixed(3)} | SpO2=${spo2}%`);
      console.log(`   💓 BPM=${peakResult.bpm} | SQI=${signalQuality.globalSQI.toFixed(0)}% (${signalQuality.confidence})`);
    }
    
    // CONSTRUIR RESULTADO
    const result: ProcessedPPGFrame = {
      timestamp,
      filteredValue: filtered,
      rawValue: signalSource, // Sin inversión
      fingerDetected,
      calibratedRGB,
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      perfusionIndex,
      ratioR,
      isPeak: peakResult.isPeak,
      instantBPM: peakResult.bpm,
      smoothedBPM: this.peakDetector.getCurrentBPM(),
      rrInterval: peakResult.rrInterval,
      rrIntervals,
      hrv,
      signalQuality,
      confidence: fingerDetected && piIsValid ? signalQuality.confidence : 'INVALID',
      spo2
    };
    
    // CALLBACK
    if (this.onFrameProcessed) {
      this.onFrameProcessed(result);
    }
    
    return result;
  }
  
  /**
   * EXTRAER RGB DE ROI (85%)
   */
  private extractROI(imageData: ImageData): { rawRed: number; rawGreen: number; rawBlue: number } {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    const roiSize = Math.min(width, height) * 0.85;
    const startX = Math.floor((width - roiSize) / 2);
    const startY = Math.floor((height - roiSize) / 2);
    const endX = startX + Math.floor(roiSize);
    const endY = startY + Math.floor(roiSize);
    
    let redSum = 0, greenSum = 0, blueSum = 0;
    let count = 0;
    
    // Muestrear cada 4 píxeles
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const i = (y * width + x) * 4;
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
        count++;
      }
    }
    
    return {
      rawRed: count > 0 ? redSum / count : 0,
      rawGreen: count > 0 ? greenSum / count : 0,
      rawBlue: count > 0 ? blueSum / count : 0
    };
  }
  
  /**
   * DETECCIÓN DE DEDO ROBUSTA (Oxford/IEEE 2020 + Nature 2025)
   * 
   * Con flash encendido, el dedo iluminado debe dar valores ALTOS de rojo.
   * La sangre absorbe más verde que rojo, por lo que R/G > 1.2
   * 
   * CRÍTICO: Requiere validación TEMPORAL (10 frames consecutivos)
   * para evitar falsos positivos por objetos transitorios.
   * 
   * Criterios:
   * 1. Red > 120 (con flash, valores altos)
   * 2. R/G ratio > 1.2 y < 3.5 (sangre real, más estricto)
   * 3. No saturado (< 253)
   * 4. 10 frames consecutivos cumpliendo criterios
   * 5. Varianza estable en ventana de 10 frames
   */
  private detectFinger(rawRed: number, rawGreen: number): boolean {
    // Con flash encendido, el dedo iluminado debe dar valores ALTOS
    // RELAJADO: Red > 80 (era 120, demasiado estricto para algunos dispositivos)
    const hasHighRed = rawRed > 80;
    
    // Ratio R/G: sangre absorbe verde más que rojo
    // RELAJADO: 1.0 - 4.0 (era 1.2 - 3.5, demasiado estricto)
    const rgRatio = rawGreen > 0 ? rawRed / rawGreen : 0;
    const validRatio = rgRatio > 1.0 && rgRatio < 4.0;
    
    // No saturado
    const notSaturated = rawRed < 253 && rawGreen < 253;
    
    // Criterios instantáneos
    const instantFingerDetected = hasHighRed && validRatio && notSaturated;
    
    // VALIDACIÓN TEMPORAL: Requiere frames consecutivos
    if (instantFingerDetected) {
      this.consecutiveFingerFrames++;
      this.fingerStabilityBuffer.push(rawRed);
      if (this.fingerStabilityBuffer.length > 10) {
        this.fingerStabilityBuffer.shift();
      }
    } else {
      this.consecutiveFingerFrames = 0;
      this.fingerStabilityBuffer = [];
    }
    
    // Verificar estabilidad (varianza más tolerante)
    let isStable = true;
    if (this.fingerStabilityBuffer.length >= 5) {
      const mean = this.fingerStabilityBuffer.reduce((a, b) => a + b, 0) / this.fingerStabilityBuffer.length;
      const variance = this.fingerStabilityBuffer.reduce((acc, v) => acc + (v - mean) ** 2, 0) / this.fingerStabilityBuffer.length;
      isStable = variance < 100; // Más tolerante (era 25)
    }
    
    // Solo considerar dedo válido después de N frames consecutivos Y estable
    const fingerDetected = this.consecutiveFingerFrames >= this.MIN_FINGER_FRAMES && isStable;
    
    // Log cada 30 frames para debugging
    if (this.state.framesProcessed % 30 === 0) {
      console.log(`👆 Finger: R=${rawRed.toFixed(0)} G=${rawGreen.toFixed(0)} R/G=${rgRatio.toFixed(2)} | Frames=${this.consecutiveFingerFrames} Stable=${isStable} → ${fingerDetected ? '✅' : '❌'}`);
    }
    
    return fingerDetected;
  }
  
  /**
   * CALCULAR AC/DC CON MÉTODO RMS + PERCENTILES
   */
  private calculateACDC(): void {
    const windowSize = Math.min(this.ACDC_WINDOW, this.redBuffer.length);
    // CORRECCIÓN: Permitir cálculo desde 30 frames (1 segundo) en lugar de 60
    if (windowSize < 30) return;
    
    const redWindow = this.redBuffer.slice(-windowSize);
    const greenWindow = this.greenBuffer.slice(-windowSize);
    
    // DC = promedio
    this.redDC = redWindow.reduce((a, b) => a + b, 0) / windowSize;
    this.greenDC = greenWindow.reduce((a, b) => a + b, 0) / windowSize;
    
    if (this.redDC < 5 || this.greenDC < 5) return;
    
    // AC via RMS
    let redSumSq = 0, greenSumSq = 0;
    for (let i = 0; i < windowSize; i++) {
      redSumSq += Math.pow(redWindow[i] - this.redDC, 2);
      greenSumSq += Math.pow(greenWindow[i] - this.greenDC, 2);
    }
    
    const redRMS = Math.sqrt(redSumSq / windowSize);
    const greenRMS = Math.sqrt(greenSumSq / windowSize);
    
    // AC via Percentiles
    const sortedRed = [...redWindow].sort((a, b) => a - b);
    const sortedGreen = [...greenWindow].sort((a, b) => a - b);
    
    const p5 = Math.floor(windowSize * 0.05);
    const p95 = Math.floor(windowSize * 0.95);
    
    const redP2P = sortedRed[p95] - sortedRed[p5];
    const greenP2P = sortedGreen[p95] - sortedGreen[p5];
    
    // Fusión
    this.redAC = (redRMS * Math.sqrt(2) + redP2P * 0.5) / 2;
    this.greenAC = (greenRMS * Math.sqrt(2) + greenP2P * 0.5) / 2;
    
    // Validación
    if (this.redAC / this.redDC < 0.001 || this.greenAC / this.greenDC < 0.001) {
      this.redAC = 0;
      this.greenAC = 0;
    }
  }
  
  /**
   * CALCULAR RATIO R PARA SpO2
   */
  private calculateRatioR(): number {
    if (this.redDC === 0 || this.greenDC === 0 || this.greenAC === 0) {
      return 0;
    }
    
    return (this.redAC / this.redDC) / (this.greenAC / this.greenDC);
  }
  
  /**
   * CALCULAR SpO2 CON CORRECCIÓN POR PI
   */
  private calculateSpO2(ratioR: number, perfusionIndex: number): number {
    if (ratioR < 0.4 || ratioR > 2.5) {
      return 0; // Fuera de rango válido
    }
    
    // Fórmula base: SpO2 = 110 - 25 * R (estándar clínico)
    // Ajustada para cámara R/G: SpO2 = 100 - 15 * (R - 0.8)
    let spo2 = 100 - 15 * (ratioR - 0.8);
    
    // Corrección por Perfusion Index
    if (perfusionIndex < 1) {
      spo2 += 2; // Señal débil, tender a subestimar
    } else if (perfusionIndex > 5) {
      spo2 -= 1; // Señal muy fuerte
    }
    
    // Validación fisiológica
    if (spo2 < 50 || spo2 > 105) {
      return 0; // Valor imposible
    }
    
    return Math.round(Math.min(100, Math.max(70, spo2)));
  }
  
  /**
   * OBTENER ESTADO ACTUAL
   */
  getState(): PipelineState {
    return { ...this.state };
  }
  
  /**
   * OBTENER ESTADÍSTICAS RGB
   */
  getRGBStats() {
    return {
      redAC: this.redAC,
      redDC: this.redDC,
      greenAC: this.greenAC,
      greenDC: this.greenDC,
      ratioR: this.calculateRatioR(),
      perfusionIndex: this.greenDC > 0 ? (this.greenAC / this.greenDC) * 100 : 0
    };
  }
  
  /**
   * OBTENER RR INTERVALS
   */
  getRRIntervals(): number[] {
    return this.peakDetector.getRRIntervals();
  }
  
  /**
   * SUSCRIBIRSE A EVENTOS
   */
  on(event: PipelineEventType, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }
  
  /**
   * EMITIR EVENTO
   */
  private emitEvent(type: PipelineEventType, data: any): void {
    const event: PipelineEvent = { type, timestamp: Date.now(), data };
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(cb => cb(event));
    }
  }
  
  /**
   * RESET COMPLETO
   */
  reset(): void {
    this.redBuffer = [];
    this.greenBuffer = [];
    this.blueBuffer = [];
    this.filteredBuffer = [];
    
    this.redAC = 0;
    this.redDC = 0;
    this.greenAC = 0;
    this.greenDC = 0;
    
    // Reset validación temporal de dedo
    this.consecutiveFingerFrames = 0;
    this.fingerStabilityBuffer = [];
    
    this.bandpass.reset();
    this.calibrator.reset();
    this.peakDetector.reset();
    
    this.state = {
      isCalibrating: false,
      calibrationProgress: 0,
      isProcessing: false,
      framesProcessed: 0,
      lastBPM: 0,
      lastSpO2: 0,
      lastConfidence: 'INVALID'
    };
    
    console.log('🔄 PPGPipeline: Reset completo');
  }
  
  /**
   * DISPOSE
   */
  dispose(): void {
    this.stop();
    this.reset();
    this.eventListeners.clear();
  }
}
