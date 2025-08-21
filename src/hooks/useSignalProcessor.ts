
import { useMemo, useRef, useState } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';

/**
 * Hook que integra CameraView -> MultiChannelManager
 * - handleSample: conectar al onSample
 * - lastResult: resultado multi-canal
 */

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);

  if (!mgrRef.current) mgrRef.current = new MultiChannelManager(channels, windowSec);

  const handleSample = (s: CameraSample) => {
    // preprocesamiento: seleccionamos canal base. Recomendado: usar canal verde por mayor SNR en PPG.
    // También se puede usar ratio G/(R+G+B) para robustez frente a saturación.
    const total = s.rMean + s.gMean + s.bMean + 1e-6;
    const ratio = s.gMean / total; // 0..1
    // Escalar ratio a 0..255 para la entrada del canal (similar al rMean usado antes)
    const inputSignal = ratio * 255;

    // DEBUG: Log de muestras para diagnóstico
    console.log('📸 CameraSample:', {
      rMean: s.rMean.toFixed(1),
      gMean: s.gMean.toFixed(1),
      bMean: s.bMean.toFixed(1),
      brightnessMean: s.brightnessMean.toFixed(1),
      coverageRatio: (s.coverageRatio * 100).toFixed(1) + '%',
      frameDiff: s.frameDiff.toFixed(1),
      inputSignal: inputSignal.toFixed(1),
      timestamp: new Date(s.timestamp).toLocaleTimeString()
    });

    mgrRef.current!.pushSample(inputSignal, s.timestamp);
    const res = mgrRef.current!.analyzeAll(s.coverageRatio, s.frameDiff);
    setLastResult(res);
  };

  const adjustChannelGain = (channelId: number, deltaRel: number) => {
    mgrRef.current?.adjustChannelGain(channelId, deltaRel);
    setLastResult(mgrRef.current!.analyzeAll(0,0));
  };

  return useMemo(() => ({ handleSample, lastResult, adjustChannelGain }), [lastResult]);
}
