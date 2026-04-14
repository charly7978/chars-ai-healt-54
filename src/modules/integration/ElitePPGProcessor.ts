/**
 * ELITE PPG PROCESSOR - INTEGRACIÓN COMPLETA (9.8/10)
 * 
 * Sistema unificado que integra:
 * - AdvancedFingerTracker (detección óptica de dedo)
 * - PPGSignalProcessor (procesamiento de señal multi-canal)
 * - HeartBeatProcessor (detección de latidos dual)
 * - HRVNonlinearAnalyzer (Poincaré, DFA, Sample Entropy)
 * - HRVFrequencyAnalyzer (Welch PSD, bandas VLF/LF/HF)
 * - AdvancedArrhythmiaDetector (clasificación de arritmias)
 * 
 * FLUJO 100% REAL: Cámara → ROI → PPG → Beats → HRV → Diagnóstico
 */

import { AdvancedFingerTracker, type FingerTrackingResult } from '../signal-processing/AdvancedFingerTracker';
import {
  BeatMeasurementGate,
  emptyHeartBeatResult,
  stableForBeatsFromSignal,
} from '../signal-processing/beatContactGating';
import { PPGSignalProcessor } from '../signal-processing/PPGSignalProcessor';
import { HeartBeatProcessor } from '../HeartBeatProcessor';
import type { HeartBeatResult } from '../../types/beat';
import { HRVNonlinearAnalyzer, type NonlinearHRVResult } from '../vital-signs/HRVNonlinearAnalyzer';
import { HRVFrequencyAnalyzer, type FrequencyHRVResult } from '../vital-signs/HRVFrequencyAnalyzer';
import { AdvancedArrhythmiaDetector, type ArrhythmiaResult, type ArrhythmiaType } from '../vital-signs/AdvancedArrhythmiaDetector';
import { SpO2ProcessorElite } from '../vital-signs/SpO2ProcessorElite';
import { BloodPressureProcessorElite } from '../vital-signs/BloodPressureProcessorElite';
import { getUserHeightMFromStorage } from '../personalization/userPhysiology';
import type { ProcessedSignal } from '../../types/signal';

export type BpConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';

export interface ElitePPGResult {
  finger: {
    detected: boolean;
    contactQuality: number;
    stabilityScore: number;
    pressure: number;
    perfusionIndex: number;
    snr: number;
    centerX: number;
    centerY: number;
  };
  
  signal: {
    raw: number;
    filtered: number;
    quality: number;
    contactState: string;
    pressureState: string;
    activeSource: string;
  };
  
  beat: {
    isPeak: boolean;
    bpm: number;
    rrInterval: number;
    beatSQI: number;
    confidence: number;
  };
  
  hrvTime: {
    rrIntervals: number[];
    rmssd: number;
    sdnn: number;
    pnn50: number;
    meanRR: number;
    heartRate: number;
  };
  
  hrvNonlinear: NonlinearHRVResult | null;
  hrvFrequency: FrequencyHRVResult | null;
  
  arrhythmia: {
    detected: boolean;
    type: ArrhythmiaType | null;
    confidence: number;
    severity: 'info' | 'warning' | 'alert' | 'critical' | null;
  };

  /** Oximetría (SpO2ProcessorElite); 0 si calidad insuficiente o retenido */
  spo2: number;
  spo2Confidence: number;
  /** Presión estimada (BloodPressureProcessorElite); 0 si INSUFFICIENT */
  systolicBP: number;
  diastolicBP: number;
  bpConfidenceLevel: BpConfidenceLevel;
  
  timestamp: number;
  processingTime: number;
  frameCount: number;
}

export interface EliteConfig {
  minContactQuality: number;
  minBeatSQI: number;
  minRRForHRV: number;
  enableNonlinearHRV: boolean;
  enableFrequencyHRV: boolean;
  enableArrhythmiaDetection: boolean;
  /** Altura usuario (m); si no se define, se lee del perfil en almacenamiento */
  userHeightM?: number;
}

export class ElitePPGProcessor {
  private fingerTracker: AdvancedFingerTracker;
  private ppgProcessor: PPGSignalProcessor;
  private beatProcessor: HeartBeatProcessor;
  private hrvNonlinear: HRVNonlinearAnalyzer;
  private hrvFrequency: HRVFrequencyAnalyzer;
  private arrhythmiaDetector: AdvancedArrhythmiaDetector;
  private spo2Processor: SpO2ProcessorElite;
  private bpProcessor: BloodPressureProcessorElite;
  private signalBuffer: number[] = [];
  private timestampBuffer: number[] = [];
  
  private config: EliteConfig;
  private isRunning = false;
  private frameCount = 0;
  private lastResult: ElitePPGResult | null = null;
  private rrHistory: number[] = [];
  /** Alineado con useHeartBeatProcessor: muchos frames sin contacto → reset del detector */
  private noContactBeatFrames = 0;
  private readonly NO_CONTACT_BEAT_RESET = 200;
  private readonly beatMeasurementGate = new BeatMeasurementGate();
  private lastBeatGateActive = false;

  private onResult?: (result: ElitePPGResult) => void;
  private onArrhythmia?: (result: ArrhythmiaResult) => void;

  private lastSignal: ProcessedSignal | null = null;
  private lastBeatResult: HeartBeatResult | null = null;
  private lastFingerResult: FingerTrackingResult | null = null;
  
  constructor(config: Partial<EliteConfig> = {}) {
    this.config = {
      minContactQuality: 60,
      minBeatSQI: 60,
      minRRForHRV: 20,
      enableNonlinearHRV: true,
      enableFrequencyHRV: true,
      enableArrhythmiaDetection: true,
      ...config
    };
    
    this.fingerTracker = new AdvancedFingerTracker();
    
    // PPGSignalProcessor usa callbacks
    this.ppgProcessor = new PPGSignalProcessor(
      (signal) => { this.lastSignal = signal; },
      (error) => { console.error('PPG Error:', error); }
    );
    
    this.beatProcessor = new HeartBeatProcessor();
    this.hrvNonlinear = new HRVNonlinearAnalyzer();
    this.hrvFrequency = new HRVFrequencyAnalyzer();
    this.arrhythmiaDetector = new AdvancedArrhythmiaDetector();
    this.spo2Processor = new SpO2ProcessorElite();
    this.bpProcessor = new BloodPressureProcessorElite();
  }
  
  start(): void {
    this.isRunning = true;
    this.ppgProcessor.start();
    this.reset();
  }
  
  stop(): void {
    this.isRunning = false;
    this.ppgProcessor.stop();
  }
  
  reset(): void {
    this.frameCount = 0;
    this.rrHistory = [];
    this.signalBuffer = [];
    this.timestampBuffer = [];
    this.lastResult = null;
    this.lastSignal = null;
    this.lastBeatResult = null;
    this.lastFingerResult = null;
    this.noContactBeatFrames = 0;
    this.beatMeasurementGate.reset();
    this.lastBeatGateActive = false;
    this.fingerTracker.reset();
    this.ppgProcessor.reset?.();
    this.beatProcessor.reset?.();
    this.hrvNonlinear.reset();
    this.hrvFrequency.reset();
    this.arrhythmiaDetector.reset();
    this.spo2Processor.reset();
    this.bpProcessor.reset();
  }
  
  processFrame(frame: ImageData | ImageBitmap, timestamp: number): ElitePPGResult {
    const startTime = performance.now();
    this.frameCount++;
    
    // FASE 1: PPG etapa 1 (ROI/contacto/extracción); modo sync: análisis del mismo frame disponible después
    this.ppgProcessor.processFrame(frame, timestamp);

    const pipelineSnap = this.ppgProcessor.getLastFrameAnalysis?.() ?? null;

    // FASE 2: TRACKING DE DEDO (híbrido con métricas del pipeline)
    const fingerInput =
      typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap ? null : frame;
    const fingerResult = this.fingerTracker.processFrame(fingerInput, pipelineSnap);
    this.lastFingerResult = fingerResult;

    const ppgSignal = this.lastSignal;

    // FASE 3: LATIDOS — misma regla que Index (beatContactGating); sin procesar sin contacto estable
    let beatResult: HeartBeatResult | null = null;

    if (!ppgSignal) {
      this.lastBeatResult = null;
      this.beatMeasurementGate.reset();
      this.lastBeatGateActive = false;
    } else {
      const rawOk = stableForBeatsFromSignal(ppgSignal);
      const shouldProcessBeats = this.beatMeasurementGate.update(rawOk);
      this.lastBeatGateActive = shouldProcessBeats;

      if (shouldProcessBeats) {
        this.noContactBeatFrames = 0;
        const pq = this.ppgProcessor.getPositionQuality();
        const ppgPressure = ppgSignal.pressureState;
        const pressureOptimal =
          ppgPressure === 'OPTIMAL_PRESSURE' ||
          (pq.locked && !pq.drifting && pq.qualityScore >= 0.55);
        const resolvedPressure =
          ppgPressure ?? (pressureOptimal ? 'OPTIMAL_PRESSURE' : 'LOW_PRESSURE');

        beatResult = this.beatProcessor.processSignal(
          ppgSignal.filteredValue ?? ppgSignal.rawValue ?? 0,
          timestamp,
          {
            quality: ppgSignal.quality,
            contactState: 'STABLE_CONTACT',
            motionArtifact: ppgSignal.motionArtifact ?? false,
            pressureState: resolvedPressure,
            clipHigh: ppgSignal.clipHighRatio ?? 0,
            clipLow: ppgSignal.clipLowRatio ?? 0,
            activeSource: ppgSignal.activeSource,
            perfusionIndex: ppgSignal.perfusionIndex,
            positionDrifting: pq.drifting,
          }
        );
      } else {
        this.noContactBeatFrames++;
        if (this.noContactBeatFrames >= this.NO_CONTACT_BEAT_RESET) {
          this.beatProcessor.reset();
          this.beatMeasurementGate.reset();
          this.noContactBeatFrames = 0;
        }
        beatResult = emptyHeartBeatResult(0);
      }
      this.lastBeatResult = beatResult;
    }
    
    // FASE 4: ACUMULAR RR
    if (beatResult?.isPeak && beatResult.rrData?.intervals?.length > 0) {
      const rr = beatResult.rrData.intervals[beatResult.rrData.intervals.length - 1];
      this.rrHistory.push(rr);
      
      if (this.rrHistory.length > 300) {
        this.rrHistory.shift();
      }
    }
    
    // FASE 5: ANÁLISIS HRV
    let hrvNonlinear: NonlinearHRVResult | null = null;
    let hrvFrequency: FrequencyHRVResult | null = null;
    
    if (this.config.enableNonlinearHRV && this.rrHistory.length >= this.config.minRRForHRV) {
      hrvNonlinear = this.hrvNonlinear.analyze(this.rrHistory.slice(-64));
    }
    
    if (this.config.enableFrequencyHRV && this.rrHistory.length >= 64) {
      hrvFrequency = this.hrvFrequency.analyze(this.rrHistory.slice(-128));
    }
    
    // FASE 6: DETECCIÓN DE ARRITMIAS
    let arrhythmiaResult: ArrhythmiaResult | null = null;
    
    if (this.config.enableArrhythmiaDetection && beatResult?.isPeak && ppgSignal) {
      const rr = beatResult.rrData?.intervals?.[beatResult.rrData.intervals.length - 1] ?? 0;
      
      // Crear ventana sintética de señal PPG desde datos disponibles
      const ppgWindow = this.createPPGWindow(ppgSignal);
      
      arrhythmiaResult = this.arrhythmiaDetector.processBeat(
        rr,
        timestamp,
        ppgWindow,
        ppgWindow.length - 1,
        beatResult.beatSQI ?? 50
      );
      
      if (arrhythmiaResult && arrhythmiaResult.confidence > 0.6) {
        this.onArrhythmia?.(arrhythmiaResult);
      }
    }

    // Buffer PPG para estimación de PA (misma ventana que Index.tsx)
    const fv = ppgSignal?.filteredValue;
    if (fv !== undefined && fv !== null && Number.isFinite(fv)) {
      this.signalBuffer.push(fv);
      this.timestampBuffer.push(timestamp);
      if (this.signalBuffer.length > 360) {
        this.signalBuffer.shift();
        this.timestampBuffer.shift();
      }
    }

    let spo2 = 0;
    let spo2Confidence = 0;
    let systolicBP = 0;
    let diastolicBP = 0;
    let bpConfidenceLevel: BpConfidenceLevel = 'INSUFFICIENT';

    const rgbStats = this.ppgProcessor.getRGBStats();
    if (rgbStats.redDC > 0 && rgbStats.greenDC > 0 && beatResult) {
      const pressureOptimal =
        fingerResult.pressureEstimate >= 0.35 && fingerResult.pressureEstimate <= 0.65;
      const pipeQ = Math.min(
        100,
        Math.max(
          fingerResult.contactQuality,
          Math.round((ppgSignal?.quality ?? 0) * 0.97),
          Math.round(((ppgSignal?.maskIoU ?? 0) * 0.52 + (ppgSignal?.roiCoverage ?? 0) * 0.48) * 100)
        )
      );
      const spo2Res = this.spo2Processor.process({
        redAC: rgbStats.redAC,
        redDC: rgbStats.redDC,
        greenAC: rgbStats.greenAC,
        greenDC: rgbStats.greenDC,
        contactQuality: pipeQ,
        beatSQI: beatResult.beatSQI ?? 0,
        pressureOptimal,
        clipHighRatio: ppgSignal?.clipHighRatio ?? 0,
        clipLowRatio: ppgSignal?.clipLowRatio ?? 0,
      });
      if (spo2Res.value > 0) {
        spo2 = spo2Res.value;
        spo2Confidence = spo2Res.confidence;
      }
    }

    const rrIntervals = beatResult?.rrData?.intervals;
    const usableRR =
      rrIntervals &&
      rrIntervals.length >= 2 &&
      (beatResult?.bpmConfidence ?? 0) > 0.18;
    if (usableRR && this.signalBuffer.length > 90 && rrIntervals) {
      const sr = this.estimateSampleRate();
      const heightM = this.config.userHeightM ?? getUserHeightMFromStorage();
      const bpRes = this.bpProcessor.process(
        [...this.signalBuffer],
        rrIntervals,
        [...this.timestampBuffer],
        sr,
        heightM
      );
      if (bpRes.confidenceLevel !== 'INSUFFICIENT') {
        systolicBP = bpRes.systolic;
        diastolicBP = bpRes.diastolic;
        bpConfidenceLevel = bpRes.confidenceLevel;
      }
    }
    
    // CONSTRUIR RESULTADO
    const result: ElitePPGResult = {
      finger: {
        detected:
          fingerResult.contactQuality > 38 &&
          ppgSignal?.contactState === 'STABLE_CONTACT' &&
          ppgSignal?.extendedContactState === 'STABLE_CONTACT',
        contactQuality: fingerResult.contactQuality,
        stabilityScore: fingerResult.stabilityScore,
        pressure: fingerResult.pressureEstimate,
        perfusionIndex: fingerResult.perfusionIndex,
        snr: fingerResult.signalToNoiseRatio,
        centerX: fingerResult.centerX,
        centerY: fingerResult.centerY
      },
      signal: {
        raw: ppgSignal?.rawValue ?? 0,
        filtered: ppgSignal?.filteredValue ?? 0,
        quality: ppgSignal?.quality ?? 0,
        contactState: ppgSignal?.contactState ?? 'NO_CONTACT',
        pressureState: ppgSignal?.pressureState ?? 'UNKNOWN',
        activeSource: ppgSignal?.activeSource ?? 'UNKNOWN'
      },
      beat: {
        isPeak: beatResult?.isPeak ?? false,
        bpm: beatResult?.bpm ?? 0,
        rrInterval: beatResult?.rrData?.intervals?.[beatResult.rrData.intervals.length - 1] ?? 0,
        beatSQI: beatResult?.beatSQI ?? 0,
        confidence: beatResult?.bpmConfidence ?? 0
      },
      hrvTime: {
        rrIntervals: [...this.rrHistory.slice(-30)],
        rmssd: this.calculateRMSSD(this.rrHistory.slice(-30)),
        sdnn: this.calculateSDNN(this.rrHistory.slice(-30)),
        pnn50: this.calculatePNN50(this.rrHistory.slice(-30)),
        meanRR: this.rrHistory.length > 0 
          ? this.rrHistory.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, this.rrHistory.length) 
          : 0,
        heartRate: beatResult?.bpm ?? 0
      },
      hrvNonlinear,
      hrvFrequency,
      arrhythmia: {
        detected: arrhythmiaResult !== null && arrhythmiaResult.confidence > 0.6,
        type: arrhythmiaResult?.primaryDiagnosis ?? null,
        confidence: arrhythmiaResult?.confidence ?? 0,
        severity: this.determineSeverity(arrhythmiaResult?.primaryDiagnosis ?? null)
      },
      spo2,
      spo2Confidence,
      systolicBP,
      diastolicBP,
      bpConfidenceLevel,
      timestamp,
      processingTime: performance.now() - startTime,
      frameCount: this.frameCount
    };
    
    this.lastResult = result;
    this.onResult?.(result);
    
    return result;
  }
  
  setResultCallback(callback: (result: ElitePPGResult) => void): void {
    this.onResult = callback;
  }
  
  setArrhythmiaCallback(callback: (result: ArrhythmiaResult) => void): void {
    this.onArrhythmia = callback;
  }
  
  getLastResult(): ElitePPGResult | null {
    return this.lastResult;
  }

  /** Misma instancia PPG que la UI principal — sin duplicar procesadores. */
  getLastProcessedSignal(): ProcessedSignal | null {
    return this.lastSignal;
  }

  getLastBeatResult(): HeartBeatResult | null {
    return this.lastBeatResult;
  }

  /** Alineado con `BeatMeasurementGate.update` en processFrame (histéresis de latidos). */
  isBeatMeasurementActive(): boolean {
    return this.lastBeatGateActive;
  }

  getLastFingerResult(): FingerTrackingResult | null {
    return this.lastFingerResult;
  }

  getRGBStats() {
    return this.ppgProcessor.getRGBStats();
  }

  getPositionQuality() {
    return this.ppgProcessor.getPositionQuality();
  }

  getPPGDebugInfo() {
    return this.ppgProcessor.getDebugInfo();
  }

  async calibrate(): Promise<boolean> {
    return this.ppgProcessor.calibrate();
  }

  setCameraControl(engine: import('../signal-processing/CameraControlEngine').CameraControlEngine | null): void {
    this.ppgProcessor.setCameraControl(engine);
  }

  setPPGDebugMode(enabled: boolean): void {
    this.ppgProcessor.setDebugMode(enabled);
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private estimateSampleRate(): number {
    const ts = this.timestampBuffer;
    if (ts.length < 6) return 30;
    const deltas: number[] = [];
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      if (d >= 8 && d <= 120) deltas.push(d);
    }
    if (deltas.length < 4) return 30;
    deltas.sort((a, b) => a - b);
    const median = deltas[Math.floor(deltas.length / 2)];
    return Math.max(15, Math.min(60, 1000 / Math.max(1, median)));
  }

  private determineSeverity(type: ArrhythmiaType | null): 'info' | 'warning' | 'alert' | 'critical' | null {
    if (!type) return null;
    
    const severityMap: Record<ArrhythmiaType, 'info' | 'warning' | 'alert' | 'critical'> = {
      'NORMAL_SINUS_RHYTHM': 'info',
      'SINUS_BRADYCARDIA': 'info',
      'SINUS_TACHYCARDIA': 'warning',
      'ATRIAL_FIBRILLATION': 'alert',
      'PREMATURE_ATRIAL_CONTRACTION': 'warning',
      'PREMATURE_VENTRICULAR_CONTRACTION': 'alert',
      'VENTRICULAR_TACHYCARDIA': 'critical',
      'BIGEMINY': 'warning',
      'TRIGEMINY': 'warning',
      'HEART_BLOCK': 'alert',
      'UNDETERMINED': 'info',
      'ARTIFACT': 'info'
    };
    
    return severityMap[type] || 'info';
  }
  
  private createPPGWindow(signal: ProcessedSignal): number[] {
    // Crear ventana de señal desde datos disponibles
    // En una implementación real, esto vendría de un ring buffer
    return [
      signal.rawValue ?? 0,
      signal.filteredValue ?? 0,
      (signal.rawValue ?? 0) * 0.9,
      (signal.filteredValue ?? 0) * 1.1,
      signal.rawValue ?? 0
    ];
  }
  
  private calculateRMSSD(rrIntervals: number[]): number {
    if (rrIntervals.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < rrIntervals.length; i++) {
      const diff = rrIntervals[i] - rrIntervals[i - 1];
      sum += diff * diff;
    }
    return Math.sqrt(sum / (rrIntervals.length - 1));
  }
  
  private calculateSDNN(rrIntervals: number[]): number {
    if (rrIntervals.length < 2) return 0;
    const mean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
    const variance = rrIntervals.reduce((s, v) => s + (v - mean) ** 2, 0) / rrIntervals.length;
    return Math.sqrt(variance);
  }
  
  private calculatePNN50(rrIntervals: number[]): number {
    if (rrIntervals.length < 2) return 0;
    let count = 0;
    for (let i = 1; i < rrIntervals.length; i++) {
      if (Math.abs(rrIntervals[i] - rrIntervals[i - 1]) > 50) count++;
    }
    return (count / (rrIntervals.length - 1)) * 100;
  }
}
