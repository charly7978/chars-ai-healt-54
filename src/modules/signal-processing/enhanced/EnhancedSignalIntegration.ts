import { EnhancedPPGProcessor } from './EnhancedPPGProcessor';
import { FrameData } from '../types';
import { ProcessedSignal } from '../../../types/signal';

/**
 * Enhanced Signal Integration - Sistema completo de integración de señales mejoradas
 * Coordina todos los componentes mejorados y proporciona una interfaz unificada
 */
export class EnhancedSignalIntegration {
  private enhancedProcessor: EnhancedPPGProcessor;
  
  // Observables para comunicación con componentes externos (simplificado sin RxJS)
  private signalCallbacks: ((signal: ProcessedSignal) => void)[] = [];
  private qualityCallbacks: ((quality: {
    overallQuality: number;
    fingerConfidence: number;
    signalQuality: number;
    metrics: {
      snr: number;
      perfusionIndex: number;
      stability: number;
      noiseLevel: number;
    };
  }) => void)[] = [];
  private performanceCallbacks: ((performance: {
    fingerDetectionAccuracy: number;
    signalQualityAverage: number;
    peakDetectionRate: number;
    falsePositiveRate: number;
    processingEfficiency: number;
    systemStability: number;
  }) => void)[] = [];
  
  // Estado del sistema
  private isRunning = false;
  private lastProcessedTime = 0;
  private signalBuffer: number[] = [];
  private readonly BUFFER_SIZE = 100;
  
  constructor() {
    this.enhancedProcessor = new EnhancedPPGProcessor();
  }
  
  /**
   * Inicia el sistema de procesamiento mejorado
   */
  public start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.enhancedProcessor.start();
    this.signalBuffer = [];
    this.lastProcessedTime = 0;
    
    console.log('✅ Enhanced Signal Integration iniciado');
  }
  
  /**
   * Detiene el sistema y limpia recursos
   */
  public stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    this.enhancedProcessor.stop();
    
    // Limpiar callbacks
    this.signalCallbacks = [];
    this.qualityCallbacks = [];
    this.performanceCallbacks = [];
    
    console.log('🛑 Enhanced Signal Integration detenido');
  }
  
  /**
   * Procesa un frame de video con el sistema mejorado completo
   */
  public processFrame(frameData: FrameData): ProcessedSignal | null {
    if (!this.isRunning) return null;
    
    try {
      // 1. Procesamiento con el sistema mejorado
      const enhancedResult = this.enhancedProcessor.processFrame(frameData);
      
      // 2. Actualizar buffer de señal
      this.updateSignalBuffer(enhancedResult.enhancedSignal);
      
      // 3. Crear señal procesada final
      const processedSignal: ProcessedSignal = {
        timestamp: Date.now(),
        rawValue: frameData.redValue,
        filteredValue: enhancedResult.enhancedSignal,
        quality: enhancedResult.signalQuality,
        fingerDetected: enhancedResult.fingerDetected,
        roi: { x: 0, y: 0, width: 0, height: 0 }, // Valor por defecto
        perfusionIndex: enhancedResult.signalMetrics.perfusionIndex,
        signalStrength: this.calculateSignalStrength(),
        noiseLevel: enhancedResult.signalMetrics.noiseLevel,
        // Propiedades adicionales del sistema mejorado
        enhancedMetrics: {
          fingerConfidence: enhancedResult.fingerConfidence,
          peakConfidence: enhancedResult.peakConfidence,
          snrValue: enhancedResult.signalMetrics.snr,
          stability: enhancedResult.signalMetrics.stability,
          detectionReasons: enhancedResult.detectionReasons
        }
      };
      
      // 4. Emitir resultados a los callbacks
      this.emitSignal(processedSignal);
      this.emitQuality({
        overallQuality: enhancedResult.signalQuality,
        fingerConfidence: enhancedResult.fingerConfidence,
        signalQuality: enhancedResult.signalQuality,
        metrics: enhancedResult.signalMetrics
      });
      
      // 5. Emitir métricas de rendimiento periódicamente
      if (Date.now() - this.lastProcessedTime > 5000) { // Cada 5 segundos
        const performanceMetrics = this.enhancedProcessor.getPerformanceMetrics();
        this.emitPerformance(performanceMetrics);
        this.lastProcessedTime = Date.now();
      }
      
      return processedSignal;
      
    } catch (error) {
      console.error('❌ Error en Enhanced Signal Integration:', error);
      return null;
    }
  }
  
  /**
   * Métodos para suscripción a eventos (alternativa a RxJS)
   */
  public onSignal(callback: (signal: ProcessedSignal) => void): void {
    this.signalCallbacks.push(callback);
  }
  
  public onQuality(callback: (quality: {
    overallQuality: number;
    fingerConfidence: number;
    signalQuality: number;
    metrics: {
      snr: number;
      perfusionIndex: number;
      stability: number;
      noiseLevel: number;
    };
  }) => void): void {
    this.qualityCallbacks.push(callback);
  }
  
  public onPerformance(callback: (performance: {
    fingerDetectionAccuracy: number;
    signalQualityAverage: number;
    peakDetectionRate: number;
    falsePositiveRate: number;
    processingEfficiency: number;
    systemStability: number;
  }) => void): void {
    this.performanceCallbacks.push(callback);
  }
  
  /**
   * Métodos para cancelar suscripción
   */
  public offSignal(callback: (signal: ProcessedSignal) => void): void {
    const index = this.signalCallbacks.indexOf(callback);
    if (index > -1) {
      this.signalCallbacks.splice(index, 1);
    }
  }
  
  public offQuality(callback: (quality: any) => void): void {
    const index = this.qualityCallbacks.indexOf(callback);
    if (index > -1) {
      this.qualityCallbacks.splice(index, 1);
    }
  }
  
  public offPerformance(callback: (performance: any) => void): void {
    const index = this.performanceCallbacks.indexOf(callback);
    if (index > -1) {
      this.performanceCallbacks.splice(index, 1);
    }
  }
  
  /**
   * Métodos privados para emitir eventos
   */
  private emitSignal(signal: ProcessedSignal): void {
    this.signalCallbacks.forEach(callback => {
      try {
        callback(signal);
      } catch (error) {
        console.error('Error en signal callback:', error);
      }
    });
  }
  
  private emitQuality(quality: {
    overallQuality: number;
    fingerConfidence: number;
    signalQuality: number;
    metrics: {
      snr: number;
      perfusionIndex: number;
      stability: number;
      noiseLevel: number;
    };
  }): void {
    this.qualityCallbacks.forEach(callback => {
      try {
        callback(quality);
      } catch (error) {
        console.error('Error en quality callback:', error);
      }
    });
  }
  
  private emitPerformance(performance: {
    fingerDetectionAccuracy: number;
    signalQualityAverage: number;
    peakDetectionRate: number;
    falsePositiveRate: number;
    processingEfficiency: number;
    systemStability: number;
  }): void {
    this.performanceCallbacks.forEach(callback => {
      try {
        callback(performance);
      } catch (error) {
        console.error('Error en performance callback:', error);
      }
    });
  }
  
  /**
   * Obtiene el estado actual del sistema
   */
  public getSystemStatus(): {
    isRunning: boolean;
    hasFingerDetected: boolean;
    isReadyForMeasurement: boolean;
    performanceMetrics: ReturnType<EnhancedPPGProcessor['getPerformanceMetrics']>;
    processingStats: ReturnType<EnhancedPPGProcessor['getProcessingStats']>;
    bufferStatus: {
      currentSize: number;
      bufferSize: number;
      utilization: number;
    };
  } {
    return {
      isRunning: this.isRunning,
      hasFingerDetected: this.enhancedProcessor.hasFingerDetected(),
      isReadyForMeasurement: this.enhancedProcessor.isReadyForMeasurement(),
      performanceMetrics: this.enhancedProcessor.getPerformanceMetrics(),
      processingStats: this.enhancedProcessor.getProcessingStats(),
      bufferStatus: {
        currentSize: this.signalBuffer.length,
        bufferSize: this.BUFFER_SIZE,
        utilization: this.signalBuffer.length / this.BUFFER_SIZE
      }
    };
  }
  
  /**
   * Reinicia el sistema completo
   */
  public reset(): void {
    this.enhancedProcessor.reset();
    this.signalBuffer = [];
    this.lastProcessedTime = 0;
    
    console.log('🔄 Enhanced Signal Integration reiniciado');
  }
  
  /**
   * Actualiza el buffer de señal con el nuevo valor
   */
  private updateSignalBuffer(signalValue: number): void {
    this.signalBuffer.push(signalValue);
    
    // Mantener tamaño del buffer
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
  }
  
  /**
   * Calcula la fuerza de la señal basada en el buffer
   */
  private calculateSignalStrength(): number {
    if (this.signalBuffer.length === 0) return 0;
    
    const mean = this.signalBuffer.reduce((sum, val) => sum + val, 0) / this.signalBuffer.length;
    const std = Math.sqrt(
      this.signalBuffer.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / this.signalBuffer.length
    );
    
    // Normalizar a 0-1
    return Math.min(1, Math.max(0, (mean + std) / 255));
  }
  
  /**
   * Obtiene estadísticas del buffer de señal
   */
  public getBufferStats(): {
    mean: number;
    std: number;
    min: number;
    max: number;
    range: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  } {
    if (this.signalBuffer.length < 2) {
      return {
        mean:
