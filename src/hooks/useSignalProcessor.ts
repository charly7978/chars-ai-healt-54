
import { useEffect, useMemo, useRef, useState } from 'react';
import MultiChannelManager from '@/modules/signal-processing/MultiChannelManager';
import { CameraSample, MultiChannelResult } from '@/types';

/**
 * Hook principal que integra CameraView -> MultiChannelManager
 * - Exponer handleSample para conectar con CameraView.onSample
 * - Exponer resultado multi-canal en lastResult
 */

export function useSignalProcessor(windowSec = 8, channels = 6) {
  const mgrRef = useRef<MultiChannelManager | null>(null);
  const [lastResult, setLastResult] = useState<MultiChannelResult | null>(null);

  if (!mgrRef.current) mgrRef.current = new MultiChannelManager(channels, windowSec);

  // handler que CameraView llamará por frame
  const handleSample = (s: CameraSample) => {
    mgrRef.current!.pushSample(s.rMean, s.timestamp);
    // cada X muestras o cada Y ms podríamos analizar. Aquí analizamos cada vez pero
    // MultiChannelManager internamente usa ventanas y analiza en límites de ventana.
    const res = mgrRef.current!.analyzeAll();
    setLastResult(res);
  };

  // util: permitir ajuste manual desde componentes UI
  const adjustChannelGain = (channelId: number, deltaRel: number) => {
    mgrRef.current?.adjustChannelGain(channelId, deltaRel);
    // actualizar estado inmediato
    setLastResult(mgrRef.current!.analyzeAll());
  };

  return useMemo(() => ({ handleSample, lastResult, adjustChannelGain }), [lastResult]);
}
