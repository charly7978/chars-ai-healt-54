
import React, { useEffect, useRef, useState } from 'react';
import { CameraSample } from '@/types';

interface CameraViewProps {
  onStreamReady?: (s: MediaStream) => void;
  onSample?: (s: CameraSample) => void;
  isMonitoring: boolean;
  targetFps?: number;
  roiSize?: number;
  enableTorch?: boolean;
  coverageThresholdPixelBrightness?: number;
}

const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onSample,
  isMonitoring,
  targetFps = 30,
  roiSize = 200,
  enableTorch = true,
  coverageThresholdPixelBrightness = 15
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevBrightnessRef = useRef<number | null>(null);
  const [isStreamActive, setIsStreamActive] = useState(false);

  useEffect(() => {
    let mounted = true;

    const startCam = async () => {
      try {
        console.log('🎥 Iniciando cámara...');
        
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: targetFps, min: 15 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!mounted) return;

        streamRef.current = stream;
        setIsStreamActive(true);
        onStreamReady?.(stream);

        // Crear video visible
        if (!videoRef.current) {
          const v = document.createElement('video');
          v.autoplay = true;
          v.playsInline = true;
          v.muted = true;
          v.style.width = '100%';
          v.style.height = '100%';
          v.style.objectFit = 'cover';
          document.body.appendChild(v);
          videoRef.current = v;
        }
        videoRef.current.srcObject = stream;

        // Canvas para procesamiento
        if (!canvasRef.current) {
          const c = document.createElement('canvas');
          c.style.display = 'none';
          document.body.appendChild(c);
          canvasRef.current = c;
        }

        // Intentar activar linterna
        if (enableTorch) {
          try {
            const [track] = stream.getVideoTracks();
            const capabilities = (track as any).getCapabilities?.();
            
            if (capabilities?.torch) {
              await (track as any).applyConstraints({
                advanced: [{ torch: true }]
              });
              console.log('🔦 Linterna activada');
            } else {
              console.log('🔦 Linterna no disponible en este dispositivo');
            }
          } catch (torchError) {
            console.log('⚠️ No se pudo activar la linterna:', torchError);
          }
        }

        // Esperar a que el video esté listo
        await new Promise<void>((resolve) => {
          const v = videoRef.current!;
          if (v.readyState >= 2) return resolve();
          
          const handleReady = () => {
            v.removeEventListener('loadeddata', handleReady);
            resolve();
          };
          v.addEventListener('loadeddata', handleReady);
        });

        console.log('✅ Cámara iniciada correctamente');

        // Iniciar captura de frames
        const loop = () => {
          if (!mounted || !isMonitoring) return;
          
          captureFrameAndEmit();
          rafRef.current = requestAnimationFrame(() => {
            setTimeout(loop, 1000 / targetFps);
          });
        };
        
        rafRef.current = requestAnimationFrame(loop);

      } catch (err) {
        console.error('❌ Error al abrir cámara:', err);
        setIsStreamActive(false);
      }
    };

    const captureFrameAndEmit = () => {
      const v = videoRef.current;
      const c = canvasRef.current;
      
      if (!v || !c || !v.videoWidth || !v.videoHeight) {
        return;
      }

      // ROI central optimizado
      const roiW = Math.min(roiSize, v.videoWidth);
      const roiH = Math.min(roiSize, v.videoHeight);
      const sx = Math.max(0, (v.videoWidth - roiW) / 2);
      const sy = Math.max(0, (v.videoHeight - roiH) / 2);

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

      // Emitir muestra procesada
      onSample?.({
        timestamp: Date.now(),
        rMean, gMean, bMean,
        brightnessMean,
        rStd, gStd, bStd,
        frameDiff,
        coverageRatio
      });
    };

    if (isMonitoring) {
      startCam();
    }

    return () => {
      mounted = false;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      
      if (videoRef.current) {
        try {
          document.body.removeChild(videoRef.current);
        } catch (e) {}
        videoRef.current = null;
      }
      
      if (canvasRef.current) {
        try {
          document.body.removeChild(canvasRef.current);
        } catch (e) {}
        canvasRef.current = null;
      }
      
      setIsStreamActive(false);
    };
  }, [isMonitoring, onSample, onStreamReady, targetFps, roiSize, enableTorch, coverageThresholdPixelBrightness]);

  return (
    <div className="absolute inset-0 bg-black">
      {isStreamActive && videoRef.current && (
        <div 
          ref={(el) => {
            if (el && videoRef.current && !el.contains(videoRef.current)) {
              el.appendChild(videoRef.current);
            }
          }}
          className="w-full h-full"
        />
      )}
      
      {!isStreamActive && isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-white text-center p-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Iniciando cámara...</p>
          </div>
        </div>
      )}
      
      {!isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-white text-center p-4">
            <div className="h-12 w-12 bg-gray-600 rounded-full mx-auto mb-4 flex items-center justify-center">
              📷
            </div>
            <p>Cámara desactivada</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraView;
