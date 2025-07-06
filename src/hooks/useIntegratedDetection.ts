/**
 * Hook avanzado para detección integrada de dedo y latidos
 * Basado en algoritmos médicos reales de PPG sin simulaciones
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { IntegratedDetectionSystem, IntegratedDetectionResult } from '../modules/signal-processing/IntegratedDetectionSystem';

export interface UseIntegratedDetectionConfig {
  enabled: boolean;
  fingerDetection: {
    enabled: boolean;
    minPulsatilityThreshold: number;
    maxPulsatilityThreshold: number;
    minSignalAmplitude: number;
    maxSignalAmplitude: number;
    spectralAnalysisWindow: number;
    motionArtifactThreshold: number;
    skinToneValidation: boolean;
    perfusionIndexThreshold: number;
    confidenceThreshold: number;
  };
  heartbeatDetection: {
    enabled: boolean;
    samplingRate: number;
    minHeartRate: number;
    maxHeartRate: number;
    spectralAnalysisWindow: number;
    peakDetectionSensitivity: number;
    motionArtifactThreshold: number;
    signalQualityThreshold: number;
    confidenceThreshold: number;
    adaptiveFiltering: boolean;
    spectralValidation: boolean;
  };
  fusion: {
    enabled: boolean;
    method: 'weighted' | 'voting' | 'ensemble';
    fingerWeight: number;
    heartbeatWeight: number;
    minCombinedConfidence: number;
  };
}

export interface UseIntegratedDetectionResult {
  // Estado de detección
  isFingerDetected: boolean;
  isHeartbeatDetected: boolean;
  isMonitoringValid: boolean;
  
  // Métricas principales
  heartRate: number;
  confidence: number;
  signalQuality: number;
  motionArtifactLevel: number;
  
  // Métricas avanzadas
  pulsatilityIndex: number;
  perfusionIndex: number;
  signalToNoiseRatio: number;
  spectralEntropy: number;
  
  // Validación biofísica
  bioPhysicalValidation: {
    isValidFingerPosition: boolean;
    isValidHeartRate: boolean;
    isValidSignalQuality: boolean;
    isValidMotionLevel: boolean;
    isValidSpectralProfile: boolean;
  };
  
  // Información de procesamiento
  processingInfo: {
    algorithmsUsed: string[];
    fusionMethod: string;
    processingLatency: number;
    timestamp: number;
  };
  
  // Estadísticas del sistema
  systemStats: {
    totalSamples: number;
    validMonitoringRate: number;
    averageConfidence: number;
    averageSignalQuality: number;
    averageProcessingLatency: number;
  };
  
  // Funciones
  processSample: (red: number, green: number, blue: number) => void;
  reset: () => void;
  updateConfig: (config: Partial<UseIntegratedDetectionConfig>) => void;
}

export const useIntegratedDetection = (
  initialConfig?: Partial<UseIntegratedDetectionConfig>
): UseIntegratedDetectionResult => {
  // Configuración por defecto
  const defaultConfig: UseIntegratedDetectionConfig = {
    enabled: true,
    fingerDetection: {
      enabled: true,
      minPulsatilityThreshold: 0.15,
      maxPulsatilityThreshold: 0.85,
      minSignalAmplitude: 0.05,
      maxSignalAmplitude: 0.95,
      spectralAnalysisWindow: 300,
      motionArtifactThreshold: 0.3,
      skinToneValidation: true,
      perfusionIndexThreshold: 0.2,
      confidenceThreshold: 0.7
    },
    heartbeatDetection: {
      enabled: true,
      samplingRate: 60,
      minHeartRate: 30,
      maxHeartRate: 220,
      spectralAnalysisWindow: 300,
      peakDetectionSensitivity: 0.6,
      motionArtifactThreshold: 0.3,
      signalQualityThreshold: 0.5,
      confidenceThreshold: 0.7,
      adaptiveFiltering: true,
      spectralValidation: true
    },
    fusion: {
      enabled: true,
      method: 'weighted',
      fingerWeight: 0.4,
      heartbeatWeight: 0.6,
      minCombinedConfidence: 0.75
    }
  };

  const [config, setConfig] = useState<UseIntegratedDetectionConfig>({
    ...defaultConfig,
    ...initialConfig
  });

  // Estado de detección
  const [isFingerDetected, setIsFingerDetected] = useState(false);
  const [isHeartbeatDetected, setIsHeartbeatDetected] = useState(false);
  const [isMonitoringValid, setIsMonitoringValid] = useState(false);
  
  // Métricas principales
  const [heartRate, setHeartRate] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [signalQuality, setSignalQuality] = useState(0);
  const [motionArtifactLevel, setMotionArtifactLevel] = useState(0);
  
  // Métricas avanzadas
  const [pulsatilityIndex, setPulsatilityIndex] = useState(0);
  const [perfusionIndex, setPerfusionIndex] = useState(0);
  const [signalToNoiseRatio, setSignalToNoiseRatio] = useState(0);
  const [spectralEntropy, setSpectralEntropy] = useState(0);
  
  // Validación biofísica
  const [bioPhysicalValidation, setBioPhysicalValidation] = useState({
    isValidFingerPosition: false,
    isValidHeartRate: false,
    isValidSignalQuality: false,
    isValidMotionLevel: false,
    isValidSpectralProfile: false
  });
  
  // Información de procesamiento
  const [processingInfo, setProcessingInfo] = useState({
    algorithmsUsed: [],
    fusionMethod: 'weighted',
    processingLatency: 0,
    timestamp: 0
  });
  
  // Estadísticas del sistema
  const [systemStats, setSystemStats] = useState({
    totalSamples: 0,
    validMonitoringRate: 0,
    averageConfidence: 0,
    averageSignalQuality: 0,
    averageProcessingLatency: 0
  });

  // Referencias
  const detectionSystemRef = useRef<IntegratedDetectionSystem | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  const updateIntervalRef = useRef<number>(1000 / 30); // 30 FPS

  // Inicializar sistema de detección
  useEffect(() => {
    if (config.enabled) {
      detectionSystemRef.current = new IntegratedDetectionSystem({
        fingerDetection: config.fingerDetection,
        heartbeatDetection: config.heartbeatDetection,
        fusion: config.fusion
      });
      
      console.log('IntegratedDetectionSystem: Sistema inicializado con configuración avanzada');
    }
    
    return () => {
      if (detectionSystemRef.current) {
        detectionSystemRef.current.reset();
        detectionSystemRef.current = null;
      }
    };
  }, [config]);

  // Función para procesar muestra
  const processSample = useCallback((red: number, green: number, blue: number) => {
    if (!config.enabled || !detectionSystemRef.current) {
      return;
    }

    const currentTime = Date.now();
    
    // Control de frecuencia de actualización
    if (currentTime - lastUpdateTimeRef.current < updateIntervalRef.current) {
      return;
    }
    
    lastUpdateTimeRef.current = currentTime;

    try {
      // Procesar muestra con sistema integrado
      const result = detectionSystemRef.current.processSample(red, green, blue, currentTime);
      
      if (result) {
        // Actualizar estado de detección
        setIsFingerDetected(result.fingerDetection.isFingerDetected);
        setIsHeartbeatDetected(result.heartbeatDetection.isHeartbeatDetected);
        setIsMonitoringValid(result.isMonitoringValid);
        
        // Actualizar métricas principales
        setHeartRate(result.heartbeatDetection.heartRate);
        setConfidence(result.combinedConfidence);
        setSignalQuality(result.overallSignalQuality);
        setMotionArtifactLevel(result.motionArtifactLevel);
        
        // Actualizar métricas avanzadas
        setPulsatilityIndex(result.combinedMetrics.pulsatilityIndex);
        setPerfusionIndex(result.combinedMetrics.perfusionIndex);
        setSignalToNoiseRatio(result.combinedMetrics.signalToNoiseRatio);
        setSpectralEntropy(result.combinedMetrics.spectralEntropy);
        
        // Actualizar validación biofísica
        setBioPhysicalValidation(result.bioPhysicalValidation);
        
        // Actualizar información de procesamiento
        setProcessingInfo(result.processingInfo);
        
        // Actualizar estadísticas del sistema
        const stats = detectionSystemRef.current.getSystemStats();
        setSystemStats({
          totalSamples: stats.totalSamples,
          validMonitoringRate: stats.validMonitoringRate,
          averageConfidence: stats.averageConfidence,
          averageSignalQuality: stats.averageSignalQuality,
          averageProcessingLatency: stats.averageProcessingLatency
        });
        
        // Log de resultados si es necesario
        if (process.env.NODE_ENV !== 'production' && result.isMonitoringValid) {
          console.log('IntegratedDetection: Monitoreo válido detectado', {
            heartRate: result.heartbeatDetection.heartRate.toFixed(1),
            confidence: (result.combinedConfidence * 100).toFixed(1) + '%',
            signalQuality: (result.overallSignalQuality * 100).toFixed(1) + '%',
            algorithmsUsed: result.processingInfo.algorithmsUsed,
            processingLatency: result.processingInfo.processingLatency.toFixed(2) + 'ms'
          });
        }
      }
    } catch (error) {
      console.error('IntegratedDetection: Error procesando muestra', error);
    }
  }, [config.enabled]);

  // Función para reset
  const reset = useCallback(() => {
    if (detectionSystemRef.current) {
      detectionSystemRef.current.reset();
    }
    
    // Resetear estado
    setIsFingerDetected(false);
    setIsHeartbeatDetected(false);
    setIsMonitoringValid(false);
    setHeartRate(0);
    setConfidence(0);
    setSignalQuality(0);
    setMotionArtifactLevel(0);
    setPulsatilityIndex(0);
    setPerfusionIndex(0);
    setSignalToNoiseRatio(0);
    setSpectralEntropy(0);
    setBioPhysicalValidation({
      isValidFingerPosition: false,
      isValidHeartRate: false,
      isValidSignalQuality: false,
      isValidMotionLevel: false,
      isValidSpectralProfile: false
    });
    setProcessingInfo({
      algorithmsUsed: [],
      fusionMethod: 'weighted',
      processingLatency: 0,
      timestamp: 0
    });
    setSystemStats({
      totalSamples: 0,
      validMonitoringRate: 0,
      averageConfidence: 0,
      averageSignalQuality: 0,
      averageProcessingLatency: 0
    });
    
    console.log('IntegratedDetection: Sistema reseteado');
  }, []);

  // Función para actualizar configuración
  const updateConfig = useCallback((newConfig: Partial<UseIntegratedDetectionConfig>) => {
    setConfig(prevConfig => {
      const updatedConfig = { ...prevConfig, ...newConfig };
      
      // Actualizar configuración del sistema si está inicializado
      if (detectionSystemRef.current) {
        detectionSystemRef.current.updateConfig({
          fingerDetection: updatedConfig.fingerDetection,
          heartbeatDetection: updatedConfig.heartbeatDetection,
          fusion: updatedConfig.fusion
        });
      }
      
      console.log('IntegratedDetection: Configuración actualizada', newConfig);
      return updatedConfig;
    });
  }, []);

  // Efecto para limpiar al desmontar
  useEffect(() => {
    return () => {
      if (detectionSystemRef.current) {
        detectionSystemRef.current.reset();
      }
    };
  }, []);

  return {
    // Estado de detección
    isFingerDetected,
    isHeartbeatDetected,
    isMonitoringValid,
    
    // Métricas principales
    heartRate,
    confidence,
    signalQuality,
    motionArtifactLevel,
    
    // Métricas avanzadas
    pulsatilityIndex,
    perfusionIndex,
    signalToNoiseRatio,
    spectralEntropy,
    
    // Validación biofísica
    bioPhysicalValidation,
    
    // Información de procesamiento
    processingInfo,
    
    // Estadísticas del sistema
    systemStats,
    
    // Funciones
    processSample,
    reset,
    updateConfig
  };
}; 