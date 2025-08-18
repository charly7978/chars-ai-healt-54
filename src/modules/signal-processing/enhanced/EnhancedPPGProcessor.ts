import { FrameData } from '../types';
import { FingerDetectionEnhancer } from './FingerDetectionEnhancer';
import { SignalCaptureEnhancer } from './SignalCaptureEnhancer';

/**
 * Enhanced PPG Processor - Sistema integrado de procesamiento de señal PPG
 * Combina detección avanzada de dedos con captura mejorada de señal
 */
export class EnhancedPPGProcessor {
  private fingerDetector: FingerDetectionEnhancer;
  private signalCapture: SignalCaptureEnhancer;
  
  // Estado del procesamiento
  private isProcessing = false;
  private fingerDetected = false;
  private lastFrameTime = 0;
  private processingStats = {
    totalFrames: 0,
    validFrames: 0,
    fingerDetections: 0,
    signalQualitySum: 0,
    peakDetections: 0,
    falsePositives: 0
  };
  
  // Umbral de calidad mínimo para procesamiento
  private readonly MIN_QUALITY_THRESHOLD = 0.6;
  
  constructor() {
    this.fingerDetector = new FingerDetectionEnhancer();
    this.signalCapture = new SignalCaptureEnhancer();
  }
  
  /**
   * Inicia el procesamiento de señales PPG
   */
  public start(): void {
    this.isProcessing = true;
    this.reset();
  }
  
  /**
   * Detiene el procesamiento y limpia recursos
   */
  public stop(): void {
    this.isProcessing = false;
    this.fingerDetected = false;
  }
  
  /**
   * Reinicia el estado del procesador
   */
  public reset(): void {
    this.fingerDetector.reset();
    this.signalCapture.reset();
    this.fingerDetected = false;
    this.lastFrameTime = 0;
    this.processingStats = {
      totalFrames: 0,
      validFrames: 0,
      fingerDetections: 0,
      signalQualitySum: 0,
      peakDetections: 0,
      falsePositives: 0
    };
  }
  
  /**
   * Procesa un frame de video y retorna resultados mejorados
   */
  public processFrame(frameData: FrameData): {
    fingerDetected: boolean;
    fingerConfidence: number;
    signalQuality: number;
    isPeak: boolean;
    peakConfidence: number;
    enhancedSignal: number;
    signalMetrics: {
      snr: number;
      perfusionIndex: number;
      stability: number;
      noiseLevel: number;
    };
    processingStats: typeof this.processingStats;
    detectionReasons: string[];
  } {
    if (!this.isProcessing) {
      return this.getEmptyResult();
    }
    
    const now = Date.now();
    this.processingStats.totalFrames++;
    
    // 1. Detección mejorada de dedos
    const fingerDetection = this.fingerDetector.detectFinger(
      frameData.redValue,
      frameData.textureScore || 0.5,
      frameData.rToGRatio || 1.0,
      frameData.rToBRatio || 1.0,
      [frameData.redValue], // signal history simplificada
      0 // motionLevel no disponible en FrameData, usar 0 como valor por defecto
    );
    
    // 2. Procesamiento de señal solo si hay dedo detectado
    let signalResult;
    if (fingerDetection.isDetected) {
      signalResult = this.signalCapture.processSignal(frameData.redValue, now);
      this.processingStats.validFrames++;
      this.processingStats.signalQualitySum += signalResult.quality;
      
      if (signalResult.isPeak) {
        this.processingStats.peakDetections++;
      }
    } else {
      // Señal vacía cuando no hay dedo
      signalResult = {
        enhancedSignal: 0,
        quality: 0,
        isPeak: false,
        peakConfidence: 0,
        signalMetrics: {
          snr: 0,
          perfusionIndex: 0,
          stability: 0,
          noiseLevel: 1
        }
      };
    }
    
    // 3. Actualizar estado de detección de dedo
    if (fingerDetection.isDetected && !this.fingerDetected) {
      this.processingStats.fingerDetections++;
    }
    this.fingerDetected = fingerDetection.isDetected;
    
    // 4. Validación final de calidad
    const finalSignalQuality = this.validateFinalQuality(
      fingerDetection.confidence,
      signalResult.quality,
      signalResult.signalMetrics
    );
    
    // 5. Detección de falsos positivos
    if (signalResult.isPeak && !fingerDetection.isDetected) {
      this.processingStats.falsePositives++;
    }
    
    this.lastFrameTime = now;
    
    return {
      fingerDetected: fingerDetection.isDetected,
      fingerConfidence: fingerDetection.confidence,
      signalQuality: finalSignalQuality,
      isPeak: signalResult.isPeak && fingerDetection.isDetected,
      peakConfidence: signalResult.peakConfidence,
      enhancedSignal: signalResult.enhancedSignal,
      signalMetrics: signalResult.signalMetrics,
      processingStats: { ...this.processingStats },
      detectionReasons: this.getDetectionReasons(fingerDetection)
    };
  }
  
  /**
   * Obtiene métricas de rendimiento del sistema
   */
  public getPerformanceMetrics(): {
    fingerDetectionAccuracy: number;
    signalQualityAverage: number;
    peakDetectionRate: number;
    falsePositiveRate: number;
    processingEfficiency: number;
    systemStability: number;
  } {
    const totalFrames = this.processingStats.totalFrames;
    const validFrames = this.processingStats.validFrames;
    
    // Precisión de detección de dedos
    const fingerDetectionAccuracy = totalFrames > 0 ? 
      this.processingStats.fingerDetections / totalFrames : 0;
    
    // Calidad promedio de señal
    const signalQualityAverage = validFrames > 0 ? 
      this.processingStats.signalQualitySum / validFrames : 0;
    
    // Tasa de detección de picos
    const peakDetectionRate = validFrames > 0 ? 
      this.processingStats.peakDetections / validFrames : 0;
    
    // Tasa de falsos positivos
    const falsePositiveRate = totalFrames > 0 ? 
      this.processingStats.falsePositives / totalFrames : 0;
    
    // Eficiencia de procesamiento
    const processingEfficiency = totalFrames > 0 ? 
      validFrames / totalFrames : 0;
    
    // Obtener métricas adicionales de los componentes
    const signalCaptureMetrics = this.signalCapture.getPerformanceMetrics();
    const systemStability = signalCaptureMetrics.signalStability;
    
    return {
      fingerDetectionAccuracy: Math.min(1, fingerDetectionAccuracy),
      signalQualityAverage: Math.min(1, signalQualityAverage),
      peakDetectionRate: Math.min(1, peakDetectionRate),
      falsePositiveRate: Math.min(1, falsePositiveRate),
      processingEfficiency: Math.min(1, processingEfficiency),
      systemStability: Math.min(1, systemStability)
    };
  }
  
  /**
   * Retorna un resultado vacío cuando no está procesando
   */
  private getEmptyResult() {
    return {
      fingerDetected: false,
      fingerConfidence: 0,
      signalQuality: 0,
      isPeak: false,
      peakConfidence: 0,
      enhancedSignal: 0,
      signalMetrics: {
        snr: 0,
        perfusionIndex: 0,
        stability: 0,
        noiseLevel: 1
      },
      processingStats: { ...this.processingStats },
      detectionReasons: []
    };
  }
  
  /**
   * Valida la calidad final combinando múltiples factores
   */
  private validateFinalQuality(
    fingerConfidence: number,
    signalQuality: number,
    signalMetrics: {
      snr: number;
      perfusionIndex: number;
      stability: number;
      noiseLevel: number;
    }
  ): number {
    // Ponderación de factores para calidad final
    const weights = {
      fingerConfidence: 0.4,
      signalQuality: 0.3,
      snr: 0.15,
      stability: 0.1,
      noiseLevel: 0.05 // Inverso: menor ruido = mejor calidad
    };
    
    const finalQuality = 
      (fingerConfidence * weights.fingerConfidence) +
      (signalQuality * weights.signalQuality) +
      (signalMetrics.snr * weights.snr) +
      (signalMetrics.stability * weights.stability) +
      ((1 - signalMetrics.noiseLevel) * weights.noiseLevel);
    
    return Math.max(0, Math.min(1, finalQuality));
  }
  
  /**
   * Verifica si el sistema está listo para mediciones
   */
  public isReadyForMeasurement(): boolean {
    const metrics = this.getPerformanceMetrics();
    
    return (
      metrics.fingerDetectionAccuracy > 0.8 &&
      metrics.signalQualityAverage > this.MIN_QUALITY_THRESHOLD &&
      metrics.processingEfficiency > 0.7 &&
      metrics.falsePositiveRate < 0.1 &&
      metrics.systemStability > 0.7
    );
  }
  
  /**
   * Obtiene estadísticas de procesamiento
   */
  public getProcessingStats(): typeof this.processingStats {
    return { ...this.processingStats };
  }
  
  /**
   * Verifica si actualmente hay un dedo detectado
   */
  public hasFingerDetected(): boolean {
    return this.fingerDetected;
  }
  
  /**
   * Obtiene razones de detección para logging y análisis
   */
  private getDetectionReasons(fingerDetection: any): string[] {
    const reasons: string[] = [];
    
    if (fingerDetection.isDetected) {
      if (fingerDetection.confidence > 0.8) {
        reasons.push('ALTA_CONFIANZA');
      } else {
        reasons.push('CONFIANZA_MODERADA');
      }
      
      if (fingerDetection.detectorScores?.color > 0.7) {
        reasons.push('COLOR_VALIDO');
      }
      
      if (fingerDetection.detectorScores?.texture > 0.6) {
        reasons.push('TEXTURA_ADECUADA');
      }
      
      if (fingerDetection.detectorScores?.stability > 0.5) {
        reasons.push('SEÑAL_ESTABLE');
      }
    } else {
      reasons.push('NO_DETECTADO');
      
      if (fingerDetection.detectorScores?.color < 0.3) {
        reasons.push('COLOR_INVALIDO');
      }
      
      if (fingerDetection.detectorScores?.texture < 0.3) {
        reasons.push('TEXTURA_INADECUADA');
      }
    }
    
    return reasons;
  }
}
