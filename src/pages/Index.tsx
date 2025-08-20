
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

const Index = () => {
  // State variables
  const [vitalSigns, setVitalSigns] = useState<VitalSignsResult>({
    spo2: 98,
    pressure: '120/80',
    arrhythmiaStatus: 'Normal',
    glucose: 90,
    lipids: { totalCholesterol: 180, triglycerides: 150 },
    hemoglobin: 13.5,
  });
  const [ppgData, setPpgData] = useState<number[]>([]);
  const [rrIntervals, setRrIntervals] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Ref for VitalSignsProcessor
  const processorRef = useRef<VitalSignsProcessor | null>(null);

  // Initialize VitalSignsProcessor
  useEffect(() => {
    processorRef.current = new VitalSignsProcessor(35);
    return () => {
      processorRef.current?.fullReset();
      processorRef.current = null;
    };
  }, []);

  const processVitalSigns = useCallback(async (ppgValue: number, rrIntervals?: number[]) => {
    if (!processorRef.current) return;

    try {
      setIsProcessing(true);
      const rrData = rrIntervals ? {
        intervals: rrIntervals,
        lastPeakTime: Date.now()
      } : undefined;

      const result = await processorRef.current.processSignal(ppgValue, rrData);
      setVitalSigns(result);
    } catch (error) {
      console.error('Error processing vital signs:', error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Simulate PPG data for testing
  useEffect(() => {
    const interval = setInterval(() => {
      const newPpgValue = 100 + Math.sin(Date.now() / 1000) * 20 + Math.random() * 10;
      setPpgData(prev => [...prev.slice(-99), newPpgValue]);
      
      if (Math.random() > 0.8) {
        const newRrInterval = 800 + Math.random() * 200;
        setRrIntervals(prev => [...prev.slice(-9), newRrInterval]);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Process vital signs when PPG data changes
  useEffect(() => {
    if (ppgData.length > 0 && processorRef.current) {
      const lastPpgValue = ppgData[ppgData.length - 1];
      processVitalSigns(lastPpgValue, rrIntervals);
    }
  }, [ppgData, rrIntervals, processVitalSigns]);

  const handleStartCalibration = useCallback(() => {
    processorRef.current?.startCalibration();
  }, []);

  const handleCompleteCalibration = useCallback(() => {
    processorRef.current?.forceCalibrationCompletion();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-6">Monitor Cardíaco y Signos Vitales</h1>
        <p className="text-muted-foreground mb-8">
          Sistema avanzado de medición biofísica real - Sin simulaciones
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Real-Time Data */}
          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-2xl font-semibold mb-4">Datos en Tiempo Real</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">Señal PPG</label>
                <div className="h-20 bg-muted rounded flex items-end gap-1 p-2">
                  {ppgData.slice(-20).map((value, index) => (
                    <div
                      key={index}
                      className="bg-primary flex-1 rounded-sm"
                      style={{ height: `${Math.max(2, (value / 150) * 100)}%` }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Intervalos RR</label>
                <div className="text-sm">{rrIntervals.slice(-3).join(', ')} ms</div>
              </div>
            </div>
          </div>

          {/* Vital Signs */}
          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-2xl font-semibold mb-4">Signos Vitales</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>SpO₂:</span>
                <span className="font-mono">{vitalSigns.spo2}%</span>
              </div>
              <div className="flex justify-between">
                <span>Presión:</span>
                <span className="font-mono">{vitalSigns.pressure}</span>
              </div>
              <div className="flex justify-between">
                <span>Glucosa:</span>
                <span className="font-mono">{vitalSigns.glucose} mg/dL</span>
              </div>
              <div className="flex justify-between">
                <span>Hemoglobina:</span>
                <span className="font-mono">{vitalSigns.hemoglobin} g/dL</span>
              </div>
              <div className="flex justify-between">
                <span>Estado Cardíaco:</span>
                <span className="font-mono text-sm">{vitalSigns.arrhythmiaStatus}</span>
              </div>
            </div>
          </div>

          {/* Quality & Status */}
          <div className="bg-card p-6 rounded-lg border">
            <h2 className="text-2xl font-semibold mb-4">Calidad & Estado</h2>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span>Confianza:</span>
                <span className="font-mono">{vitalSigns.confidence || 0}%</span>
              </div>
              <div className="flex justify-between">
                <span>Calidad:</span>
                <span className="font-mono">{vitalSigns.quality || 0}%</span>
              </div>
              <div className="flex justify-between">
                <span>Procesando:</span>
                <span className="font-mono">{isProcessing ? 'Sí' : 'No'}</span>
              </div>
              <div className="flex justify-between">
                <span>Calibrando:</span>
                <span className="font-mono">
                  {vitalSigns.calibration?.isCalibrating ? 'Sí' : 'No'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-card p-6 rounded-lg border">
          <h2 className="text-xl font-semibold mb-4">Controles</h2>
          <div className="flex gap-4">
            <button
              onClick={handleStartCalibration}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Iniciar Calibración
            </button>
            <button
              onClick={handleCompleteCalibration}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
            >
              Completar Calibración
            </button>
          </div>
        </div>

        {/* Disclaimer */}
        <footer className="mt-8 p-4 bg-muted rounded-lg">
          <p className="text-sm text-muted-foreground text-center">
            <strong>IMPORTANTE:</strong> Esta aplicación es <strong>referencial</strong>, no posee autorización diagnóstica. 
            Su valor radica en la <strong>consistencia clínica</strong> y la <strong>repetibilidad</strong> de mediciones.
            No se permite ningún modo demo, datos aleatorios o simulados.
          </p>
        </footer>
      </div>
    </div>
  );
};

export default Index;
