import React, { useState, useRef, useEffect } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";
import { CameraSample } from "@/types";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 98, // Valor fisiológico por defecto
    glucose: 95, // Valor fisiológico por defecto
    hemoglobin: 15, // Valor fisiológico por defecto (corregido)
    pressure: { systolic: 120, diastolic: 80 }, // Valores fisiológicos
    arrhythmiaCount: 0,
    arrhythmiaStatus: "SIN ARRITMIAS|0",
    lipids: { totalCholesterol: 180, triglycerides: 120 }, // Valores fisiológicos
    isCalibrating: false,
    calibrationProgress: 0,
    lastArrhythmiaData: undefined
  });
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [lastHeartbeatDebug, setLastHeartbeatDebug] = useState<{ bandRatio?: number; gatedFinger?: boolean; gatedQuality?: boolean; gatedSnr?: boolean; spectralOk?: boolean } | null>(null);
  
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  
  const systemState = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'CALIBRATING'>('IDLE');
  const processedSignalsRef = useRef<number>(0); // Contador para logging inteligente
  const sessionIdRef = useRef<string>("");
  const initializationLock = useRef<boolean>(false);
  
  const { 
    handleSample,
    lastResult,
    reset: resetSignalProcessor
  } = useSignalProcessor();
  
  // Agregar contador de muestras local para debug
  const debugSampleCountRef = useRef(0);
  
  // ✅ DEBUG COUNTER REDUCIDO - MENOS LOGS INNECESARIOS
  const handleCameraSample = (sample: CameraSample) => {
    debugSampleCountRef.current++;
    
    // ✅ ALIMENTAR ONDA DEL MONITOR CON SEÑAL PPG REAL
    const chroma = sample.rMean - 0.5 * sample.gMean;
    const fused = Math.max(0, Math.min(255, 0.8 * sample.rMean + 0.2 * chroma));
    setHeartbeatSignal(fused);
    
    // ✅ PROCESAR UNA SOLA VEZ - SIN DUPLICACIONES  
    handleSample(sample);
  };
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState,
    reset: resetHeartBeat,
    unifiedMetrics, // MÉTRICAS UNIFICADAS AVANZADAS
    precisionMetrics // MÉTRICAS DE PRECISIÓN CARDÍACA
  } = useHeartBeatProcessor();
  
  const { 
    processSignal: processVitalSigns, 
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion,
    getCalibrationProgress
  } = useVitalSignsProcessor();

  useEffect(() => {
    if (initializationLock.current) return;
    
    initializationLock.current = true;
    const randomBytes = new Uint32Array(3);
    crypto.getRandomValues(randomBytes);
    sessionIdRef.current = `main_${randomBytes[0].toString(36)}_${randomBytes[1].toString(36)}_${randomBytes[2].toString(36)}`;
    
    return () => {
      initializationLock.current = false;
    };
  }, []);

  const enterFullScreen = async () => {
    const elem = document.documentElement;
    
    try {
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if ((elem as any).webkitRequestFullscreen) {
        await (elem as any).webkitRequestFullscreen();
      } else if ((elem as any).mozRequestFullScreen) {
        await (elem as any).mozRequestFullScreen();
      } else if ((elem as any).msRequestFullscreen) {
        await (elem as any).msRequestFullscreen();
      }
      
      // Mantener orientación vertical (portrait) en móviles
      if ('orientation' in screen && (screen.orientation as any).lock) {
        try {
          await (screen.orientation as any).lock('portrait-primary');
        } catch (e) {
          // Ignorar si no es soportado
          console.log('Orientación vertical no pudo ser forzada');
        }
      }
      
      setIsFullscreen(true);
    } catch (err) {
      console.warn('No se pudo entrar en pantalla completa:', err);
    }
  };
  
  const exitFullScreen = () => {
    if (!isFullscreen) return;
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      setIsFullscreen(false);
    } catch (err) {}
  };

  useEffect(() => {
    // No entrar automáticamente en pantalla completa
    // const timer = setTimeout(() => enterFullScreen(), 1000);
    
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement
      ));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    return () => {
      // clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      // No salir automáticamente de pantalla completa al desmontar
      // exitFullScreen();
    };
  }, []);

  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    const options = { passive: false };
    
    document.body.addEventListener('touchmove', preventScroll, options);
    document.body.addEventListener('scroll', preventScroll, options);

    return () => {
      document.body.removeEventListener('touchmove', preventScroll);
      document.body.removeEventListener('scroll', preventScroll);
    };
  }, []);

  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  const startMonitoring = () => {
    if (systemState.current !== 'IDLE') {
      console.log('⚠️ PREVINIENDO INICIO MÚLTIPLE - Estado actual:', systemState.current);
      return;
    }
    
    console.log('🚀 INICIANDO MONITOREO ÚNICO - Sistema limpio');
    
    // ✅ RESET COMPLETO PARA EVITAR ARRASTRE DE PROCESOS ANTERIORES
    fullResetVitalSigns();
    resetHeartBeat();
    resetSignalProcessor();
    
    systemState.current = 'STARTING';
    
    // ✅ HABILITAR AUDIO Y VIBRACIÓN PARA LATIDOS REALES
    try {
      (window as any).__hbAudioEnabled__ = true;
    } catch {}
    
    setIsMonitoring(true);
    setIsCameraOn(true);
    setShowResults(false);
    
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    setIsCalibrating(true);
    startCalibration();
    
    systemState.current = 'CALIBRATING';
    
    setTimeout(() => {
      if (systemState.current === 'CALIBRATING') {
        systemState.current = 'ACTIVE';
        console.log('✅ Sistema ACTIVO - Procesamiento de latidos reales habilitado');
      }
      setIsCalibrating(false);
    }, 2000);
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
    }
    
    measurementTimerRef.current = window.setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        if (newTime >= 30) {
          finalizeMeasurement();
          return 30;
        }
        return newTime;
      });
    }, 1000);
  };

  const finalizeMeasurement = () => {
    if (systemState.current === 'STOPPING' || systemState.current === 'IDLE') return;
    
    systemState.current = 'STOPPING';
    
    if (isCalibrating) {
      forceCalibrationCompletion();
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setIsCalibrating(false);
    setSignalQuality(0);
    setBeatMarker(0);
    setHeartbeatSignal(0);
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    const savedResults = resetVitalSigns();
    if (savedResults) {
      setVitalSigns(savedResults);
      setShowResults(true);
    }
    
    setElapsedTime(0);
    setCalibrationProgress(0);
    
    // Reset de pipelines para preparar próximo ciclo sin arrastre
    resetHeartBeat();
    resetSignalProcessor();
    
    systemState.current = 'IDLE';
  };

  const handleReset = () => {
    systemState.current = 'STOPPING';
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setShowResults(false);
    setIsCalibrating(false);
    setSignalQuality(0);
    setBeatMarker(0);
    setHeartbeatSignal(0);
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    fullResetVitalSigns();
    resetHeartBeat();
    
    setElapsedTime(0);
    setHeartRate(0);
    setVitalSigns({ 
      spo2: 98, // Valor fisiológico de reset
      glucose: 95, // Valor fisiológico de reset
      hemoglobin: 15, // Valor fisiológico de reset (corregido)
      pressure: { systolic: 120, diastolic: 80 }, // Valores fisiológicos
      arrhythmiaCount: 0,
      arrhythmiaStatus: "SIN ARRITMIAS|0",
      lipids: { totalCholesterol: 180, triglycerides: 120 }, // Valores fisiológicos
      isCalibrating: false,
      calibrationProgress: 0,
      lastArrhythmiaData: undefined
    });
    setArrhythmiaCount("--");
    setSignalQuality(0);
    lastArrhythmiaData.current = null;
    setCalibrationProgress(0);
    arrhythmiaDetectedRef.current = false;
    
    systemState.current = 'IDLE';
  };

  useEffect(() => {
    if (!lastResult) return;

    const bestChannel = lastResult.fingerDetected
      ? lastResult.channels
          .filter(ch => ch.isFingerDetected)
          .sort((a, b) => b.quality - a.quality)[0]
      : undefined;
    setSignalQuality(lastResult.fingerDetected ? (bestChannel?.quality || 0) : 0);
    
    // ✅ SOLO PROCESAR SI ESTAMOS EN ESTADO ACTIVO DE MONITOREO
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    const MIN_SIGNAL_QUALITY = 20;
    
    if (!bestChannel?.isFingerDetected || (bestChannel?.quality || 0) < MIN_SIGNAL_QUALITY) {
      return;
    }

    // ✅ PROCESAMIENTO ÚNICO DE LATIDOS REALES - SIN DUPLICACIONES
    const signalValue = bestChannel.calibratedSignal[bestChannel.calibratedSignal.length - 1] || 0;
    const heartBeatResult = processHeartBeat(
      signalValue,
      bestChannel.isFingerDetected, 
      lastResult.timestamp,
      { quality: bestChannel.quality, snr: bestChannel.snr }
    );
    
    if (heartBeatResult?.debug) {
      setLastHeartbeatDebug({
        bandRatio: heartBeatResult.debug.bandRatio,
        gatedFinger: heartBeatResult.debug.gatedFinger,
        gatedQuality: heartBeatResult.debug.gatedQuality,
        gatedSnr: heartBeatResult.debug.gatedSnr,
        spectralOk: heartBeatResult.debug.spectralOk
      });
    }
    
    // ✅ UNIFICAR FUENTE DE BPM: Usar el más preciso disponible
    const finalBPM = precisionMetrics?.bpm || heartBeatResult.bpm;
    setHeartRate(finalBPM);
    
    // Incrementar contador y logging de selección de BPM cada 100 procesamiento
    processedSignalsRef.current++;
    if (processedSignalsRef.current % 100 === 0) {
      console.log('🫀 Selección de BPM:', {
        bpmOriginal: heartBeatResult.bpm,
        bpmPrecision: precisionMetrics?.bpm || 'N/A',
        bpmSeleccionado: finalBPM,
        confianzaPrecision: precisionMetrics?.confidence.toFixed(3) || 'N/A',
        morfologiaScore: precisionMetrics?.beatAnalysis.morphologyScore.toFixed(3) || 'N/A'
      });
    }
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    // ✅ PROCESAMIENTO ÚNICO DE SIGNOS VITALES
    const vitals = processVitalSigns(signalValue, heartBeatResult.rrData);
    if (vitals) {
      setVitalSigns(vitals);
      
      if (vitals.lastArrhythmiaData) {
        lastArrhythmiaData.current = vitals.lastArrhythmiaData;
        const [status, count] = vitals.arrhythmiaStatus.split('|');
        setArrhythmiaCount(count || "0");
        
        const isArrhythmiaDetected = status === "ARRITMIA DETECTADA";
        if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
          arrhythmiaDetectedRef.current = isArrhythmiaDetected;
          setArrhythmiaState(isArrhythmiaDetected);
          
          if (isArrhythmiaDetected) {
            toast({ 
              title: "¡Arritmia detectada!", 
              description: "Latido irregular identificado.", 
              variant: "destructive", 
              duration: 3000 
            });
          }
        }
      }
    }
  }, [lastResult, isMonitoring]); // ✅ DEPENDENCIAS REDUCIDAS PARA EVITAR DUPLICACIONES

  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
      }
    }, 100); // Optimizado de 500ms a 100ms para mejor respuesta

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      startMonitoring();
    }
  };

  const SignalQualitySensor = () => {
    const getQualityColor = () => {
      if (!lastResult?.fingerDetected) return 'from-gray-500 to-gray-600';
      if (signalQuality >= 80) return 'from-emerald-400 to-green-500';
      if (signalQuality >= 60) return 'from-yellow-400 to-amber-500';  
      if (signalQuality >= 40) return 'from-orange-400 to-red-500';
      return 'from-red-500 to-red-700';
    };

    const getQualityText = () => {
      if (!lastResult?.fingerDetected) return 'Sin detección';
      if (signalQuality >= 85) return 'Excelente';
      if (signalQuality >= 65) return 'Buena';
      if (signalQuality >= 45) return 'Regular';
      return 'Débil';
    };

    const getStatusColor = () => {
      if (!lastResult?.fingerDetected) return 'text-gray-400';
      if (signalQuality >= 75) return 'text-green-400';
      if (signalQuality >= 50) return 'text-yellow-400';
      return 'text-red-400';
    };

    // Métricas en tiempo real
    const activeChannels = lastResult?.channels.filter(c => c.isFingerDetected).length || 0;
    const totalChannels = lastResult?.channels.length || 0;
    const avgSNR = lastResult?.channels.length ? 
      (lastResult.channels.reduce((sum, c) => sum + c.snr, 0) / lastResult.channels.length).toFixed(1) : 
      '0.0';
    
    const bestChannel = lastResult?.channels.find(c => c.isFingerDetected && c.quality > 30);
    const currentBPM = lastResult?.aggregatedBPM || bestChannel?.bpm || '--';

    return (
      <div className="absolute top-4 right-4 bg-black/85 backdrop-blur-md rounded-xl p-3 border border-white/10 min-w-[140px]">
        <div className="text-center">
          <div className="text-white/60 text-xs font-medium mb-2 uppercase tracking-wider">
            Calidad PPG
          </div>
          
          {/* Indicador circular principal */}
          <div className="relative w-12 h-12 mx-auto mb-2">
            <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 48 48">
              <circle 
                cx="24" cy="24" r="20" 
                fill="none" 
                stroke="rgba(255,255,255,0.08)" 
                strokeWidth="3"
              />
              <circle 
                cx="24" cy="24" r="20" 
                fill="none" 
                stroke="url(#qualityGradient)" 
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(signalQuality / 100) * 125.6} 125.6`}
                className="transition-all duration-700 ease-out"
                style={{
                  filter: lastResult?.fingerDetected ? 
                    'drop-shadow(0 0 4px currentColor)' : 'none'
                }}
              />
              <defs>
                <linearGradient id="qualityGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor={
                    signalQuality >= 80 ? '#10b981' : 
                    signalQuality >= 60 ? '#f59e0b' : 
                    signalQuality >= 40 ? '#f97316' : '#ef4444'
                  } />
                  <stop offset="100%" stopColor={
                    signalQuality >= 80 ? '#059669' : 
                    signalQuality >= 60 ? '#d97706' : 
                    signalQuality >= 40 ? '#ea580c' : '#dc2626'
                  } />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-sm font-bold ${getStatusColor()}`}>
                {signalQuality}%
              </span>
            </div>
          </div>
          
          {/* Estado textual */}
          <div className={`text-xs font-medium mb-2 ${getStatusColor()}`}>
            {getQualityText()}
          </div>
          
          {/* Métricas detalladas */}
          <div className="space-y-1 text-xs text-white/50">
            <div className="flex justify-between">
              <span>BPM:</span>
              <span className="text-white/70 font-medium">{heartRate || '--'}</span>
            </div>
            <div className="flex justify-between">
              <span>Canales:</span>
              <span className="text-white/70">{activeChannels}/{totalChannels}</span>
            </div>
            <div className="flex justify-between">
              <span>SNR:</span>
              <span className="text-white/70">{avgSNR}</span>
            </div>
          </div>
          
          {/* Indicador de estado */}
          <div className="mt-2 pt-2 border-t border-white/10">
            <div className="flex items-center justify-center space-x-1">
              <div className={`w-2 h-2 rounded-full ${
                lastResult?.fingerDetected ? 
                'bg-green-400 animate-pulse' : 
                'bg-gray-500'
              }`}></div>
              <span className="text-xs text-white/60">
                {lastResult?.fingerDetected ? 'Detectado' : 'Buscando...'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black" style={{ 
      height: '100svh',
      width: '100vw',
      maxWidth: '100vw',
      maxHeight: '100svh',
      overflow: 'hidden',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)'
    }}>
      {!isFullscreen && (
        <button 
          onClick={enterFullScreen}
          className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/90 text-white"
        >
          <div className="text-center p-4 bg-primary/20 rounded-lg backdrop-blur-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
            <p className="text-lg font-semibold">Toca para modo pantalla completa</p>
          </div>
        </button>
      )}

      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <CameraView 
            onSample={handleCameraSample}
            isMonitoring={isCameraOn}
            targetFps={30}
            roiSize={320}
            enableTorch={true}
            coverageThresholdPixelBrightness={40}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* Sensor de Calidad REAL y Funcional */}
          <SignalQualitySensor />
          
          <div className="flex-1 pt-12">
            <PPGSignalMeter 
              value={heartbeatSignal}
              quality={signalQuality}
              isFingerDetected={lastResult?.fingerDetected || false}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
              debug={{
                snr: (lastResult?.channels.find(c => c.isFingerDetected)?.snr) ?? 0,
                bandRatio: (typeof lastHeartbeatDebug?.bandRatio === 'number' ? lastHeartbeatDebug.bandRatio : undefined),
                reasons: (() => {
                  const r: string[] = [];
                  if (lastHeartbeatDebug && !lastHeartbeatDebug.gatedFinger) r.push('sin dedo');
                  if (lastHeartbeatDebug && !lastHeartbeatDebug.gatedQuality) r.push('calidad baja');
                  if (lastHeartbeatDebug && !lastHeartbeatDebug.gatedSnr) r.push('SNR bajo');
                  if (lastHeartbeatDebug && lastHeartbeatDebug.spectralOk === false) r.push('espectral bajo');
                  return r;
                })(),
                gatedFinger: lastHeartbeatDebug?.gatedFinger,
                gatedQuality: lastHeartbeatDebug?.gatedQuality,
                gatedSnr: lastHeartbeatDebug?.gatedSnr,
                spectralOk: lastHeartbeatDebug?.spectralOk
              }}
              unifiedMetrics={unifiedMetrics} // MÉTRICAS UNIFICADAS AVANZADAS
              precisionMetrics={precisionMetrics} // MÉTRICAS DE PRECISIÓN CARDÍACA
            />
          </div>

          <div className="absolute inset-x-0 top-[50%] bottom-[60px] bg-black/10 px-4 py-6">
            <div className="grid grid-cols-3 gap-4 place-items-center">
              <VitalSign 
                label="FRECUENCIA CARDÍACA"
                value={heartRate || "--"}
                unit="BPM"
                highlighted={showResults}
              />
              <VitalSign 
                label="SPO2"
                value={vitalSigns.spo2 || "--"}
                unit="%"
                highlighted={showResults}
              />
              <VitalSign 
                label="PRESIÓN ARTERIAL"
                value={vitalSigns.pressure ? `${vitalSigns.pressure.systolic}/${vitalSigns.pressure.diastolic}` : "--/--"}
                unit="mmHg"
                highlighted={showResults}
              />
              <VitalSign 
                label="HEMOGLOBINA"
                value={vitalSigns.hemoglobin || "--"}
                unit="g/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="GLUCOSA"
                value={vitalSigns.glucose || "--"}
                unit="mg/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="COLESTEROL/TRIGL."
                value={`${vitalSigns.lipids?.totalCholesterol || "--"}/${vitalSigns.lipids?.triglycerides || "--"}`}
                unit="mg/dL"
                highlighted={showResults}
              />
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-4 flex gap-4 px-4">
            <div className="w-1/2">
              <MonitorButton 
                isMonitoring={isMonitoring} 
                onToggle={handleToggleMonitoring} 
                variant="monitor"
              />
            </div>
            <div className="w-1/2">
              <MonitorButton 
                isMonitoring={isMonitoring} 
                onToggle={handleReset} 
                variant="reset"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
