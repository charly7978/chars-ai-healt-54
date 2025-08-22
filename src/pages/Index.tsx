
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heart, Play, Square, RotateCcw } from "lucide-react";
import CameraView from '@/components/CameraView';
import PPGSignalMeter from '@/components/PPGSignalMeter';
import { useSignalProcessor } from '@/hooks/useSignalProcessor';
import { useVitalMeasurement } from '@/hooks/useVitalMeasurement';
import { toast } from "sonner";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [measurementDuration, setMeasurementDuration] = useState(0);
  
  // TIMER EXTENDIDO A 40 SEGUNDOS como solicité
  const MEASUREMENT_DURATION = 40; // 40 segundos
  
  const measurementTimerRef = useRef<NodeJS.Timeout | null>(null);
  const measurementStartTimeRef = useRef<number | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isComponentMountedRef = useRef(true);

  // HOOKS ESPECIALIZADOS
  const { handleSample, lastResult, reset: resetSignalProcessor, getStats, cleanup } = useSignalProcessor(8, 6);
  const { 
    measurements, 
    reset: resetVitalMeasurement, 
    getVitalSigns,
    arrhythmiaStatus,
    rawArrhythmiaData
  } = useVitalMeasurement();

  // CLEANUP CRÍTICO COMPLETO
  const performSystemCleanup = useCallback(() => {
    console.log('🧹 SYSTEM CLEANUP INTEGRAL iniciado...');
    
    // CLEAR todos los timers
    if (measurementTimerRef.current) {
      clearTimeout(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    
    // RESET hooks especializados
    try {
      resetSignalProcessor();
      resetVitalMeasurement();
      cleanup();
    } catch (error) {
      console.error('❌ Error durante cleanup de hooks:', error);
    }
    
    // RESET estados UI
    setIsMonitoring(false);
    setMeasurementDuration(0);
    measurementStartTimeRef.current = null;
    
    console.log('✅ SYSTEM CLEANUP INTEGRAL completado');
  }, [resetSignalProcessor, resetVitalMeasurement, cleanup]);

  // INICIAR MEDICIÓN MEJORADO
  const startMeasurement = useCallback(() => {
    console.log('🚀 Iniciando medición de 40 segundos...');
    
    // CLEANUP preventivo
    performSystemCleanup();
    
    if (!isComponentMountedRef.current) {
      console.warn('⚠️ Componente no montado, cancelando inicio');
      return;
    }
    
    setIsMonitoring(true);
    setIsFullscreen(true);
    setMeasurementDuration(0);
    measurementStartTimeRef.current = Date.now();
    
    // TIMER de progreso cada segundo
    durationTimerRef.current = setInterval(() => {
      if (!isComponentMountedRef.current) {
        if (durationTimerRef.current) clearInterval(durationTimerRef.current);
        return;
      }
      
      const elapsed = measurementStartTimeRef.current 
        ? Math.floor((Date.now() - measurementStartTimeRef.current) / 1000)
        : 0;
      
      setMeasurementDuration(elapsed);
      
      if (elapsed >= MEASUREMENT_DURATION) {
        console.log('⏰ Medición completada automáticamente (40s)');
        stopMeasurement();
      }
    }, 1000);
    
    toast.success('Medición iniciada - 40 segundos', {
      description: 'Mantenga el dedo estable sobre la cámara'
    });
    
    console.log('✅ Medición iniciada exitosamente');
  }, [performSystemCleanup]);

  // DETENER MEDICIÓN MEJORADO
  const stopMeasurement = useCallback(() => {
    console.log('🛑 Deteniendo medición...');
    
    if (!isComponentMountedRef.current) {
      console.warn('⚠️ Componente no montado durante stop');
      return;
    }
    
    // CLEAR timers PRIMERO
    if (measurementTimerRef.current) {
      clearTimeout(measurementTimerRef.current);
      measurementTimerRef.current = null;
    }
    
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    
    // CALCULAR duración real
    const actualDuration = measurementStartTimeRef.current 
      ? Math.floor((Date.now() - measurementStartTimeRef.current) / 1000)
      : measurementDuration;
    
    setIsMonitoring(false);
    setIsFullscreen(false);
    measurementStartTimeRef.current = null;
    
    // MOSTRAR resultados
    const stats = getStats();
    const vitals = getVitalSigns();
    
    console.log('📊 Resultados finales:', {
      duration: actualDuration + 's',
      stats,
      vitals
    });
    
    toast.success(`Medición completada (${actualDuration}s)`, {
      description: stats ? 
        `BPM: ${stats.aggregatedBPM || 'N/A'}, Calidad: ${lastResult?.aggregatedQuality || 0}%` : 
        'Datos procesados'
    });
    
    console.log('✅ Medición detenida exitosamente');
  }, [measurementDuration, getStats, getVitalSigns, lastResult]);

  // RESET COMPLETO
  const handleReset = useCallback(() => {
    console.log('🔄 RESET COMPLETO del sistema...');
    
    // STOP medición si está activa
    if (isMonitoring) {
      stopMeasurement();
    }
    
    // CLEANUP integral después de un breve delay
    setTimeout(() => {
      if (isComponentMountedRef.current) {
        performSystemCleanup();
        toast.info('Sistema reiniciado completamente');
      }
    }, 100);
    
    console.log('✅ RESET COMPLETO ejecutado');
  }, [isMonitoring, stopMeasurement, performSystemCleanup]);

  // PANTALLA COMPLETA INMERSIVA OPTIMIZADA
  useEffect(() => {
    const enterFullscreen = async () => {
      if (isFullscreen && document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen();
          
          // ORIENTACIÓN de pantalla para móviles
          if (screen.orientation?.lock) {
            try {
              await screen.orientation.lock('portrait');
            } catch (e) {
              console.log('No se pudo bloquear orientación:', e);
            }
          }
          
          console.log('📱 Fullscreen inmersivo activado');
        } catch (e) {
          console.log('No se pudo entrar en fullscreen:', e);
        }
      }
    };

    const exitFullscreen = async () => {
      if (!isFullscreen && document.fullscreenElement) {
        try {
          await document.exitFullscreen();
          
          if (screen.orientation?.unlock) {
            screen.orientation.unlock();
          }
          
          console.log('📱 Fullscreen desactivado');
        } catch (e) {
          console.log('No se pudo salir de fullscreen:', e);
        }
      }
    };

    if (isFullscreen) {
      enterFullscreen();
    } else {
      exitFullscreen();
    }
  }, [isFullscreen]);

  // CLEANUP al desmontar
  useEffect(() => {
    isComponentMountedRef.current = true;
    
    return () => {
      console.log('🗑️ Index component desmontando...');
      isComponentMountedRef.current = false;
      performSystemCleanup();
    };
  }, [performSystemCleanup]);

  // UI RESPONSIVA Y OPTIMIZADA
  if (isFullscreen && isMonitoring) {
    return (
      <div className="fixed inset-0 bg-black">
        <CameraView
          isMonitoring={isMonitoring}
          onSample={handleSample}
          targetFps={30}
          roiSize={200}
          enableTorch={true}
          coverageThresholdPixelBrightness={25}
        />
        <PPGSignalMeter
          value={lastResult?.channels[0]?.calibratedSignal?.[0] || 0}
          quality={lastResult?.aggregatedQuality || 0}
          isFingerDetected={lastResult?.fingerDetected || false}
          onStartMeasurement={startMeasurement}
          onReset={handleReset}
          arrhythmiaStatus={arrhythmiaStatus}
          rawArrhythmiaData={rawArrhythmiaData}
          preserveResults={true}
          snr={lastResult?.channels[0]?.snr || 0}
          isMonitoring={isMonitoring}
        />
        
        {/* PROGRESO COMPACTO EN ESQUINA SUPERIOR DERECHA */}
        <div className="absolute top-2 right-2 bg-black/40 backdrop-blur-sm rounded-lg p-2 z-20">
          <div className="text-white text-xs font-medium mb-1">
            {measurementDuration}s / {MEASUREMENT_DURATION}s
          </div>
          <div className="w-16 h-1 bg-white/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-400 to-green-400 transition-all duration-1000"
              style={{ width: `${(measurementDuration / MEASUREMENT_DURATION) * 100}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // PANTALLA PRINCIPAL OPTIMIZADA
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* HEADER MEJORADO */}
        <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Heart className="h-8 w-8 text-red-500 animate-pulse" />
                <div>
                  <h1 className="text-2xl font-bold text-white">Monitor Cardíaco PPG</h1>
                  <p className="text-sm text-white/70">Sistema avanzado de signos vitales</p>
                </div>
              </div>
              
              {/* STATS EN TIEMPO REAL */}
              {lastResult && (
                <div className="text-right text-white/80">
                  <div className="text-lg font-bold">
                    {lastResult.aggregatedBPM ? `${lastResult.aggregatedBPM} BPM` : '--'}
                  </div>
                  <div className="text-sm">
                    Calidad: {lastResult.aggregatedQuality}%
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* CONTROLES PRINCIPALES */}
        <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <Button
                onClick={startMeasurement}
                disabled={isMonitoring}
                className="h-16 text-lg font-semibold bg-green-600 hover:bg-green-700 disabled:bg-gray-600"
              >
                <Play className="mr-2 h-6 w-6" />
                Iniciar Medición (40s)
              </Button>
              
              <Button
                onClick={stopMeasurement}
                disabled={!isMonitoring}
                variant="destructive"
                className="h-16 text-lg font-semibold"
              >
                <Square className="mr-2 h-6 w-6" />
                Detener
              </Button>
              
              <Button
                onClick={handleReset}
                variant="outline"
                className="h-16 text-lg font-semibold border-white/20 text-white hover:bg-white/10"
              >
                <RotateCcw className="mr-2 h-6 w-6" />
                Reset Completo
              </Button>
              
            </div>
          </CardContent>
        </Card>

        {/* VISTA PREVIA DE CÁMARA */}
        {!isFullscreen && (
          <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Vista Previa</h3>
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <CameraView
                  isMonitoring={false}
                  onSample={handleSample}
                  targetFps={15}
                  roiSize={200}
                  enableTorch={false}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* FOOTER CON DISCLAIMER */}
        <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
          <CardContent className="p-4">
            <p className="text-xs text-white/60 text-center">
              ⚕️ Sistema referencial - No diagnóstica • Datos 100% reales sin simulaciones
            </p>
          </CardContent>
        </Card>
        
      </div>
    </div>
  );
};

export default Index;
