import React, { useState, useRef, useEffect, useCallback } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView, { CameraViewHandle } from "@/components/CameraView";
import CameraPreview from "@/components/CameraPreview";
import { usePPGPipeline } from "@/hooks/usePPGPipeline";
import { useSaveMeasurement } from "@/hooks/useSaveMeasurement";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import PerfusionIndexIndicator from "@/components/PerfusionIndexIndicator";
import RGBDebugIndicator from "@/components/RGBDebugIndicator";
import DisclaimerOverlay from "@/components/DisclaimerOverlay";
import MeasurementConfidenceIndicator from "@/components/MeasurementConfidenceIndicator";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  // ESTADOS PRINCIPALES
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  
  // REFERENCIAS
  const measurementTimerRef = useRef<number | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  const cameraRef = useRef<CameraViewHandle>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameLoopRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  
  // HOOK UNIFICADO DE PPG - Reemplaza useSignalProcessor, useHeartBeatProcessor, useVitalSignsProcessor
  const {
    // Estado
    isCalibrating,
    calibrationProgress,
    isProcessing,
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
    framesProcessed,
    
    // Métodos de control
    start: startPipeline,
    stop: stopPipeline,
    startCalibration,
    forceCalibration,
    reset: resetPipeline,
    
    // Procesamiento
    processFrame,
    
    // Getters
    getRGBStats,
    getRRIntervals,
    getLastFrame,
    
    // Callbacks
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

  // CALLBACK PARA PICOS - Vibración y marcador
  useEffect(() => {
    setOnPeak((timestamp, bpm) => {
      if (navigator.vibrate) {
        navigator.vibrate(50);
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
      
      const video = cameraRef.current?.getVideoElement();
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
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

  // === INICIO DE MONITOREO ===
  const startMonitoring = useCallback(() => {
    if (isMonitoring) return;
    
    console.log('🚀 Iniciando monitoreo con Pipeline Unificado...');
    
    if (navigator.vibrate) {
      navigator.vibrate([200]);
    }
    
    enterFullScreen();
    setShowResults(false);
    setElapsedTime(0);
    
    // Iniciar pipeline unificado
    startPipeline();
    startCalibration();
    setIsCameraOn(true);
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
    
  }, [isMonitoring, startPipeline, startCalibration, enterFullScreen]);

  // === CUANDO LA CÁMARA ESTÁ LISTA ===
  const handleStreamReady = useCallback((stream: MediaStream) => {
    console.log('📹 Stream recibido');
    setCameraStream(stream);
    
    // Esperar a que el video esté listo y comenzar captura
    setTimeout(() => {
      const video = cameraRef.current?.getVideoElement();
      if (video && video.readyState >= 2) {
        console.log('✅ Video listo:', video.videoWidth, 'x', video.videoHeight);
        startFrameLoop();
      } else {
        // Reintentar
        const checkReady = setInterval(() => {
          const v = cameraRef.current?.getVideoElement();
          if (v && v.readyState >= 2 && v.videoWidth > 0) {
            clearInterval(checkReady);
            console.log('✅ Video listo (retry):', v.videoWidth, 'x', v.videoHeight);
            startFrameLoop();
          }
        }, 100);
        
        // Timeout después de 5 segundos
        setTimeout(() => clearInterval(checkReady), 5000);
      }
    }, 500);
  }, [startFrameLoop]);

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
    
    // Guardar medición en la base de datos
    if (heartRate > 0 || spo2 > 0) {
      await saveMeasurement({
        heartRate,
        vitalSigns: {
          spo2,
          glucose: 0,
          hemoglobin: 0,
          pressure: { systolic: 0, diastolic: 0 },
          arrhythmiaCount: 0,
          arrhythmiaStatus: "SIN ARRITMIAS|0",
          lipids: { totalCholesterol: 0, triglycerides: 0 },
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
    setIsCameraOn(false);
    
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    
    setIsMonitoring(false);
    setShowResults(true);
    setElapsedTime(0);
    
    console.log('✅ Medición finalizada y guardada');
  }, [isMonitoring, isCalibrating, cameraStream, stopFrameLoop, stopPipeline, forceCalibration, saveMeasurement, heartRate, spo2, signalQuality, confidence]);

  // === RESET COMPLETO ===
  const handleReset = useCallback(() => {
    console.log('🔄 Reset completo...');
    
    stopFrameLoop();
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    // Reset pipeline unificado
    resetPipeline();
    
    setIsCameraOn(false);
    
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    
    setIsMonitoring(false);
    setShowResults(false);
    setElapsedTime(0);
    arrhythmiaDetectedRef.current = false;
    
    console.log('✅ Reset completado');
  }, [cameraStream, stopFrameLoop, resetPipeline]);

  // Detectar arritmias basadas en HRV
  useEffect(() => {
    if (!isMonitoring || !hrv) return;
    
    // Detectar irregularidad usando métricas HRV
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
      {/* DISCLAIMER PERMANENTE */}
      <DisclaimerOverlay />
      
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

      <div className="flex-1 relative">
        {/* PREVIEW DE CÁMARA */}
        <CameraPreview 
          stream={cameraStream}
          isFingerDetected={fingerDetected}
          signalQuality={signalQuality}
          isVisible={isCameraOn}
        />

        {/* CÁMARA - Con ref directo */}
        <div className="absolute inset-0">
          <CameraView 
            ref={cameraRef}
            onStreamReady={handleStreamReady}
            isMonitoring={isCameraOn}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
          {/* HEADER - Tiempo restante, PI y Confianza */}
          <div className="px-4 py-2 flex justify-between items-center bg-black/30">
            {/* Indicador de Perfusion Index */}
            <PerfusionIndexIndicator 
              perfusionIndex={perfusionIndex}
              isMonitoring={isMonitoring}
            />
            
            {/* Indicador de Confianza */}
            {isMonitoring && (
              <MeasurementConfidenceIndicator 
                confidence={confidence}
                signalQuality={signalQuality}
                perfusionIndex={perfusionIndex}
                isMonitoring={isMonitoring}
              />
            )}
            
            {/* Timer */}
            <div className="text-white text-xl font-bold">
              {isMonitoring ? `${60 - elapsedTime}s` : "LISTO"}
            </div>
          </div>

          {/* RGB Debug Indicator - debajo del header */}
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

          <div className="flex-1">
            <PPGSignalMeter 
              value={filteredValue}
              quality={signalQuality}
              isFingerDetected={fingerDetected}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={arrhythmiaDetectedRef.current ? "ARRITMIA DETECTADA|1" : "SIN ARRITMIAS|0"}
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
          <div className="absolute inset-x-0 top-[55%] bottom-[60px] bg-black/10 px-4 py-6">
            <div className="grid grid-cols-3 gap-4 place-items-center">
              <VitalSign 
                label="FRECUENCIA CARDÍACA"
                value={heartRate > 0 ? Math.round(heartRate) : "--"}
                unit="BPM"
                highlighted={showResults}
              />
              <VitalSign 
                label="SPO2"
                value={spo2 > 0 ? spo2 : "--"}
                unit="%"
                highlighted={showResults}
              />
              <VitalSign 
                label="PRESIÓN ARTERIAL"
                value="--/--"
                unit="mmHg"
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
