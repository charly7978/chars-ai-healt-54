/**
 * useSignalProcessor - Hook principal para procesamiento de señales PPG
 * COMPLETAMENTE OPTIMIZADO para evitar pérdidas de detección
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { MultiChannelResult } from '@/types';

export function useSignalProcessor() {
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const lastEnvRef = useRef<{
    coverage: number;
    motion: number;
    lastCoverage: number;
    lastMotion: number;
  }>({ coverage: 0, motion: 0, lastCoverage: 0, lastMotion: 0 });

  // Inicializar MultiChannelManager
  useEffect(() => {
    if (!mgrRef.current) {
      mgrRef.current = new MultiChannelManager(6, 8);
      console.log('🚀 useSignalProcessor: MultiChannelManager inicializado');
    }
  }, []);

  // Función principal para procesar muestras de cámara
  const pushSample = useCallback((
    rMean: number,
    gMean: number,
    bMean: number,
    frameDiff: number,
    coverageRatio: number,
    fingerConfidence: number,
    exposureState: string
  ) => {
    if (!mgrRef.current) return;

    // CRÍTICO: Siempre ejecutar análisis con cada muestra
    // Esto asegura que los buffers internos estén siempre actualizados
    mgrRef.current.pushSample(rMean, Date.now());
    
    // Usar cobertura y movimiento ajustados para análisis
    const adjustedCoverage = Math.max(0, Math.min(1, coverageRatio));
    const adjustedMotion = Math.max(0, Math.min(100, frameDiff));
    
    // CRÍTICO: El análisis SIEMPRE se ejecuta, solo se throttlea la actualización de UI
    const result = mgrRef.current.analyzeAll(adjustedCoverage, adjustedMotion);
    
    // Throttle solo para la actualización de React state (evita re-renders excesivos)
    const now = Date.now();
    if (!lastResult || now - (lastResult.timestamp || 0) >= 33) { // ~30 FPS
      setLastResult(result);
      setIsProcessing(false);
    }
    
    // Persistir métricas globales para referencia
    lastEnvRef.current.lastCoverage = lastEnvRef.current.coverage;
    lastEnvRef.current.lastMotion = lastEnvRef.current.motion;
    lastEnvRef.current.coverage = adjustedCoverage;
    lastEnvRef.current.motion = adjustedMotion;
    
    // Debug: Log si hay saltos anormales en frameDiff
    if (frameDiff > 20) {
      console.warn('⚠️ SALTO ANORMAL en frameDiff:', {
        frameDiff,
        timestamp: new Date().toISOString(),
        exposureState
      });
    }
  }, [lastResult]);

  // Función para obtener estadísticas del sistema
  const getSystemStats = useCallback(() => {
    return mgrRef.current?.getSystemStats() || null;
  }, []);

  // Función para resetear el sistema
  const resetSystem = useCallback(() => {
    if (mgrRef.current) {
      mgrRef.current.reset();
      setLastResult(null);
      setIsProcessing(false);
      console.log('🔄 useSignalProcessor: Sistema reseteado');
    }
  }, []);

  // Función para ajustar ganancia de canales
  const adjustChannelGain = useCallback((channelId: number, deltaRel: number) => {
    mgrRef.current?.adjustChannelGain(channelId, deltaRel);
  }, []);

  // Función para obtener ganancias actuales
  const getChannelGains = useCallback(() => {
    return mgrRef.current?.getGains() || [];
  }, []);

  return {
    lastResult,
    isProcessing,
    pushSample,
    getSystemStats,
    resetSystem,
    adjustChannelGain,
    getChannelGains
  };
}
