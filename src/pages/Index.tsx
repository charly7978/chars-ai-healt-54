import React, { useState, useRef, useEffect, useCallback } from "react";
import VitalSign from "@/components/VitalSign";
import PPGCamera, { PPGCameraHandle } from "@/components/PPGCamera";
import CameraPreview from "@/components/CameraPreview";
import { useCamera } from "@/hooks/useCamera";
import { usePPGPipeline } from "@/hooks/usePPGPipeline";
import { useSaveMeasurement } from "@/hooks/useSaveMeasurement";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import PerfusionIndexIndicator from "@/components/PerfusionIndexIndicator";
import RGBDebugIndicator from "@/components/RGBDebugIndicator";

import MeasurementConfidenceIndicator from "@/components/MeasurementConfidenceIndicator";
import { toast } from "@/components/ui/use-toast";

/**
 * MONITOR PPG PRINCIPAL
 * 
 * FLUJO CRÍTICO DE CÁMARA:
 * 1. Usuario hace click en "Iniciar"
 * 2. handleToggleMonitoring() llama a startMonitoring()
 * 3. startMonitoring() llama a requestCamera() DIRECTAMENTE desde el click
 * 4. Esto cumple el requisito de seguridad del navegador (gesto de usuario)
 * 5. Una vez que la cámara está activa, se inicia el loop de captura
 */
const Index = () => {
  // ESTADOS PRINCIPALES
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  // REFERENCIAS
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const cameraComponentRef = useRef<PPGCameraHandle>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // HOOK DE CÁMARA - Acceso directo desde gesto
  const { 
    state: cameraState, 
    requestCamera, 
    stopCamera,
    setVideoElement 
  } = useCamera();
  
  // HOOK UNIFICADO DE PPG
  const {
    isCalibrating,
    calibrationProgress,
    heartRate,
    spo2,
    perfusionIndex,
    signalQuality,
    confidence,
    fingerDetected,
    filteredValue,
    isPeak,
    rrIntervals,
    hrv,
    rgbStats,
    // NUEVOS - Signos vitales completos
    glucose,
    hemoglobin,
    systolicPressure,
    diastolicPressure,
    cholesterol,
    triglycerides,
    arrhythmiaStatus,
    arrhythmiaCount,
    // Métodos
    start: startPipeline,
    stop: stopPipeline,
    startCalibration,
    forceCalibration,
    reset: resetPipeline,
    processFrame,
    setOnPeak
  } = usePPGPipeline();
  
  const { saveMeasurement } = useSaveMeasurement();

  // CANVAS PARA CAPTURA
  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 320;
      canvasRef.current.height = 240;
      ctxRef.current = canvasRef.current.getContext('2d', { 
        willReadFrequently: true,
        alpha: false 
      });
    }
  }, []);

  // CALLBACK PARA PICOS - Vibración + Beep
  useEffect(() => {
    setOnPeak((timestamp, bpm) => {
      // Vibración
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      // Beep cardíaco audible
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.frequency.value = 880; // La4 - tono cardíaco
        osc.type = 'sine';
        gain.gain.value = 0.15; // Volumen bajo
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.08); // 80ms de duración
        
        // Cleanup
        osc.onended = () => {
          osc.disconnect();
          gain.disconnect();
        };
      } catch (e) {
        // Silenciar errores de audio
      }
    });
  }, [setOnPeak]);

  // PANTALLA COMPLETA
  const enterFullScreen = async () => {
    if (isFullscreen) return;
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
      }
      if (screen.orientation?.lock) {
        await screen.orientation.lock('portrait').catch(() => {});
      }
      setIsFullscreen(true);
    } catch (err) {
      console.log('Error pantalla completa:', err);
    }
  };
  
  const exitFullScreen = () => {
    if (!isFullscreen) return;
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      }
      screen.orientation?.unlock();
      setIsFullscreen(false);
    } catch {}
  };

  useEffect(() => {
    const timer = setTimeout(() => enterFullScreen(), 1000);
    
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(
        document.fullscreenElement || 
        (document as any).webkitFullscreenElement
      ));
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    return () => {
      clearTimeout(timer);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // PREVENIR SCROLL
  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    document.body.addEventListener('touchmove', preventScroll, { passive: false });
    document.body.addEventListener('scroll', preventScroll, { passive: false });
    return () => {
      document.body.removeEventListener('touchmove', preventScroll);
      document.body.removeEventListener('scroll', preventScroll);
    };
  }, []);

  // === LOOP DE CAPTURA DE FRAMES ===
  const startFrameLoop = useCallback(() => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;
    
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) {
      isProcessingRef.current = false;
      return;
    }
    
    let lastFrameTime = 0;
    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    
    const captureFrame = () => {
      if (!isProcessingRef.current) return;
      
      const video = cameraComponentRef.current?.getVideoElement();
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        frameLoopRef.current = requestAnimationFrame(captureFrame);
        return;
      }
      
      // NUEVO: Verificar que el video está reproduciendo
      if (video.paused || video.ended) {
        video.play().catch(() => {});
        frameLoopRef.current = requestAnimationFrame(captureFrame);
        return;
      }
      
      const now = performance.now();
      if (now - lastFrameTime >= FRAME_INTERVAL) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          processFrame(imageData);
          lastFrameTime = now;
        } catch (e) {
          console.error('Error capturando frame:', e);
        }
      }
      
      frameLoopRef.current = requestAnimationFrame(captureFrame);
    };
    
    console.log('🎬 Iniciando loop de captura');
    frameLoopRef.current = requestAnimationFrame(captureFrame);
  }, [processFrame]);

  const stopFrameLoop = useCallback(() => {
    isProcessingRef.current = false;
    if (frameLoopRef.current) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }
    console.log('🛑 Loop de captura detenido');
  }, []);

  // === CUANDO EL VIDEO ESTÁ LISTO ===
  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    console.log('📹 Video PPG listo, iniciando captura...');
    startFrameLoop();
  }, [startFrameLoop]);

  // === INICIO DE MONITOREO ===
  // CRÍTICO: Esta función se llama DIRECTAMENTE desde el onClick del botón
  const startMonitoring = useCallback(async () => {
    if (isMonitoring) return;
    
    console.log('🚀 Iniciando monitoreo (gesto directo)...');
    setCameraError(null);
    
    if (navigator.vibrate) {
      navigator.vibrate([200]);
    }
    
    // Intentar pantalla completa (no bloquea si falla)
    enterFullScreen();
    
    setShowResults(false);
    setElapsedTime(0);
    
    // CRÍTICO: Solicitar cámara DIRECTAMENTE desde el gesto del usuario
    // Esto es requerido por las políticas de seguridad del navegador
    const stream = await requestCamera();
    
    if (!stream) {
      console.error('❌ No se pudo obtener acceso a la cámara');
      setCameraError(cameraState.error || 'No se pudo acceder a la cámara');
      toast({
        title: "Error de cámara",
        description: cameraState.error || "No se pudo acceder a la cámara. Verifica los permisos.",
        variant: "destructive",
        duration: 5000
      });
      return;
    }
    
    // Cámara OK - Iniciar pipeline
    console.log('✅ Cámara activa, iniciando pipeline...');
    startPipeline();
    startCalibration();
    setIsMonitoring(true);
    
    // Timer de medición
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
    }
    
    measurementTimerRef.current = window.setInterval(() => {
      setElapsedTime(prev => {
        const newTime = prev + 1;
        if (newTime >= 60) {
          finalizeMeasurement();
          return 60;
        }
        return newTime;
      });
    }, 1000);
    
  }, [isMonitoring, requestCamera, cameraState.error, startPipeline, startCalibration]);

  // === FINALIZAR MEDICIÓN ===
  const finalizeMeasurement = useCallback(async () => {
    if (!isMonitoring) return;
    
    console.log('🛑 Finalizando medición...');
    
    // Detener loop primero
    stopFrameLoop();
    
    // Detener timer
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    // Detener pipeline
    stopPipeline();
    
    if (isCalibrating) {
      forceCalibration();
    }
    
    // Guardar medición en la base de datos con TODOS los signos vitales
    if (heartRate > 0 || spo2 > 0) {
      await saveMeasurement({
        heartRate,
        vitalSigns: {
          spo2,
          glucose,
          hemoglobin,
          pressure: { systolic: systolicPressure, diastolic: diastolicPressure },
          arrhythmiaCount,
          arrhythmiaStatus,
          lipids: { totalCholesterol: cholesterol, triglycerides },
          isCalibrating: false,
          calibrationProgress: 100,
          lastArrhythmiaData: undefined,
          signalQuality,
          measurementConfidence: confidence
        },
        signalQuality
      });
    }
    
    // Detener cámara
    stopCamera();
    
    setIsMonitoring(false);
    setShowResults(true);
    setElapsedTime(0);
    
    console.log('✅ Medición finalizada');
  }, [isMonitoring, isCalibrating, stopFrameLoop, stopPipeline, forceCalibration, saveMeasurement, heartRate, spo2, signalQuality, confidence, stopCamera]);

  // === RESET COMPLETO ===
  const handleReset = useCallback(() => {
    console.log('🔄 Reset completo...');
    
    stopFrameLoop();
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    resetPipeline();
    stopCamera();
    
    setIsMonitoring(false);
    setShowResults(false);
    setElapsedTime(0);
    setCameraError(null);
    arrhythmiaDetectedRef.current = false;
    
    console.log('✅ Reset completado');
  }, [stopFrameLoop, resetPipeline, stopCamera]);

  // Detectar arritmias basadas en HRV
  useEffect(() => {
    if (!isMonitoring || !hrv) return;
    
    const isIrregular = hrv.rmssd > 50 || hrv.pnn50 > 20;
    
    if (isIrregular !== arrhythmiaDetectedRef.current) {
      arrhythmiaDetectedRef.current = isIrregular;
      
      if (isIrregular) {
        if (navigator.vibrate) {
          navigator.vibrate([200, 100, 200]);
        }
        toast({ 
          title: "⚠️ Variabilidad alta detectada", 
          description: `RMSSD: ${hrv.rmssd.toFixed(1)}ms`, 
          variant: "destructive", 
          duration: 4000 
        });
      }
    }
  }, [isMonitoring, hrv]);

  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      // CRÍTICO: startMonitoring contiene requestCamera que debe ejecutarse
      // en el contexto directo de este click handler
      startMonitoring();
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black" style={{ 
      height: '100svh',
      width: '100vw',
      maxWidth: '100vw',
      maxHeight: '100svh',
      overflow: 'hidden',
      touchAction: 'none',
      userSelect: 'none',
      WebkitTouchCallout: 'none',
      WebkitUserSelect: 'none'
    }}>
      
      {/* OVERLAY PANTALLA COMPLETA */}
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

      {/* ERROR DE CÁMARA */}
      {cameraError && (
        <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 bg-destructive/90 text-white p-6 rounded-lg max-w-sm text-center">
          <h3 className="text-lg font-bold mb-2">Error de Cámara</h3>
          <p className="text-sm mb-4">{cameraError}</p>
          <button 
            onClick={() => setCameraError(null)}
            className="bg-white text-destructive px-4 py-2 rounded font-semibold"
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="flex-1 relative">
        {/* PREVIEW DE CÁMARA */}
        <CameraPreview 
          stream={cameraState.stream}
          isFingerDetected={fingerDetected}
          signalQuality={signalQuality}
          isVisible={cameraState.isActive}
        />

        {/* CÁMARA PPG */}
        <div className="absolute inset-0">
          <PPGCamera 
            ref={cameraComponentRef}
            stream={cameraState.stream}
            onVideoReady={handleVideoReady}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* HEADER */}
          <div className="px-4 py-2 flex justify-between items-center bg-black/30">
            <PerfusionIndexIndicator 
              perfusionIndex={perfusionIndex}
              isMonitoring={isMonitoring}
            />
            
            {isMonitoring && (
              <MeasurementConfidenceIndicator 
                confidence={confidence}
                signalQuality={signalQuality}
                perfusionIndex={perfusionIndex}
                isMonitoring={isMonitoring}
              />
            )}
            
            <div className="text-white text-xl font-bold">
              {isMonitoring ? `${60 - elapsedTime}s` : "LISTO"}
            </div>
          </div>

          {/* RGB Debug Indicator */}
          {isMonitoring && (
            <div className="px-4 pb-2">
              <RGBDebugIndicator 
                redAC={rgbStats.redAC}
                redDC={rgbStats.redDC}
                greenAC={rgbStats.greenAC}
                greenDC={rgbStats.greenDC}
                isMonitoring={isMonitoring}
              />
            </div>
          )}

          {/* Barra de calibración */}
          {isCalibrating && (
            <div className="px-4 pb-2">
              <div className="bg-black/50 rounded-lg p-2">
                <div className="text-white text-xs mb-1 text-center">
                  Calibrando ZLO... {calibrationProgress}%
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${calibrationProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Flash indicator */}
          {cameraState.isActive && !cameraState.hasFlash && (
            <div className="px-4 pb-2">
              <div className="bg-muted text-muted-foreground text-xs p-2 rounded text-center">
                ⚠️ Flash no disponible - La lectura puede ser menos precisa
              </div>
            </div>
          )}

          <div className="flex-1">
            <PPGSignalMeter 
              value={filteredValue}
              quality={signalQuality}
              isFingerDetected={fingerDetected}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={arrhythmiaStatus}
              rawArrhythmiaData={null}
              preserveResults={showResults}
              diagnosticMessage={isCalibrating ? "Calibrando..." : undefined}
              isPeak={isPeak}
              bpm={heartRate}
              spo2={spo2}
              rrIntervals={rrIntervals}
            />
          </div>

          {/* SIGNOS VITALES */}
          <div className="absolute inset-x-0 top-[55%] bottom-[60px] bg-black/10 px-4 py-4 overflow-y-auto">
            <div className="grid grid-cols-3 gap-3 place-items-center">
              <VitalSign 
                label="FRECUENCIA CARDÍACA"
                value={heartRate > 0 ? Math.round(heartRate) : "--"}
                unit="BPM"
                highlighted={showResults}
              />
              <VitalSign 
                label="SPO2"
                value={spo2 > 0 ? Math.round(spo2) : "--"}
                unit="%"
                highlighted={showResults}
              />
              <VitalSign 
                label="PRESIÓN ARTERIAL"
                value={systolicPressure > 0 ? `${Math.round(systolicPressure)}/${Math.round(diastolicPressure)}` : "--/--"}
                unit="mmHg"
                highlighted={showResults}
              />
              <VitalSign 
                label="GLUCOSA"
                value={glucose > 0 ? Math.round(glucose) : "--"}
                unit="mg/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="HEMOGLOBINA"
                value={hemoglobin > 0 ? hemoglobin.toFixed(1) : "--"}
                unit="g/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="COLESTEROL"
                value={cholesterol > 0 ? Math.round(cholesterol) : "--"}
                unit="mg/dL"
                highlighted={showResults}
              />
              <VitalSign 
                label="SDNN"
                value={hrv.sdnn > 0 ? hrv.sdnn.toFixed(0) : "--"}
                unit="ms"
                highlighted={showResults}
              />
              <VitalSign 
                label="RMSSD"
                value={hrv.rmssd > 0 ? hrv.rmssd.toFixed(0) : "--"}
                unit="ms"
                highlighted={showResults}
              />
              <VitalSign 
                label="pNN50"
                value={hrv.pnn50 > 0 ? hrv.pnn50.toFixed(1) : "--"}
                unit="%"
                highlighted={showResults}
              />
            </div>
          </div>

          {/* BOTONES */}
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
