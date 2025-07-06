import React, { useState, useRef, useEffect } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useHeartBeatProcessor } from "@/hooks/useHeartBeatProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/hooks/use-toast";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
    pressure: "--/--",
    arrhythmiaStatus: "--",
    glucose: 0,
    lipids: {
      totalCholesterol: 0,
      triglycerides: 0
    },
    hemoglobin: 0
  });
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState<VitalSignsResult['calibration']>();
  const measurementTimerRef = useRef<number | null>(null);
  const [lastArrhythmiaData, setLastArrhythmiaData] = useState<{
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  
  // Hooks con manejo de errores
  const { 
    startProcessing, 
    stopProcessing, 
    lastSignal, 
    processFrame, 
    isProcessing, 
    framesProcessed, 
    signalStats, 
    qualityTransitions, 
    isCalibrating: isProcessorCalibrating 
  } = useSignalProcessor();
  
  const { 
    processSignal: processHeartBeat, 
    setArrhythmiaState 
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

  const enterFullScreen = async () => {
    try {
      if (!isFullscreen) {
        const docEl = document.documentElement;
        
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if ((docEl as any).webkitRequestFullscreen) {
          await (docEl as any).webkitRequestFullscreen();
        } else if ((docEl as any).msRequestFullscreen) {
          await (docEl as any).msRequestFullscreen();
        } else if ((docEl as any).mozRequestFullScreen) {
          await (docEl as any).mozRequestFullScreen();
        }
        
        // Bloquear orientación si es dispositivo móvil
        if (screen.orientation && screen.orientation.lock) {
          try {
            await screen.orientation.lock('portrait');
            console.log('Orientación portrait bloqueada');
          } catch (err) {
            console.log('Error al bloquear la orientación:', err);
          }
        }
        
        setIsFullscreen(true);
        console.log("Pantalla completa activada");
      }
    } catch (err) {
      console.log('Error al entrar en pantalla completa:', err);
    }
  };
  
  const exitFullScreen = () => {
    try {
      if (isFullscreen) {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          (document as any).webkitExitFullscreen();
        } else if ((document as any).msExitFullscreen) {
          (document as any).msExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          (document as any).mozCancelFullScreen();
        }
        
        // Desbloquear orientación si es necesario
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
          console.log('Orientación desbloqueada');
        }
        
        setIsFullscreen(false);
      }
    } catch (err) {
      console.log('Error al salir de pantalla completa:', err);
    }
  };
  
  // Activar pantalla completa automáticamente al cargar la página
  useEffect(() => {
    setTimeout(() => {
      enterFullScreen();
    }, 1000); // Pequeño retraso para asegurar que todo está cargado
    
    // Detectar cambios en el estado de pantalla completa
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
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      
      // Asegurarse de salir del modo pantalla completa al desmontar
      exitFullScreen();
    };
  }, []);

  useEffect(() => {
    const preventScroll = (e: Event) => e.preventDefault();
    document.body.addEventListener('touchmove', preventScroll, { passive: false });
    document.body.addEventListener('scroll', preventScroll, { passive: false });

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
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      enterFullScreen();
      setIsMonitoring(true);
      setIsCameraOn(true);
      setShowResults(false);
      
      // Iniciar procesamiento de señal
      startProcessing();
      
      // Resetear valores
      setElapsedTime(0);
      setVitalSigns(prev => ({
        ...prev,
        arrhythmiaStatus: "SIN ARRITMIAS|0"
      }));
      
      // Iniciar calibración automática
      startAutoCalibration();
      
      // Iniciar timer de medición
      measurementTimerRef.current = window.setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
      
      toast({
        title: "Monitoreo iniciado",
        description: "Coloca tu dedo sobre la cámara y mantén la posición",
      });
    }
  };

  const startAutoCalibration = () => {
    setIsCalibrating(true);
    startCalibration();
    
    // Forzar finalización de calibración después de 8 segundos
    setTimeout(() => {
      forceCalibrationCompletion();
      setIsCalibrating(false);
      setCalibrationProgress(getCalibrationProgress());
    }, 8000);
  };

  const finalizeMeasurement = () => {
    setIsMonitoring(false);
    setIsCameraOn(false);
    stopProcessing();
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    // Mostrar resultados finales
    if (lastValidResults) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
    
    toast({
      title: "Medición completada",
      description: "Revisa los resultados obtenidos",
    });
  };

  const handleReset = () => {
    setIsMonitoring(false);
    setIsCameraOn(false);
    setShowResults(false);
    setElapsedTime(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setArrhythmiaCount("--");
    setLastArrhythmiaData(null);
    setRRIntervals([]);
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    stopProcessing();
    resetVitalSigns();
    
    setVitalSigns({
      spo2: 0,
      pressure: "--/--",
      arrhythmiaStatus: "--",
      glucose: 0,
      lipids: {
        totalCholesterol: 0,
        triglycerides: 0
      },
      hemoglobin: 0
    });
    
    toast({
      title: "Sistema reseteado",
      description: "Listo para nueva medición",
    });
  };

  const handleStreamReady = (stream: MediaStream) => {
    console.log("Stream de cámara listo:", stream);
    
    if (isMonitoring) {
      const processImage = async () => {
        try {
          // Crear un canvas para procesar los frames
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const video = document.createElement('video');
          
          video.srcObject = stream;
          video.play();
          
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          
          // Esperar a que el video esté listo
          await new Promise((resolve) => {
            video.onloadedmetadata = resolve;
          });
          
          // Capturar frame
          ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);
          
          if (imageData) {
            // Procesar frame
            processFrame(imageData);
            
            // Procesar señal PPG si está disponible
            if (lastSignal) {
              const heartBeatResult = processHeartBeat(lastSignal.filteredValue);
              setHeartRate(heartBeatResult.bpm);
              setHeartbeatSignal(heartBeatResult.filteredValue);
              setBeatMarker(heartBeatResult.isPeak ? 1 : 0);
              
              // Procesar signos vitales
              const vitalSignsResult = await processVitalSigns(
                lastSignal.filteredValue,
                heartBeatResult.rrData
              );
              
              setVitalSigns(vitalSignsResult);
              setSignalQuality(lastSignal.quality);
              
              // Actualizar datos de arritmia
              if (vitalSignsResult.lastArrhythmiaData) {
                setLastArrhythmiaData(vitalSignsResult.lastArrhythmiaData);
                setArrhythmiaCount(vitalSignsResult.arrhythmiaStatus.split('|')[1] || 0);
              }
              
              // Actualizar intervalos RR
              if (heartBeatResult.rrData?.intervals) {
                setRRIntervals(heartBeatResult.rrData.intervals);
              }
            }
          }
          
          // Limpiar recursos
          video.pause();
          video.srcObject = null;
          
        } catch (error) {
          console.error("Error procesando imagen:", error);
        }
      };
      
      // Procesar frames cada 100ms (10 FPS)
      const frameInterval = setInterval(processImage, 100);
      
      return () => {
        clearInterval(frameInterval);
      };
    }
  };

  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      startMonitoring();
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="bg-gray-900 p-4">
        <h1 className="text-2xl font-bold text-center">HealthPulse Captain</h1>
        <p className="text-center text-gray-400">Monitoreo de Signos Vitales</p>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {/* Camera View */}
        <div className="w-full max-w-md mb-6">
          <CameraView
            onStreamReady={handleStreamReady}
            isMonitoring={isMonitoring}
            isFingerDetected={lastSignal?.fingerDetected || false}
            signalQuality={signalQuality}
          />
        </div>

        {/* Signal Meter */}
        <div className="w-full max-w-md mb-6">
          <PPGSignalMeter
            value={heartbeatSignal}
            quality={signalQuality}
            isFingerDetected={lastSignal?.fingerDetected || false}
            onStartMeasurement={startMonitoring}
            onReset={handleReset}
            arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
            rawArrhythmiaData={lastArrhythmiaData}
            preserveResults={showResults}
          />
        </div>

        {/* Vital Signs Display */}
        <div className="w-full max-w-md mb-6">
          <div className="grid grid-cols-2 gap-4">
            <VitalSign
              label="Frecuencia Cardíaca"
              value={heartRate}
              unit="BPM"
              highlighted={isMonitoring}
              calibrationProgress={calibrationProgress?.progress.heartRate}
            />
            <VitalSign
              label="SpO2"
              value={vitalSigns.spo2}
              unit="%"
              highlighted={isMonitoring}
              calibrationProgress={calibrationProgress?.progress.spo2}
            />
            <VitalSign
              label="Presión Arterial"
              value={vitalSigns.pressure}
              highlighted={isMonitoring}
              calibrationProgress={calibrationProgress?.progress.pressure}
            />
            <VitalSign
              label="Glucosa"
              value={vitalSigns.glucose}
              unit="mg/dL"
              highlighted={isMonitoring}
              calibrationProgress={calibrationProgress?.progress.glucose}
            />
          </div>
        </div>

        {/* Control Buttons */}
        <div className="w-full max-w-md">
          <MonitorButton
            isMonitoring={isMonitoring}
            onToggle={handleToggleMonitoring}
            variant="monitor"
          />
          
          {!isMonitoring && (
            <button
              onClick={handleReset}
              className="w-full mt-4 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              Resetear Sistema
            </button>
          )}
        </div>

        {/* Status Information */}
        <div className="w-full max-w-md mt-6 text-center text-sm text-gray-400">
          <p>Tiempo de medición: {elapsedTime}s</p>
          <p>Frames procesados: {framesProcessed}</p>
          {isCalibrating && <p className="text-yellow-400">Calibrando...</p>}
        </div>
      </main>
    </div>
  );
};

export default Index;
