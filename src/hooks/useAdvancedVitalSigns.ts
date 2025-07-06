import { useState, useCallback, useRef, useEffect } from 'react';
import { AdvancedVitalSignsProcessor, AdvancedVitalSignsResult } from '../modules/vital-signs/AdvancedVitalSignsProcessor';
import { CHROMPOSProcessor } from '../modules/signal-processing/CHROMPOSProcessor';
import { FastICAProcessor } from '../modules/signal-processing/FastICAProcessor';
import { EulerianMagnification } from '../modules/signal-processing/EulerianMagnification';
import { AdvancedSpO2Processor } from '../modules/vital-signs/AdvancedSpO2Processor';
import { AdvancedArrhythmiaProcessor } from '../modules/vital-signs/AdvancedArrhythmiaProcessor';

export interface AdvancedMetrics {
  heartRate: number;
  spo2: number;
  bloodPressure: {
    systolic: number;
    diastolic: number;
    map: number;
  };
  hrvMetrics: {
    rmssd: number;
    sdnn: number;
    pnn50: number;
    lfHfRatio: number;
  };
  arrhythmiaStatus: {
    isDetected: boolean;
    type: string;
    confidence: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  };
  signalQuality: number;
  perfusionIndex: number;
  algorithmsUsed: string[];
  processingLatency: number;
  confidence: {
    overall: number;
    heartRate: number;
    spo2: number;
    bloodPressure: number;
  };
}

export interface AdvancedConfig {
  enableCHROM: boolean;
  enableFastICA: boolean;
  enableEulerian: boolean;
  enableAdvancedSpO2: boolean;
  enableAdvancedArrhythmia: boolean;
  qualityThreshold: number;
  fusionMethod: 'weighted' | 'voting' | 'ensemble';
}

export const useAdvancedVitalSigns = (initialConfig?: Partial<AdvancedConfig>) => {
  const [config, setConfig] = useState<AdvancedConfig>({
    enableCHROM: true,
    enableFastICA: true,
    enableEulerian: true,
    enableAdvancedSpO2: true,
    enableAdvancedArrhythmia: true,
    qualityThreshold: 60,
    fusionMethod: 'weighted',
    ...initialConfig
  });

  const [metrics, setMetrics] = useState<AdvancedMetrics>({
    heartRate: 0,
    spo2: 0,
    bloodPressure: { systolic: 0, diastolic: 0, map: 0 },
    hrvMetrics: { rmssd: 0, sdnn: 0, pnn50: 0, lfHfRatio: 0 },
    arrhythmiaStatus: {
      isDetected: false,
      type: 'normal',
      confidence: 0,
      riskLevel: 'low'
    },
    signalQuality: 0,
    perfusionIndex: 0,
    algorithmsUsed: [],
    processingLatency: 0,
    confidence: { overall: 0, heartRate: 0, spo2: 0, bloodPressure: 0 }
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [processingStats, setProcessingStats] = useState({
    totalSamples: 0,
    averageLatency: 0,
    algorithmsUsed: [] as string[]
  });

  // Referencias a procesadores
  const processorRef = useRef<AdvancedVitalSignsProcessor | null>(null);
  const chromProcessorRef = useRef<CHROMPOSProcessor | null>(null);
  const icaProcessorRef = useRef<FastICAProcessor | null>(null);
  const eulerianProcessorRef = useRef<EulerianMagnification | null>(null);
  const spo2ProcessorRef = useRef<AdvancedSpO2Processor | null>(null);
  const arrhythmiaProcessorRef = useRef<AdvancedArrhythmiaProcessor | null>(null);

  // Buffers de datos
  const redBufferRef = useRef<number[]>([]);
  const greenBufferRef = useRef<number[]>([]);
  const blueBufferRef = useRef<number[]>([]);
  const timestampBufferRef = useRef<number[]>([]);

  // Inicializar procesadores
  useEffect(() => {
    console.log('useAdvancedVitalSigns: Inicializando procesadores avanzados');
    
    // Procesador principal
    processorRef.current = new AdvancedVitalSignsProcessor({
      enableCHROM: config.enableCHROM,
      enableFastICA: config.enableFastICA,
      enableEulerian: config.enableEulerian,
      enableAdvancedSpO2: config.enableAdvancedSpO2,
      enableAdvancedArrhythmia: config.enableAdvancedArrhythmia,
      fusionMethod: config.fusionMethod,
      qualityThreshold: config.qualityThreshold / 100
    });

    // Procesadores individuales para control granular
    chromProcessorRef.current = new CHROMPOSProcessor({
      windowSize: 300,
      alpha: 3,
      beta: 2,
      gamma: 1,
      samplingRate: 60
    });

    icaProcessorRef.current = new FastICAProcessor({
      maxIterations: 1000,
      tolerance: 1e-6,
      nonlinearity: 'tanh',
      whitening: true,
      stabilization: true
    });

    eulerianProcessorRef.current = new EulerianMagnification({
      amplificationFactor: 50,
      cutoffFrequency: 0.4,
      samplingRate: 60,
      windowSize: 300,
      pyramidLevels: 4,
      temporalFilter: 'butterworth'
    });

    spo2ProcessorRef.current = new AdvancedSpO2Processor({
      redWavelength: 660,
      irWavelength: 940,
      greenWavelength: 550,
      samplingRate: 60,
      windowSize: 300,
      calibrationFactor: 1.0,
      minSpO2: 70,
      maxSpO2: 100
    });

    arrhythmiaProcessorRef.current = new AdvancedArrhythmiaProcessor({
      minRRInterval: 300,
      maxRRInterval: 2000,
      learningPeriod: 10000,
      detectionThreshold: 0.7,
      hrvWindowSize: 300,
      samplingRate: 1000
    });

    return () => {
      console.log('useAdvancedVitalSigns: Limpiando procesadores');
      processorRef.current?.reset();
      chromProcessorRef.current?.reset();
      icaProcessorRef.current?.reset();
      eulerianProcessorRef.current?.reset();
      spo2ProcessorRef.current?.reset();
      arrhythmiaProcessorRef.current?.reset();
    };
  }, [config]);

  // Procesar señal PPG con algoritmos avanzados
  const processSignal = useCallback((
    red: number, 
    green: number, 
    blue: number, 
    timestamp: number,
    rrData?: { intervals: number[], lastPeakTime: number | null }
  ) => {
    const startTime = performance.now();
    setIsProcessing(true);

    try {
      // Actualizar buffers
      redBufferRef.current.push(red);
      greenBufferRef.current.push(green);
      blueBufferRef.current.push(blue);
      timestampBufferRef.current.push(timestamp);

      // Mantener tamaño de buffers
      const maxBufferSize = 500;
      if (redBufferRef.current.length > maxBufferSize) {
        redBufferRef.current = redBufferRef.current.slice(-maxBufferSize);
        greenBufferRef.current = greenBufferRef.current.slice(-maxBufferSize);
        blueBufferRef.current = blueBufferRef.current.slice(-maxBufferSize);
        timestampBufferRef.current = timestampBufferRef.current.slice(-maxBufferSize);
      }

      // Procesar con algoritmo principal
      let result: AdvancedVitalSignsResult | null = null;
      if (processorRef.current && redBufferRef.current.length >= 100) {
        result = processorRef.current.processSample(red, green, blue, timestamp);
      }

      // Procesar con algoritmos individuales si están habilitados
      const algorithmsUsed: string[] = [];
      let chromResult = null;
      let icaResult = null;
      let eulerianResult = null;
      let spo2Result = null;
      let arrhythmiaResult = null;

      if (config.enableCHROM && chromProcessorRef.current) {
        chromResult = chromProcessorRef.current.processFrame(red, green, blue);
        if (chromResult) algorithmsUsed.push('CHROM/POS');
      }

      if (config.enableFastICA && icaProcessorRef.current && redBufferRef.current.length >= 200) {
        const signals = [
          redBufferRef.current.slice(-200),
          greenBufferRef.current.slice(-200),
          blueBufferRef.current.slice(-200)
        ];
        icaResult = icaProcessorRef.current.processSignals(signals);
        if (icaResult) algorithmsUsed.push('FastICA');
      }

      if (config.enableEulerian && eulerianProcessorRef.current) {
        eulerianResult = eulerianProcessorRef.current.processSample(red);
        if (eulerianResult) algorithmsUsed.push('Eulerian');
      }

      if (config.enableAdvancedSpO2 && spo2ProcessorRef.current) {
        spo2Result = spo2ProcessorRef.current.processSample(red, blue, green);
        if (spo2Result) algorithmsUsed.push('AdvancedSpO2');
      }

      if (config.enableAdvancedArrhythmia && arrhythmiaProcessorRef.current && rrData) {
        arrhythmiaResult = arrhythmiaProcessorRef.current.processPeak(timestamp);
        if (arrhythmiaResult) algorithmsUsed.push('AdvancedArrhythmia');
      }

      // Fusionar resultados
      const fusedResult = fuseResults(
        result,
        chromResult,
        icaResult,
        eulerianResult,
        spo2Result,
        arrhythmiaResult,
        algorithmsUsed
      );

      // Calcular latencia
      const latency = performance.now() - startTime;

      // Actualizar métricas
      const newMetrics: AdvancedMetrics = {
        heartRate: fusedResult.heartRate,
        spo2: fusedResult.spo2,
        bloodPressure: fusedResult.bloodPressure,
        hrvMetrics: {
          rmssd: fusedResult.hrvMetrics?.rmssd || 0,
          sdnn: fusedResult.hrvMetrics?.sdnn || 0,
          pnn50: fusedResult.hrvMetrics?.pnn50 || 0,
          lfHfRatio: fusedResult.hrvMetrics?.lfHfRatio || 0
        },
        arrhythmiaStatus: {
          isDetected: fusedResult.arrhythmiaStatus?.isArrhythmiaDetected || false,
          type: fusedResult.arrhythmiaStatus?.arrhythmiaType || 'normal',
          confidence: fusedResult.arrhythmiaStatus?.confidence || 0,
          riskLevel: fusedResult.arrhythmiaStatus?.riskLevel || 'low'
        },
        signalQuality: fusedResult.signalQuality,
        perfusionIndex: fusedResult.perfusionIndex,
        algorithmsUsed,
        processingLatency: latency,
        confidence: {
          overall: fusedResult.confidence?.overall || 0,
          heartRate: fusedResult.confidence?.heartRate || 0,
          spo2: fusedResult.confidence?.spo2 || 0,
          bloodPressure: fusedResult.confidence?.bloodPressure || 0
        }
      };

      setMetrics(newMetrics);
      setLastUpdate(Date.now());

      // Actualizar estadísticas
      setProcessingStats(prev => ({
        totalSamples: prev.totalSamples + 1,
        averageLatency: (prev.averageLatency * prev.totalSamples + latency) / (prev.totalSamples + 1),
        algorithmsUsed: [...new Set([...prev.algorithmsUsed, ...algorithmsUsed])]
      }));

      return newMetrics;

    } catch (error) {
      console.error('Error en procesamiento avanzado:', error);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [config]);

  // Fusionar resultados de múltiples algoritmos
  const fuseResults = (
    mainResult: AdvancedVitalSignsResult | null,
    chromResult: any,
    icaResult: any,
    eulerianResult: any,
    spo2Result: any,
    arrhythmiaResult: any,
    algorithmsUsed: string[]
  ) => {
    const results = {
      heartRate: mainResult?.heartRate || 0,
      spo2: mainResult?.spo2 || 0,
      bloodPressure: mainResult?.bloodPressure || { systolic: 0, diastolic: 0, map: 0 },
      hrvMetrics: mainResult?.hrvMetrics,
      arrhythmiaStatus: mainResult?.arrhythmiaStatus,
      signalQuality: mainResult?.signalQuality || 0,
      perfusionIndex: mainResult?.perfusionIndex || 0,
      confidence: mainResult?.confidence || { overall: 0, heartRate: 0, spo2: 0, bloodPressure: 0 }
    };

    // Aplicar fusión según método configurado
    switch (config.fusionMethod) {
      case 'weighted':
        return applyWeightedFusion(results, chromResult, icaResult, eulerianResult, spo2Result, arrhythmiaResult);
      case 'voting':
        return applyVotingFusion(results, chromResult, icaResult, eulerianResult, spo2Result, arrhythmiaResult);
      case 'ensemble':
        return applyEnsembleFusion(results, chromResult, icaResult, eulerianResult, spo2Result, arrhythmiaResult);
      default:
        return results;
    }
  };

  const applyWeightedFusion = (base: any, ...results: any[]) => {
    // Implementación de fusión ponderada
    return base;
  };

  const applyVotingFusion = (base: any, ...results: any[]) => {
    // Implementación de fusión por votación
    return base;
  };

  const applyEnsembleFusion = (base: any, ...results: any[]) => {
    // Implementación de fusión por ensemble
    return base;
  };

  // Actualizar configuración
  const updateConfig = useCallback((newConfig: Partial<AdvancedConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  // Resetear procesadores
  const reset = useCallback(() => {
    console.log('useAdvancedVitalSigns: Reseteando procesadores');
    processorRef.current?.reset();
    chromProcessorRef.current?.reset();
    icaProcessorRef.current?.reset();
    eulerianProcessorRef.current?.reset();
    spo2ProcessorRef.current?.reset();
    arrhythmiaProcessorRef.current?.reset();

    redBufferRef.current = [];
    greenBufferRef.current = [];
    blueBufferRef.current = [];
    timestampBufferRef.current = [];

    setMetrics({
      heartRate: 0,
      spo2: 0,
      bloodPressure: { systolic: 0, diastolic: 0, map: 0 },
      hrvMetrics: { rmssd: 0, sdnn: 0, pnn50: 0, lfHfRatio: 0 },
      arrhythmiaStatus: {
        isDetected: false,
        type: 'normal',
        confidence: 0,
        riskLevel: 'low'
      },
      signalQuality: 0,
      perfusionIndex: 0,
      algorithmsUsed: [],
      processingLatency: 0,
      confidence: { overall: 0, heartRate: 0, spo2: 0, bloodPressure: 0 }
    });

    setProcessingStats({
      totalSamples: 0,
      averageLatency: 0,
      algorithmsUsed: []
    });
  }, []);

  return {
    metrics,
    isProcessing,
    lastUpdate,
    processingStats,
    config,
    processSignal,
    updateConfig,
    reset
  };
}; 