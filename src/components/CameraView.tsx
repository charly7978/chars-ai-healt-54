
import React, { useEffect, useRef } from 'react';
import { CameraSample } from '@/types';

/**
 * CameraView: captura desde la cámara trasera, intenta activar torch (linterna)
 * y calcula por frame: promedio canal rojo, desviación y diff con frame previo.
 * No renderiza UI: emite muestras por onSample.
 */

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onSample?: (s: CameraSample) => void;
  isMonitoring: boolean;
  targetFps?: number;
  targetW?: number;
  enableTorch?: boolean;
  // Props existentes para compatibilidad
  isFingerDetected?: boolean;
  signalQuality?: number;
}

const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onSample,
  isMonitoring,
  targetFps = 30,
  targetW = 160,
  enableTorch = true,
  isFingerDetected = false,
  signalQuality = 0
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevRRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        const constraints: any = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: targetFps }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!mounted) return;
        streamRef.current = stream;
        onStreamReady?.(stream);

        // crear video oculto
        if (!videoRef.current) {
          const v = document.createElement('video');
          v.autoplay = true;
          v.playsInline = true;
          v.muted = true;
          v.style.display = 'none';
          document.body.appendChild(v);
          videoRef.current = v;
        }
        videoRef.current.srcObject = stream;

        // canvas para procesamiento
        if (!canvasRef.current) {
          const c = document.createElement('canvas');
          c.style.display = 'none';
          document.body.appendChild(c);
          canvasRef.current = c;
        }

        // intentar encender torch si la cámara lo permite y usuario quiere
        try {
          const [track] = stream.getVideoTracks();
          const capabilities = (track as any).getCapabilities?.();
          if (enableTorch && capabilities && capabilities.torch) {
            try {
              await (track as any).applyConstraints({ advanced: [{ torch: true }] });
            } catch (e) {
              // algunos navegadores / dispositivos requieren interacción previa; ignorar
            }
          }
        } catch (e) {}

        // esperar video metadata
        await new Promise<void>((resolve) => {
          const v = videoRef.current!;
          if (v.readyState >= 1) return resolve();
          const onLoaded = () => { v.removeEventListener('loadedmetadata', onLoaded); resolve(); };
          v.addEventListener('loadedmetadata', onLoaded);
        });

        const loop = (ts: number) => {
          const now = performance.now();
          const dt = now - lastFrameTimeRef.current;
          const minDt = 1000 / targetFps;
          if (!lastFrameTimeRef.current || dt >= minDt) {
            lastFrameTimeRef.current = now;
            captureAndEmit();
          }
          rafRef.current = requestAnimationFrame(loop);
        };

        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error('CameraView: error al abrir la cámara', err);
      }
    };

    const captureAndEmit = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !v.videoWidth || !v.videoHeight) return;

      const aspect = v.videoHeight / v.videoWidth;
      const targetH = Math.round(targetW * aspect);
      if (c.width !== targetW || c.height !== targetH) {
        c.width = targetW;
        c.height = targetH;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const d = img.data;

      let sum = 0, sum2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        sum += r;
        sum2 += r * r;
      }
      const len = d.length / 4;
      const mean = sum / len;
      const variance = Math.max(0, sum2 / len - mean * mean);
      const std = Math.sqrt(variance);
      const prev = prevRRef.current;
      const frameDiff = prev == null ? 0 : Math.abs(mean - prev);
      prevRRef.current = mean;

      onSample?.({
        timestamp: Date.now(),
        rMean: mean,
        rStd: std,
        frameDiff
      });
    };

    if (isMonitoring) start();

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const s = streamRef.current; if (s) s.getTracks().forEach(t => t.stop());
      if (videoRef.current) { try { document.body.removeChild(videoRef.current); } catch (e) {} videoRef.current = null; }
      if (canvasRef.current) { try { document.body.removeChild(canvasRef.current); } catch (e) {} canvasRef.current = null; }
    };
  }, [isMonitoring, onSample, onStreamReady, targetFps, targetW, enableTorch]);

  // Este componente no renderiza UI visible (la app principal controla la UI completa)
  return null;
};

export default CameraView;
