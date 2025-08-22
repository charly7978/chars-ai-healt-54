
import { useMemo, useRef, useState, useCallback } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);
  const sampleCountRef = useRef(0);
  const isInitializedRef = useRef(false);

  // INICIALIZACIÓN ÚNICA Y ROBUSTA
  const initializeManager = useCallback(() => {
    if (!mgrRef.current || !isInitializedRef.current) {
      console.log('🏭 Inicializando MultiChannelManager...');
      mgrRef.current = new MultiChannelManager(channels, windowSec);
      isInitializedRef.current = true;
      sampleCountRef.current = 0;
      console.log('✅ MultiChannelManager inicializado:', { channels, windowSec });
    }
  }, [channels, windowSec]);

  // CALLBACK OPTIMIZADO para muestras
  const handleSample = useCallback((s: CameraSample) => {
    initializeManager();
    
    if (!mgrRef.current) {
      console.error('❌ MultiChannelManager no inicializado');
      return;
    }
    
    sampleCountRef.current++;
    
    // USAR CANAL ROJO DIRECTO - Mejor para PPG
    const inputSignal = s.rMean;
    
    // LOGGING OPTIMIZADO - Menos frecuente para no saturar
    if (sampleCountRef.current % 50 === 0) {
      console.log('📊 Procesando muestra #' + sampleCountRef.current + ':', {
        rMean: inputSignal.toFixed(1),
        coverageRatio: (s.coverageRatio * 100).toFixed(1) + '%',
        frameDiff: s.frameDiff.toFixed(1)
      });
    }

    try {
      // PROCESAMIENTO DIRECTO
      mgrRef.current.pushSample(inputSignal, s.timestamp);
      const result = mgrRef.current.analyzeAll(s.coverageRatio, s.frameDiff);
      
      // LOGGING CONDICIONAL - Solo cuando hay cambios importantes
      if (result.fingerDetected || sampleCountRef.current % 100 === 0) {
        const activeChannels = result.channels.filter(c => c.isFingerDetected).length;
        console.log('🔍 Análisis completo:', {
          fingerDetected: result.fingerDetected,
          bpm: result.aggregatedBPM,
          quality: result.aggregatedQuality,
          activeChannels: `${activeChannels}/${result.channels.length}`,
          snr: result.channels[0]?.snr?.toFixed(2) || 'N/A'
        });
      }
      
      setLastResult(result);
    } catch (error) {
      console.error('❌ Error procesando muestra:', error);
    }
  }, [initializeManager]);

  const adjustChannelGain = useCallback((channelId: number, deltaRel: number) => {
    if (!mgrRef.current) {
      console.warn('⚠️ MultiChannelManager no disponible para ajuste de ganancia');
      return;
    }
    
    try {
      mgrRef.current.adjustChannelGain(channelId, deltaRel);
      const result = mgrRef.current.analyzeAll(0, 0);
      setLastResult(result);
    } catch (error) {
      console.error('❌ Error ajustando ganancia:', error);
    }
  }, []);

  // RESET PROFUNDO Y COMPLETO
  const reset = useCallback(() => {
    console.log('🔄 Reset PROFUNDO useSignalProcessor iniciado...');
    
    try {
      // RESET del manager si existe
      if (mgrRef.current) {
        console.log('🔄 Reseteando MultiChannelManager...');
        mgrRef.current.reset();
      }
      
      // FORCE cleanup completo
      mgrRef.current = null;
      isInitializedRef.current = false;
      
      // RESET estados
      setLastResult(null);
      sampleCountRef.current = 0;
      
      console.log('✅ Reset PROFUNDO completado exitosamente');
    } catch (error) {
      console.error('❌ Error durante reset:', error);
      
      // FORCE reset en caso de error
      mgrRef.current = null;
      isInitializedRef.current = false;
      setLastResult(null);
      sampleCountRef.current = 0;
    }
  }, []);

  const getStats = useCallback(() => {
    if (!lastResult) return null;
    
    const activeChannels = lastResult.channels.filter(c => c.isFingerDetected).length;
    return {
      totalSamples: sampleCountRef.current,
      activeChannels,
      totalChannels: lastResult.channels.length,
      fingerDetected: lastResult.fingerDetected,
      aggregatedBPM: lastResult.aggregatedBPM,
      aggregatedSNR: lastResult.channels[0]?.snr || 0
    };
  }, [lastResult]);

  // CLEANUP al desmontar
  const cleanup = useCallback(() => {
    console.log('🗑️ useSignalProcessor cleanup...');
    if (mgrRef.current) {
      mgrRef.current.reset();
      mgrRef.current = null;
    }
    isInitializedRef.current = false;
    setLastResult(null);
    sampleCountRef.current = 0;
  }, []);

  return useMemo(() => ({ 
    handleSample, 
    lastResult, 
    adjustChannelGain,
    reset,
    getStats,
    cleanup
  }), [handleSample, lastResult, adjustChannelGain, reset, getStats, cleanup]);
}
