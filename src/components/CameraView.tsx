
import React, { useEffect, useRef } from 'react';
import { CameraSample } from '@/types';

/**
 * CameraView mejorado:
 * - captura video trasero
 * - intenta activar torch si está disponible
 * - ROI reducido para rendimiento
 * - calcula medias por canal (R,G,B), desviaciones, coverageRatio,
 *   frameDiff y expone un CameraSample por frame.
 *
 * Recomendación: Pegar tal cual. En dispositivos Android la linterna
 * suele activarse si la cámara lo permite; en iOS requiere user gesture.
 */

interface CameraViewProps {
  onStreamReady?: (s: MediaStream) => void;
  onSample?: (s: CameraSample) => void;
  isMonitoring: boolean;
  targetFps?: number;
  roiSize?: number; // px ancho del ROI (se escala manteniendo aspect)
  enableTorch?: boolean;
  coverageThresholdPixelBrightness?: number; // 0-255
}

const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onSample,
  isMonitoring,
  targetFps = 30,
  roiSize = 200,
  enableTorch = true,
  coverageThresholdPixelBrightness = 30
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevBrightnessRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const startCam = async () => {
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

        // canvas
        if (!canvasRef.current) {
          const c = document.createElement('canvas');
          c.style.display = 'none';
          document.body.appendChild(c);
          canvasRef.current = c;
        }

        // intentar encender torch si permite
        try {
          const [track] = stream.getVideoTracks();
          const caps = (track as any).getCapabilities?.();
          if (enableTorch && caps && caps.torch) {
            try { await (track as any).applyConstraints({ advanced: [{ torch: true }] }); } catch (e) { /* ignore */ }
          }
        } catch (e) {}

        // esperar metadata
        await new Promise<void>((resolve) => {
          const v = videoRef.current!;
          if (v.readyState >= 1) return resolve();
          const h = () => { v.removeEventListener('loadedmetadata', h); resolve(); };
          v.addEventListener('loadedmetadata', h);
        });

        const loop = () => {
          captureFrameAndEmit();
          rafRef.current = requestAnimationFrame(() => {
            // limitar fps manualmente
            setTimeout(loop, 1000 / targetFps);
          });
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error('CameraView: no se pudo abrir cámara', err);
      }
    };

    const captureFrameAndEmit = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || !v.videoWidth || !v.videoHeight) return;

      // definimos ROI central cuadrado (más rápido y evita bordes)
      const roiW = roiSize;
      const roiH = Math.round(roiW * (v.videoHeight / v.videoWidth));
      const sx = Math.max(0, Math.round((v.videoWidth - roiW) / 2));
      const sy = Math.max(0, Math.round((v.videoHeight - roiH) / 2));

      c.width = roiW;
      c.height = roiH;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, sx, sy, roiW, roiH, 0, 0, roiW, roiH);
      const img = ctx.getImageData(0, 0, roiW, roiH);
      const d = img.data;

      let rSum = 0, gSum = 0, bSum = 0;
      let rSum2 = 0, gSum2 = 0, bSum2 = 0;
      let brightSum = 0;
      let cntBrightPixels = 0;
      const thr = coverageThresholdPixelBrightness;

      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i+1], b = d[i+2];
        const bright = (r + g + b) / 3;
        rSum += r; gSum += g; bSum += b;
        rSum2 += r*r; gSum2 += g*g; bSum2 += b*b;
        brightSum += bright;
        if (bright >= thr) cntBrightPixels++;
      }
      const npix = d.length / 4;
      const rMean = rSum / npix;
      const gMean = gSum / npix;
      const bMean = bSum / npix;
      const rVar = Math.max(0, rSum2/npix - rMean*rMean);
      const gVar = Math.max(0, gSum2/npix - gMean*gMean);
      const bVar = Math.max(0, bSum2/npix - bMean*bMean);
      const rStd = Math.sqrt(rVar);
      const gStd = Math.sqrt(gVar);
      const bStd = Math.sqrt(bVar);
      const brightnessMean = brightSum / npix;
      const framePrev = prevBrightnessRef.current;
      const frameDiff = framePrev == null ? 0 : Math.abs(brightnessMean - framePrev);
      prevBrightnessRef.current = brightnessMean;
      const coverageRatio = cntBrightPixels / npix;

      // Emite muestra
      onSample?.({
        timestamp: Date.now(),
        rMean, gMean, bMean,
        brightnessMean,
        rStd, gStd, bStd,
        frameDiff,
        coverageRatio
      });
    };

    if (isMonitoring) startCam();

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const s = streamRef.current; if (s) s.getTracks().forEach(t => t.stop());
      if (videoRef.current) { try { document.body.removeChild(videoRef.current); } catch (e) {} videoRef.current = null; }
      if (canvasRef.current) { try { document.body.removeChild(canvasRef.current); } catch (e) {} canvasRef.current = null; }
    };
  }, [isMonitoring, onSample, onStreamReady, targetFps, roiSize, enableTorch, coverageThresholdPixelBrightness]);

  return null;
};

export default CameraView;
