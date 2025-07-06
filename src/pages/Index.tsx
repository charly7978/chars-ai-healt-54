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
  const [isFingerDetected, setIsFingerDetected] = useState(false);
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 0,
    pressure: "--/--",
    arrhythmiaStatus: "SIN ARRITMIAS|0",
    glucose: 0,
    lipids: {
      totalCholesterol: 0,
      triglycerides: 0
    },
    hemoglobin: 0,
    confidence: 0,
    signalQuality: 0
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { startProcessing, stopProcessing, lastSignal } = useSignalProcessor();
  const { processSignal, reset: resetHeartBeat } = useHeartBeatProcessor();
  const { processSignal: processVitalSigns, reset: resetVitalSigns } = useVitalSignsProcessor();

  useEffect(() => {
    if (isMonitoring) {
      startProcessing();
    } else {
      stopProcessing();
      resetHeartBeat();
      resetVitalSigns();
    }
  }, [isMonitoring, startProcessing, stopProcessing, resetHeartBeat, resetVitalSigns]);

  const handleStreamReady = (stream: MediaStream) => {
    streamRef.current = stream;
    setIsCameraOn(true);
    console.log("Stream listo para procesamiento");
  };

  const handleStartMeasurement = () => {
    setIsMonitoring(true);
    toast({
      title: "Monitoreo iniciado",
      description: "Coloca tu dedo sobre la cámara trasera",
    });
  };

  const handleStopMeasurement = () => {
    setIsMonitoring(false);
    setIsCameraOn(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    toast({
      title: "Monitoreo detenido",
      description: "Medición finalizada",
    });
  };

  const handleReset = () => {
    setIsMonitoring(false);
    setIsCameraOn(false);
    setSignalQuality(0);
    setIsFingerDetected(false);
    setVitalSigns({
      spo2: 0,
      pressure: "--/--",
      arrhythmiaStatus: "SIN ARRITMIAS|0",
      glucose: 0,
      lipids: {
        totalCholesterol: 0,
        triglycerides: 0
      },
      hemoglobin: 0,
      confidence: 0,
      signalQuality: 0
    });
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    resetHeartBeat();
    resetVitalSigns();
  };

  // Procesar señal cuando esté disponible
  useEffect(() => {
    if (lastSignal && isMonitoring) {
      setIsFingerDetected(lastSignal.fingerDetected);
      setSignalQuality(lastSignal.quality / 100);

      if (lastSignal.fingerDetected && lastSignal.quality > 30) {
        // Procesar señal de latido
        const heartBeatResult = processSignal(lastSignal.filteredValue);
        
        // Procesar signos vitales
        processVitalSigns(lastSignal.filteredValue).then((vitalSignsResult) => {
          setVitalSigns(vitalSignsResult);
        });
      }
    }
  }, [lastSignal, isMonitoring, processSignal, processVitalSigns]);

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="text-center mb-8">
          <h1 className="text-4xl font-bold text-green-400 mb-2">
            HealthPulse Captain
          </h1>
          <p className="text-gray-400">
            Monitoreo avanzado de signos vitales con IA
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Panel izquierdo - Cámara y controles */}
          <div className="space-y-6">
            {/* Vista de cámara */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">Vista de Cámara</h2>
              <CameraView
                onStreamReady={handleStreamReady}
                isMonitoring={isMonitoring}
                isFingerDetected={isFingerDetected}
                signalQuality={signalQuality}
              />
            </div>

            {/* Medidor de señal PPG */}
            <div className="bg-gray-900 rounded-lg p-4">
              <PPGSignalMeter
                value={signalQuality}
                quality={signalQuality}
                isFingerDetected={isFingerDetected}
                onStartMeasurement={handleStartMeasurement}
                onReset={handleReset}
                                 arrhythmiaStatus={vitalSigns.arrhythmiaStatus}
              />
            </div>

            {/* Controles */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">Controles</h2>
              <div className="flex gap-4">
                <MonitorButton
                  isMonitoring={isMonitoring}
                  onToggle={isMonitoring ? handleStopMeasurement : handleStartMeasurement}
                  variant="monitor"
                />
                <MonitorButton
                  isMonitoring={false}
                  onToggle={handleReset}
                  variant="reset"
                />
              </div>
            </div>
          </div>

          {/* Panel derecho - Signos vitales */}
          <div className="space-y-6">
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">Signos Vitales</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 <VitalSign
                   label="SpO2"
                   value={vitalSigns.spo2}
                   unit="%"
                   highlighted={isMonitoring && vitalSigns.spo2 > 0}
                   normalRange={{ min: 95, max: 100 }}
                 />
                 <VitalSign
                   label="Presión Arterial"
                   value={vitalSigns.pressure}
                   highlighted={isMonitoring && vitalSigns.pressure !== "--/--"}
                 />
                 <VitalSign
                   label="Glucosa"
                   value={vitalSigns.glucose}
                   unit="mg/dL"
                   highlighted={isMonitoring && vitalSigns.glucose > 0}
                   normalRange={{ min: 70, max: 110 }}
                 />
                 <VitalSign
                   label="Colesterol Total"
                   value={vitalSigns.lipids.totalCholesterol}
                   unit="mg/dL"
                   highlighted={isMonitoring && vitalSigns.lipids.totalCholesterol > 0}
                   normalRange={{ min: 130, max: 200 }}
                 />
                 <VitalSign
                   label="Triglicéridos"
                   value={vitalSigns.lipids.triglycerides}
                   unit="mg/dL"
                   highlighted={isMonitoring && vitalSigns.lipids.triglycerides > 0}
                   normalRange={{ min: 50, max: 150 }}
                 />
                 <VitalSign
                   label="Hemoglobina"
                   value={vitalSigns.hemoglobin}
                   unit="g/dL"
                   highlighted={isMonitoring && vitalSigns.hemoglobin > 0}
                   normalRange={{ min: 12, max: 16 }}
                 />
                <VitalSign
                  label="Confianza"
                  value={Math.round(vitalSigns.confidence * 100)}
                  unit="%"
                  highlighted={vitalSigns.confidence > 0.7}
                />
              </div>
            </div>

            {/* Estado del sistema */}
            <div className="bg-gray-900 rounded-lg p-4">
              <h2 className="text-xl font-semibold mb-4">Estado del Sistema</h2>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Cámara:</span>
                  <span className={isCameraOn ? "text-green-400" : "text-red-400"}>
                    {isCameraOn ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Monitoreo:</span>
                  <span className={isMonitoring ? "text-green-400" : "text-red-400"}>
                    {isMonitoring ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Dedo detectado:</span>
                  <span className={isFingerDetected ? "text-green-400" : "text-red-400"}>
                    {isFingerDetected ? "Sí" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Calidad de señal:</span>
                  <span className={signalQuality > 0.5 ? "text-green-400" : signalQuality > 0.2 ? "text-yellow-400" : "text-red-400"}>
                    {Math.round(signalQuality * 100)}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
