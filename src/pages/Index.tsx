import React, { useState, useRef, useEffect, useCallback } from "react";
import VitalSign from "@/components/VitalSign";
import CameraView from "@/components/CameraView";
import { useSignalProcessor } from "@/hooks/useSignalProcessor";
import { useVitalSignsProcessor } from "@/hooks/useVitalSignsProcessor";
import PPGSignalMeter from "@/components/PPGSignalMeter";
import MonitorButton from "@/components/MonitorButton";
import { VitalSignsResult } from "@/modules/vital-signs/VitalSignsProcessor";
import { toast } from "@/components/ui/use-toast";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [signalQuality, setSignalQuality] = useState(0);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
    pressure: {
      systolic: 0,
      diastolic: 0
    },
    arrhythmiaStatus: "--",
    arrhythmiaCount: 0,
    glucose: 0,
    lipids: {
      totalCholesterol: 0,
      triglycerides: 0
    },
    hemoglobin: 0,
    isCalibrating: false,
    calibrationProgress: 0
  });
  const [heartRate, setHeartRate] = useState(0);
  const [heartbeatSignal, setHeartbeatSignal] = useState(0);
  const [beatMarker, setBeatMarker] = useState(0);
  const [arrhythmiaCount, setArrhythmiaCount] = useState<string | number>("--");
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState<{
    isCalibrating: boolean;
    progress: {
      heartRate: number;
      spo2: number;
      pressure: number;
      arrhythmia: number;
      glucose: number;
      lipids: number;
      hemoglobin: number;
    };
  }>();
  const measurementTimerRef = useRef<number | null>(null);
  const [lastArrhythmiaData, setLastArrhythmiaData] = useState<{
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rrIntervals, setRRIntervals] = useState<number[]>([]);
  
  // Usar el nuevo sistema multicanal
  const { handleSample, lastResult, adjustChannelGain } = useSignalProcessor(8, 6);

  const { 
    processSignal: processVitalSigns, 
    reset: resetVitalSigns,
    fullReset: fullResetVitalSigns,
    lastValidResults,
    startCalibration,
    forceCalibrationCompletion,
    getCalibrationProgress
  } = useVitalSignsProcessor();

  // Efecto para procesar los resultados del nuevo sistema multicanal
  useEffect(() => {
    if (lastResult) {
      // Actualizar calidad de señal
      setSignalQuality(lastResult.aggregatedQuality);
      
      // Actualizar frecuencia cardíaca si está disponible
      if (lastResult.aggregatedBPM) {
        setHeartRate(lastResult.aggregatedBPM);
        
        // Procesar con el sistema de signos vitales existente
        if (lastResult.fingerDetected) {
          // Simular señal PPG para mantener compatibilidad
          const simulatedPPGValue = lastResult.aggregatedQuality * 2.5; // Escalar calidad a valor PPG
          processVitalSigns(simulatedPPGValue);
        }
      }
      
      // Actualizar estado de detección de dedo
      if (lastResult.fingerDetected !== isCameraOn) {
        setIsCameraOn(lastResult.fingerDetected);
      }
      
      // Extraer intervalos RR del mejor canal
      const bestChannel = lastResult.channels.reduce((best, current) => 
        current.quality > best.quality ? current : best
      );
      
      if (bestChannel.rrIntervals.length > 0) {
        setRRIntervals(bestChannel.rrIntervals);
      }
    }
  }, [lastResult, isCameraOn, processVitalSigns]);

  const enterFullScreen = async () => {
    if (isFullscreen) return;
    try {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
      }
      setIsFullscreen(true);
    } catch (err) {
      console.log('Fullscreen no disponible:', err);
    }
  };
  
  const exitFullScreen = () => {
    if (!isFullscreen) return;
    try {
        if (document.exitFullscreen) {
          document.exitFullscreen();
      }
      setIsFullscreen(false);
    } catch (err) {
      console.log('Exit fullscreen error:', err);
    }
  };
  
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(isCurrentlyFullscreen);
      
      if (!isCurrentlyFullscreen && isMonitoring) {
        finalizeMeasurement();
      }
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    
    const preventScroll = (e: Event) => e.preventDefault();
    
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
      document.addEventListener('touchmove', preventScroll, { passive: false });
      document.addEventListener('scroll', preventScroll, { passive: false });
    } else {
      document.body.style.overflow = '';
      document.removeEventListener('touchmove', preventScroll);
      document.removeEventListener('scroll', preventScroll);
    }
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('touchmove', preventScroll);
      document.removeEventListener('scroll', preventScroll);
    };
  }, [isFullscreen, isMonitoring]);

  useEffect(() => {
    if (lastValidResults && !isMonitoring) {
      setVitalSigns(lastValidResults);
      setShowResults(true);
    }
  }, [lastValidResults, isMonitoring]);

  const startMonitoring = () => {
    if (isMonitoring) {
      return;
    }
    
      enterFullScreen();
      setIsMonitoring(true);
      setIsCameraOn(true);
      setShowResults(false);
      
      // Resetear valores
      setElapsedTime(0);
      setVitalSigns(prev => ({
        ...prev,
      arrhythmiaStatus: "SIN ARRITMIAS|0",
      arrhythmiaCount: 0
      }));
      
      // Iniciar calibración automática
      console.log("Iniciando fase de calibración automática");
      startAutoCalibration();
      
      // Iniciar temporizador para medición
      if (measurementTimerRef.current) {
        clearInterval(measurementTimerRef.current);
      }
      
      measurementTimerRef.current = window.setInterval(() => {
        setElapsedTime(prev => {
          const newTime = prev + 1;
          console.log(`Tiempo transcurrido: ${newTime}s`);
          
          // Finalizar medición después de 30 segundos
          if (newTime >= 30) {
            finalizeMeasurement();
            return 30;
          }
          return newTime;
        });
      }, 1000);
  };

  const startAutoCalibration = () => {
    setIsCalibrating(true);
    setCalibrationProgress({
      isCalibrating: true,
      progress: {
        heartRate: 0,
        spo2: 0,
        pressure: 0,
        arrhythmia: 0,
        glucose: 0,
        lipids: 0,
        hemoglobin: 0
      }
    });
    
    setTimeout(() => {
    startCalibration();
    }, 100);
  };

  const finalizeMeasurement = () => {
    console.log("Finalizando medición");
    
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setIsCalibrating(false);
    
    forceCalibrationCompletion();
    
    setShowResults(true);
    
    toast({
      title: "Medición completada",
      description: "Los resultados están listos para revisar",
      duration: 3000,
    });
    
    exitFullScreen();
  };

  const handleReset = () => {
    if (measurementTimerRef.current) {
      clearInterval(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    setIsMonitoring(false);
    setIsCameraOn(false);
    setIsCalibrating(false);
    setShowResults(false);
    setElapsedTime(0);
    setSignalQuality(0);
    setHeartRate(0);
    setHeartbeatSignal(0);
    setBeatMarker(0);
    setArrhythmiaCount("--");
    setVitalSigns({ 
      spo2: 0,
      pressure: {
        systolic: 0,
        diastolic: 0
      },
      arrhythmiaStatus: "--",
      arrhythmiaCount: 0,
      glucose: 0,
      lipids: {
        totalCholesterol: 0,
        triglycerides: 0
      },
      hemoglobin: 0,
      isCalibrating: false,
      calibrationProgress: 0
    });
    setSignalQuality(0);
    setLastArrhythmiaData(null);
    setCalibrationProgress(undefined);
    
    fullResetVitalSigns();
    exitFullScreen();
  };

  // MANEJAR PICO DETECTADO DESDE EL MONITOR CARDIACO (PPGSignalMeter)
  const handlePeakDetected = useCallback((peak: {time: number, value: number, isArrhythmia: boolean, bpm: number}) => {
    console.log('Index.tsx: Pico detectado por PPGSignalMeter', peak);
    
    // ACTUALIZAR BPM EN TIEMPO REAL
    if (peak.bpm > 0) {
      setHeartRate(peak.bpm);
    }
    
    // NOTIFICAR LATIDO DETECTADO (BEEP + VIBRACIÓN)
    try {
      // BEEP SONORO
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
      
      // VIBRACIÓN EN MÓVILES
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    } catch (error) {
      console.log('Audio/vibración no disponible:', error);
    }
    
    // ACTUALIZAR ARRITMIAS SI SE DETECTAN
    if (peak.isArrhythmia) {
      const currentCount = typeof arrhythmiaCount === 'string' ? 0 : arrhythmiaCount;
      const newCount = currentCount + 1;
      setArrhythmiaCount(newCount);
      
      setVitalSigns(prev => ({
        ...prev,
        arrhythmiaStatus: `ARRITMIA DETECTADA|${newCount}`
      }));
      
      setLastArrhythmiaData({
        timestamp: peak.time,
        rmssd: peak.value,
        rrVariation: Math.abs(peak.value - 800) / 800
      });
      
      console.log('Index.tsx: Arritmia detectada', { newCount, peak });
    }
    
    // ACTUALIZAR SEÑAL PPG PARA EL GRÁFICO
    setHeartbeatSignal(peak.value);
    setBeatMarker(peak.time);
  }, [arrhythmiaCount]);

  const handleStreamReady = (stream: MediaStream) => {
    console.log('Stream de cámara listo:', stream);
  };

  useEffect(() => {
    if (!isCalibrating) return;
    
    const interval = setInterval(() => {
      const progressValue = getCalibrationProgress();
      
      if (progressValue >= 100) {
        clearInterval(interval);
        setIsCalibrating(false);
        setCalibrationProgress({
          isCalibrating: false,
          progress: {
            heartRate: 100,
            spo2: 100,
            pressure: 100,
            arrhythmia: 100,
            glucose: 100,
            lipids: 100,
            hemoglobin: 100
          }
        });
      } else {
        setCalibrationProgress({
          isCalibrating: true,
          progress: {
            heartRate: progressValue,
            spo2: progressValue,
            pressure: progressValue,
            arrhythmia: progressValue,
            glucose: progressValue,
            lipids: progressValue,
            hemoglobin: progressValue
          }
        });
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isCalibrating, getCalibrationProgress]);

  const handleToggleMonitoring = () => {
    if (isMonitoring) {
      finalizeMeasurement();
    } else {
      startMonitoring();
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-black" style={{ 
      minHeight: isFullscreen ? '100dvh' : '100vh',
      height: isFullscreen ? '100dvh' : '100vh'
    }}>
      {/* Header - Solo visible cuando NO está en fullscreen */}
      {!isFullscreen && (
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4 shadow-lg">
          <div className="max-w-4xl mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold">HealthPulse Captain</h1>
            <div className="flex items-center gap-4">
              <div className="text-sm">
                Tiempo: {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
              </div>
              <MonitorButton 
                isMonitoring={isMonitoring}
                onToggle={handleToggleMonitoring}
              />
            </div>
          </div>
        </div>
      )}

      {/* Área principal */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Panel izquierdo - Signos vitales */}
        {(!isFullscreen || showResults) && (
          <div className="w-full lg:w-80 bg-gray-50 border-r border-gray-200 overflow-y-auto">
            <div className="p-4">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">Signos Vitales</h2>
              
              {/* Signos vitales principales */}
              <div className="space-y-3">
                <VitalSign 
                  label="SpO₂" 
                  value={vitalSigns.spo2} 
                  unit="%" 
                  highlighted={true}
                  calibrationProgress={calibrationProgress?.progress.spo2}
                />
                
                <VitalSign 
                  label="Frecuencia Cardíaca" 
                  value={heartRate} 
                  unit="BPM" 
                  highlighted={true}
                  calibrationProgress={calibrationProgress?.progress.heartRate}
                />
                
                <VitalSign 
                  label="Presión Arterial" 
                  value={`${vitalSigns.pressure.systolic}/${vitalSigns.pressure.diastolic}`} 
                  unit="mmHg"
                  calibrationProgress={calibrationProgress?.progress.pressure}
                />
                
                <VitalSign 
                  label="Arritmias" 
                  value={vitalSigns.arrhythmiaStatus}
                  calibrationProgress={calibrationProgress?.progress.arrhythmia}
                />
                
                <VitalSign 
                  label="Glucosa" 
                  value={vitalSigns.glucose} 
                  unit="mg/dL"
                  calibrationProgress={calibrationProgress?.progress.glucose}
                />
                
                <VitalSign 
                  label="Colesterol Total" 
                  value={vitalSigns.lipids.totalCholesterol} 
                  unit="mg/dL"
                  calibrationProgress={calibrationProgress?.progress.lipids}
                />
                
                <VitalSign 
                  label="Triglicéridos" 
                  value={vitalSigns.lipids.triglycerides} 
                  unit="mg/dL"
                  calibrationProgress={calibrationProgress?.progress.lipids}
                />
                
                <VitalSign 
                  label="Hemoglobina" 
                  value={vitalSigns.hemoglobin} 
                  unit="g/dL"
                  calibrationProgress={calibrationProgress?.progress.hemoglobin}
                />
              </div>

              {/* Estado de calibración */}
              {isCalibrating && calibrationProgress && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h3 className="text-sm font-medium text-blue-900 mb-2">Calibrando Sensores</h3>
                  <div className="text-xs text-blue-700">
                    <div>Frecuencia Cardíaca: {calibrationProgress.progress.heartRate.toFixed(0)}%</div>
                    <div>SpO₂: {calibrationProgress.progress.spo2.toFixed(0)}%</div>
                    <div>Presión: {calibrationProgress.progress.pressure.toFixed(0)}%</div>
                  </div>
                </div>
              )}

              {/* Botones de control */}
              <div className="mt-6 space-y-2">
                <MonitorButton 
                  isMonitoring={isMonitoring}
                  onToggle={handleToggleMonitoring}
                  className="w-full"
                />
                
                <MonitorButton 
                  isMonitoring={false}
                  onToggle={handleReset}
                  variant="reset"
                  className="w-full"
                />
              </div>
            </div>
          </div>
      )}

        {/* Panel derecho - Cámara y gráfico */}
      <div className="flex-1 relative">
        <div className="absolute inset-0">
            {/* CameraView con el nuevo sistema multicanal */}
          <CameraView 
            onStreamReady={handleStreamReady}
              onSample={handleSample}
              isMonitoring={isMonitoring}
              targetFps={30}
              roiSize={200}
              enableTorch={true}
              coverageThresholdPixelBrightness={30}
          />
        </div>

        <div className="relative z-10 h-full flex flex-col">
            {/* Header para sensor de calidad y estado de huella digital */}
          <div className="px-4 py-2 flex justify-around items-center bg-black/20">
            <div className="text-white text-lg">
              Calidad: {signalQuality}
            </div>
            <div className="text-white text-lg">
                {lastResult?.fingerDetected ? "Huella Detectada" : "Huella No Detectada"}
            </div>
          </div>
          {/* Panel de estado */}
          <div className="px-4 py-1 flex justify-around items-center bg-black/10 text-white text-sm">
              <div>Procesando: {isMonitoring ? 'Sí' : 'No'}</div>
              <div>Canales: {lastResult?.channels?.length || 0}</div>
              <div>Calibrando: {isCalibrating ? 'Sí' : 'No'}</div>
          </div>
          {/* Panel de debug */}
          <details className="px-4 bg-black/10 text-white text-xs overflow-auto max-h-40">
              <summary className="cursor-pointer">Debug Multicanal</summary>
            <pre className="whitespace-pre-wrap text-xs">
                {JSON.stringify(lastResult, null, 2)}
            </pre>
          </details>
            
          <div className="flex-1">
                          <PPGSignalMeter 
                value={lastResult?.aggregatedQuality || 0}
                quality={lastResult?.aggregatedQuality || 0}
                isFingerDetected={lastResult?.fingerDetected || false}
                onStartMeasurement={startMonitoring}
                onReset={handleReset}
                arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
                rawArrhythmiaData={lastArrhythmiaData}
                preserveResults={showResults}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;