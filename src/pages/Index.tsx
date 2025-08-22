import React, { useState, useRef, useEffect, useCallback } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import SignalQualityIndicator from "@/components/SignalQualityIndicator";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
    glucose: 0,
    hemoglobin: 0,
    pressure: { systolic: 0, diastolic: 0 },
    arrhythmiaCount: 0,
    arrhythmiaStatus: "SIN ARRITMIAS|0",
    lipids: { totalCholesterol: 0, triglycerides: 0 },
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
  
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  
  // CONTROL DE ESTADOS CRÍTICO - Evita degradación
  const systemState = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING' | 'CALIBRATING'>('IDLE');
  const sessionIdRef = useRef<string>("");
  const initializationLock = useRef<boolean>(false);
  const cleanupInProgress = useRef<boolean>(false);
  
  const { 
    handleSample,
    lastResult,
    reset: resetSignalProcessor
  } = useSignalProcessor();
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState,
    reset: resetHeartBeat,
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

  // SISTEMA DE LIMPIEZA PROFUNDA - Soluciona degradación
  const performSystemCleanup = useCallback(() => {
    if (cleanupInProgress.current) {
      console.log('🧹 Cleanup ya en progreso, saltando...');
      return;
    }
    
    cleanupInProgress.current = true;
    console.log('🧹 SISTEMA CLEANUP PROFUNDO iniciado...');
    
    try {
      // Limpiar timers
      if (measurementTimerRef.current) {
        clearInterval(measurementTimerRef.current);
        measurementTimerRef.current = null;
      }
      
      // Reset procesadores
      resetSignalProcessor();
      resetHeartBeat();
      fullResetVitalSigns();
      
      // Reset estados React
      setIsMonitoring(false);
      setIsCameraOn(false);
      setShowResults(false);
      setIsCalibrating(false);
      setElapsedTime(0);
      setHeartRate(0);
      setHeartbeatSignal(0);
      setBeatMarker(0);
      setSignalQuality(0);
      setCalibrationProgress(0);
      setArrhythmiaCount("--");
      setVitalSigns({
        spo2: 0,
        glucose: 0,
        hemoglobin: 0,
        pressure: { systolic: 0, diastolic: 0 },
        arrhythmiaCount: 0,
        arrhythmiaStatus: "SIN ARRITMIAS|0",
        lipids: { totalCholesterol: 0, triglycerides: 0 },
        isCalibrating: false,
        calibrationProgress: 0,
        lastArrhythmiaData: undefined
      });
      
      // Reset referencias
      arrhythmiaDetectedRef.current = false;
      lastArrhythmiaData.current = null;
      
      systemState.current = 'IDLE';
      
      // Forzar garbage collection
      setTimeout(() => {
        if (window.gc) {
          window.gc();
        }
      }, 100);
      
      console.log('✅ SISTEMA CLEANUP PROFUNDO completado');
    } catch (error) {
      console.error('❌ Error en cleanup:', error);
    } finally {
      cleanupInProgress.current = false;
    }
  }, [resetSignalProcessor, resetHeartBeat, fullResetVitalSigns]);

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

  // PANTALLA COMPLETA INMERSIVA MEJORADA
  const enterFullScreen = useCallback(async () => {
    if (isFullscreen) return;
    try {
      const docEl = document.documentElement;
      
      // Intentar diferentes métodos de fullscreen
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
      } else if ((docEl as any).msRequestFullscreen) {
        await (docEl as any).msRequestFullscreen();
      } else if ((docEl as any).mozRequestFullScreen) {
        await (docEl as any).mozRequestFullScreen();
      }
      
      // Configurar orientación si está disponible
      if (screen.orientation && screen.orientation.lock) {
        try {
          await screen.orientation.lock('portrait');
        } catch (e) {
          console.log('Orientación no bloqueada:', e);
        }
      }
      
      setIsFullscreen(true);
      console.log('📱 Pantalla completa activada');
    } catch (err) {
      console.log('Error pantalla completa:', err);
    }
  }, [isFullscreen]);
  
  const exitFullScreen = useCallback(() => {
    if (!isFullscreen) return;
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      }
      setIsFullscreen(false);
    } catch (err) {
      console.log('Error salir fullscreen:', err);
    }
  }, [isFullscreen]);

  // EFECTOS OPTIMIZADOS
  useEffect(() => {
    const timer = setTimeout(() => enterFullScreen(), 500);
    
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement ||
        (document as any).msFullscreenElement ||
        (document as any).mozFullScreenElement
      ));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      exitFullScreen();
    };
  }, []);

  // Prevenir scroll y zoom
  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    const preventZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault();
      }
    };
    
    const options = { passive: false };
    
    document.body.addEventListener('touchmove', preventScroll, options);
    document.body.addEventListener('scroll', preventScroll, options);
    document.body.addEventListener('touchstart', preventZoom, options);
    document.body.addEventListener('gesturestart', preventScroll, options);
    document.body.addEventListener('gesturechange', preventScroll, options);
    document.body.addEventListener('gestureend', preventScroll, options);

    return () => {
      document.body.removeEventListener('touchmove', preventScroll);
      document.body.removeEventListener('scroll', preventScroll);
      document.body.removeEventListener('touchstart', preventZoom);
      document.body.removeEventListener('gesturestart', preventScroll);
      document.body.removeEventListener('gesturechange', preventScroll);
      document.body.removeEventListener('gestureend', preventScroll);
    };
  }, []);

  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  // SISTEMA DE INICIO MEJORADO - Evita errores de estado
  const startMonitoring = useCallback(() => {
    if (systemState.current !== 'IDLE') {
      console.log('⚠️ Sistema ocupado, esperando...', systemState.current);
      return;
    }
    
    systemState.current = 'STARTING';
    console.log('🚀 INICIANDO MONITOREO VERSIÓN 2.0...');
    
    // Cleanup preventivo
    performSystemCleanup();
    
    // Activar sistemas
    enterFullScreen();
    setIsMonitoring(true);
    setIsCameraOn(true);
    setShowResults(false);
    
    setElapsedTime(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    setIsCalibrating(true);
    startCalibration();
    
    setTimeout(() => {
      if (systemState.current === 'STARTING') {
        systemState.current = 'ACTIVE';
        setIsCalibrating(false);
      }
    }, 3000);
    
    // TIMER EXTENDIDO A 40 SEGUNDOS
    measurementTimerRef.current = window.setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        if (newTime >= 40) { // CAMBIADO DE 30 A 40 SEGUNDOS
          finalizeMeasurement();
          return 40;
        }
        return newTime;
      });
    }, 1000);
    
    systemState.current = 'ACTIVE';
    console.log('✅ Monitoreo iniciado exitosamente');
  }, [enterFullScreen, startCalibration, performSystemCleanup]);

  // SISTEMA DE FINALIZACIÓN MEJORADO - Evita cuelgues
  const finalizeMeasurement = useCallback(() => {
    if (systemState.current === 'STOPPING' || systemState.current === 'IDLE') {
      console.log('⚠️ Finalización ya en progreso o sistema idle');
      return;
    }
    
    systemState.current = 'STOPPING';
    console.log('🏁 FINALIZANDO MEDICIÓN...');
    
    if (isCalibrating) {
      forceCalibrationCompletion();
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setIsCalibrating(false);
    
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
    setSignalQuality(0);
    setCalibrationProgress(0);
    
    systemState.current = 'IDLE';
    console.log('✅ Medición finalizada exitosamente');
  }, [isCalibrating, forceCalibrationCompletion, resetVitalSigns]);

  // SISTEMA DE RESET MEJORADO - Limpieza total
  const handleReset = useCallback(() => {
    console.log('🔄 RESET TOTAL DEL SISTEMA...');
    
    // Forzar parada inmediata
    systemState.current = 'STOPPING';
    
    // Cleanup completo
    performSystemCleanup();
    
    // Esperar un frame para asegurar cleanup
    setTimeout(() => {
      console.log('✅ Reset completado exitosamente');
    }, 100);
  }, [performSystemCleanup]);

  useEffect(() => {
    if (!lastResult) return;

    const bestChannel = lastResult.channels.find(ch => ch.isFingerDetected && ch.quality > 30) || lastResult.channels[0];
    setSignalQuality(bestChannel?.quality || 0);
    
    if (!isMonitoring || systemState.current !== 'ACTIVE') return;
    
    const MIN_SIGNAL_QUALITY = 25;
    
    if (!bestChannel?.isFingerDetected || (bestChannel?.quality || 0) < MIN_SIGNAL_QUALITY) {
      return;
    }

    const heartBeatResult = processHeartBeat(
      bestChannel.calibratedSignal[bestChannel.calibratedSignal.length - 1] || 0,
      bestChannel.isFingerDetected, 
      lastResult.timestamp
    );
    
    const finalBpm = lastResult.aggregatedBPM || heartBeatResult.bpm;
    setHeartRate(finalBpm);
    setHeartbeatSignal(bestChannel.calibratedSignal[bestChannel.calibratedSignal.length - 1] || 0);
    setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
    
    if (heartBeatResult.rrData?.intervals) {
      setRRIntervals(heartBeatResult.rrData.intervals.slice(-5));
    }
    
    const vitals = processVitalSigns(bestChannel.calibratedSignal[bestChannel.calibratedSignal.length - 1] || 0, heartBeatResult.rrData);
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
  }, [lastResult, isMonitoring, processHeartBeat, processVitalSigns, setArrhythmiaState]);

  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const currentProgress = getCalibrationProgress();
      setCalibrationProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = useCallback(() => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      startMonitoring();
    }
  }, [isMonitoring, finalizeMeasurement, startMonitoring]);

  const activeChannels = lastResult?.channels.filter(c => c.isFingerDetected).length || 0;
  const totalChannels = lastResult?.channels.length || 0;
  const avgSNR = lastResult?.channels.length ? 
    (lastResult.channels.reduce((sum, c) => sum + c.snr, 0) / lastResult.channels.length) : 
    0;
  const currentBPM = lastResult?.aggregatedBPM || heartRate;

  return (
    <div 
      className="fixed inset-0 flex flex-col bg-gradient-to-br from-black via-gray-900 to-black overflow-hidden"
      style={{ 
        height: '100svh',
        width: '100vw',
        maxWidth: '100vw',
        maxHeight: '100svh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: isFullscreen ? 
          'radial-gradient(ellipse at center, #0a0a0a 0%, #000 70%, #111 100%)' :
          'linear-gradient(135deg, #1a1a1a 0%, #000 50%, #0a0a0a 100%)',
        transform: isFullscreen ? 'scale(1.02)' : 'scale(1)',
        transition: 'all 0.3s ease-in-out'
      }}
    >
      {/* OVERLAY DE PANTALLA COMPLETA MEJORADO */}
      {!isFullscreen && (
        <button 
          onClick={enterFullScreen}
          className="fixed inset-0 z-50 w-full h-full flex items-center justify-center bg-black/95 backdrop-blur-md text-white transition-all duration-500"
        >
          <div className="text-center p-8 bg-gradient-to-br from-primary/20 to-secondary/20 rounded-3xl backdrop-blur-sm border border-white/10 shadow-2xl transform hover:scale-105 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5m11 5v-4m0 4h-4m4 0l-5-5" />
            </svg>
            <p className="text-2xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Monitor Cardíaco PPG
            </p>
            <p className="text-lg text-white/80">Toca para pantalla completa inmersiva</p>
            <p className="text-sm text-white/60 mt-2">Experiencia médica optimizada</p>
          </div>
        </button>
      )}

      <div className="flex-1 relative">
        <div className="absolute inset-0">
          <CameraView 
            onSample={handleSample}
            isMonitoring={isCameraOn}
            targetFps={30}
            roiSize={320}
            enableTorch={true}
            coverageThresholdPixelBrightness={15}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* SENSOR DE CALIDAD MEJORADO */}
          <SignalQualityIndicator 
            quality={signalQuality}
            isMonitoring={isMonitoring}
            isFingerDetected={lastResult?.fingerDetected || false}
            bpm={currentBPM}
            snr={avgSNR}
            activeChannels={activeChannels}
            totalChannels={totalChannels}
            className="absolute top-4 right-4 z-20"
          />
          
          {/* MEDIDOR PPG MEJORADO */}
          <div className="flex-1 pt-12">
            <PPGSignalMeter 
              value={beatMarker}
              quality={signalQuality}
              isFingerDetected={lastResult?.fingerDetected || false}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
            />
          </div>

          {/* TIEMPO Y PROGRESO MEJORADO */}
          {isMonitoring && (
            <div className="absolute top-4 left-4 z-20 bg-black/40 backdrop-blur rounded-xl px-4 py-2 border border-white/10">
              <div className="text-white text-sm font-medium">
                Progreso: {elapsedTime}/40s
              </div>
              <div className="w-32 h-1 bg-white/20 rounded-full mt-1">
                <div 
                  className="h-full bg-gradient-to-r from-green-400 to-blue-400 rounded-full transition-all duration-1000"
                  style={{ width: `${(elapsedTime / 40) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* SIGNOS VITALES GRID MEJORADO */}
          <div className="absolute inset-x-0 top-[50%] bottom-[60px] bg-black/5 backdrop-blur-sm px-4 py-6">
            <div className="grid grid-cols-3 gap-4 place-items-center max-w-6xl mx-auto">
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

          {/* BOTONERA MEJORADA */}
          <div className="absolute inset-x-0 bottom-4 flex gap-4 px-4 z-20">
            <div className="w-1/2">
              <MonitorButton 
                isMonitoring={isMonitoring} 
                onToggle={handleToggleMonitoring} 
                variant="monitor"
                className="transform hover:scale-105 transition-transform duration-200 shadow-lg"
              />
            </div>
            <div className="w-1/2">
              <MonitorButton 
                isMonitoring={isMonitoring} 
                onToggle={handleReset} 
                variant="reset"
                className="transform hover:scale-105 transition-transform duration-200 shadow-lg"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
