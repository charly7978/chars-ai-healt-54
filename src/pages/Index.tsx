import React, { useState, useRef, useEffect, useCallback } from "react";
import VitalSign from "@/components/VitalSign";
import PPGMonitor from "@/components/PPGMonitor";
import CameraPreview from "@/components/CameraPreview";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  // Estado principal
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [signalQuality, setSignalQuality] = useState(0);
  const [fingerDetected, setFingerDetected] = useState(false);
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  
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
  
  // Referencias
  const measurementTimerRef = useRef<number | null>(null);
  const lastArrhythmiaData = useRef<{ timestamp: number; rmssd: number; rrVariation: number; } | null>(null);
  const arrhythmiaDetectedRef = useRef(false);
  
  // Hooks
  const { 
    processSignal: processVitalSigns, 
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion
  } = useVitalSignsProcessor();

  // Pantalla completa
  const enterFullScreen = async () => {
    if (isFullscreen) return;
    
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if ((docEl as any).webkitRequestFullscreen) {
        await (docEl as any).webkitRequestFullscreen();
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

  // Prevenir scroll
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

  // Sincronización de resultados
  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  // Procesamiento de datos PPG
  const handlePPGData = useCallback((data: {
    redValue: number;
    signalValue: number;
    quality: number;
    fingerDetected: boolean;
    bpm: number;
    isPeak: boolean;
    rrIntervals: number[];
  }) => {
    setHeartbeatSignal(data.signalValue);
    setSignalQuality(data.quality);
    setFingerDetected(data.fingerDetected);
    setHeartRate(data.bpm);
    setBeatMarker(data.isPeak ? 1 : 0);
    
    // Procesar signos vitales si hay dedo y suficientes intervalos RR
    if (data.fingerDetected && data.rrIntervals.length >= 3) {
      const rrData = {
        intervals: data.rrIntervals,
        lastPeakTime: Date.now()
      };
      
      const vitals = processVitalSigns(data.signalValue, rrData);
      
      if (vitals) {
        setVitalSigns(vitals);
        
        if (vitals.lastArrhythmiaData) {
          lastArrhythmiaData.current = vitals.lastArrhythmiaData;
          const [status] = vitals.arrhythmiaStatus.split('|');
          
          const isArrhythmiaDetected = status === "ARRITMIA DETECTADA";
          if (isArrhythmiaDetected !== arrhythmiaDetectedRef.current) {
            arrhythmiaDetectedRef.current = isArrhythmiaDetected;
            
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
    }
  }, [processVitalSigns]);

  // Inicio de monitoreo
  const startMonitoring = () => {
    console.log('🚀 Iniciando monitoreo...');
    
    if (navigator.vibrate) {
      navigator.vibrate([200]);
    }
    
    enterFullScreen();
    setShowResults(false);
    setElapsedTime(0);
    setHeartRate(0);
    setSignalQuality(0);
    setVitalSigns(prev => ({ ...prev, arrhythmiaStatus: "SIN ARRITMIAS|0" }));
    
    startCalibration();
    setIsMonitoring(true);
    
    // Timer de medición
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
    
    console.log('✅ Monitoreo activo');
  };

  // Finalización de medición
  const finalizeMeasurement = () => {
    console.log('🛑 Finalizando medición...');
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    forceCalibrationCompletion();
    const savedResults = resetVitalSigns();
    
    setIsMonitoring(false);
    
    if (savedResults) {
      setVitalSigns(savedResults);
      setShowResults(true);
    }
    
    setElapsedTime(0);
    setSignalQuality(0);
    
    console.log('✅ Medición finalizada');
  };

  // Reset completo
  const handleReset = () => {
    console.log('🔄 Reset completo...');
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    fullResetVitalSigns();
    
    setIsMonitoring(false);
    setShowResults(false);
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setSignalQuality(0);
    setFingerDetected(false);
    setCameraStream(null);
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
    
    lastArrhythmiaData.current = null;
    arrhythmiaDetectedRef.current = false;
    
    console.log('✅ Reset completado');
  };

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
      {/* PPG Monitor - Componente que maneja cámara y procesamiento */}
      <PPGMonitor 
        isActive={isMonitoring}
        onData={handlePPGData}
        onCameraReady={() => console.log('📷 Cámara lista')}
        onError={(error) => {
          console.error('❌ Error PPG:', error);
          toast({
            title: "Error de cámara",
            description: error,
            variant: "destructive"
          });
        }}
        onStreamReady={(stream) => {
          console.log('📹 Stream recibido:', stream ? 'activo' : 'null');
          setCameraStream(stream);
        }}
      />
      
      {/* Overlay pantalla completa */}
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
        {/* Preview de cámara */}
        {isMonitoring && (
          <CameraPreview 
            stream={cameraStream}
            signalQuality={signalQuality}
            fingerDetected={fingerDetected}
          />
        )}

        <div className="relative z-10 h-full flex flex-col">
          {/* Header */}
          <div className="px-4 py-2 flex justify-between items-center bg-black/30">
            <div className="text-white text-xl font-bold">
              {isMonitoring ? `${60 - elapsedTime}s` : "LISTO"}
            </div>
            
            {/* Indicador de estado */}
            {isMonitoring && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
                fingerDetected ? 'bg-emerald-500/20' : 'bg-amber-500/20'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  fingerDetected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                }`} />
                <span className={`text-sm font-medium ${
                  fingerDetected ? 'text-emerald-300' : 'text-amber-300'
                }`}>
                  {fingerDetected ? 'Detectando' : 'Coloca el dedo'}
                </span>
              </div>
            )}
          </div>

          {/* Gráfico PPG */}
          <div className="flex-1">
            <PPGSignalMeter 
              value={heartbeatSignal}
              quality={signalQuality}
              isFingerDetected={fingerDetected}
              onStartMeasurement={startMonitoring}
              onReset={handleReset}
              arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              rawArrhythmiaData={lastArrhythmiaData.current}
              preserveResults={showResults}
              isPeak={beatMarker === 1}
            />
          </div>

          {/* Displays de signos vitales */}
          <div className="absolute inset-x-0 top-[55%] bottom-[60px] bg-black/10 px-4 py-6">
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

          {/* Botones */}
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
