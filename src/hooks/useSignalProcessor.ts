
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';
import { ProcessedSignal } from '@/types/signal';

/**
 * Hook principal que integra CameraView -> MultiChannelManager
 * Mantiene compatibilidad con la interfaz anterior para Index.tsx
 */

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);

  if (!mgrRef.current) mgrRef.current = new MultiChannelManager(channels, windowSec);

  // Métodos de compatibilidad
  const startProcessing = useCallback(() => {
    setIsProcessing(true);
    setFramesProcessed(0);
    console.log('🎬 Procesamiento iniciado');
  }, []);

  const stopProcessing = useCallback(() => {
    setIsProcessing(false);
    console.log('🛑 Procesamiento detenido');
  }, []);

  // handler que CameraView llamará por frame
  const handleSample = useCallback((s: CameraSample) => {
    if (!isProcessing) return;
    
    mgrRef.current!.pushSample(s.rMean, s.timestamp);
    const res = mgrRef.current!.analyzeAll();
    setLastResult(res);
    setFramesProcessed(prev => prev + 1);

    // Crear ProcessedSignal compatible desde MultiChannelResult
    if (res) {
      const bestChannel = res.channels.find(ch => ch.isFingerDetected && ch.quality > 30) || res.channels[0];
      const processedSignal: ProcessedSignal = {
        timestamp: res.timestamp,
        rawValue: s.rMean,
        filteredValue: bestChannel?.calibratedSignal.slice(-1)[0] || s.rMean,
        quality: bestChannel?.quality || 0,
        fingerDetected: bestChannel?.isFingerDetected || false,
        roi: {
          x: 0,
          y: 0, 
          width: 160,
          height: 120
        },
        perfusionIndex: bestChannel?.snr || 0
      };
      setLastSignal(processedSignal);
    }
  }, [isProcessing]);

  // Método de compatibilidad para processFrame
  const processFrame = useCallback((imageData: ImageData) => {
    if (!isProcessing) return;
    
    // Extraer rMean del ImageData
    const data = imageData.data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i]; // canal rojo
    }
    const rMean = sum / (data.length / 4);
    
    // Crear sample sintético
    const sample: CameraSample = {
      timestamp: Date.now(),
      rMean,
      rStd: 0,
      frameDiff: 0
    };
    
    handleSample(sample);
  }, [handleSample, isProcessing]);

  // util: permitir ajuste manual desde componentes UI
  const adjustChannelGain = useCallback((channelId: number, deltaRel: number) => {
    mgrRef.current?.adjustChannelGain(channelId, deltaRel);
    // actualizar estado inmediato
    const res = mgrRef.current!.analyzeAll();
    setLastResult(res);
  }, []);

  // Debug info de compatibilidad
  const debugInfo = useMemo(() => ({
    channels: lastResult?.channels.length || 0,
    aggregatedBPM: lastResult?.aggregatedBPM || null,
    aggregatedQuality: lastResult?.aggregatedQuality || 0,
    isProcessing,
    framesProcessed
  }), [lastResult, isProcessing, framesProcessed]);

  return useMemo(() => ({ 
    handleSample, 
    lastResult, 
    adjustChannelGain,
    startProcessing,
    stopProcessing,
    lastSignal,
    processFrame,
    isProcessing,
    framesProcessed,
    debugInfo
  }), [
    handleSample, 
    lastResult, 
    adjustChannelGain,
    startProcessing,
    stopProcessing,
    lastSignal,
    processFrame,
    isProcessing,
    framesProcessed,
    debugInfo
  ]);
}
