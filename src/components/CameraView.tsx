
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    const startCam = async () => {
      try {
        console.log('🎥 Iniciando cámara con linterna...');
        
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
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        onStreamReady?.(stream);

        // Crear y configurar video elemento
        if (!videoRef.current) {
          const video = document.createElement('video');
          video.autoplay = true;
          video.playsInline = true;
          video.muted = true;
          video.style.width = '100%';
          video.style.height = '100%';
          video.style.objectFit = 'cover';
          videoRef.current = video;
        }

        // CRÍTICO: Agregar video al DOM inmediatamente
        if (containerRef.current && videoRef.current && !containerRef.current.contains(videoRef.current)) {
          containerRef.current.appendChild(videoRef.current);
        }

        videoRef.current.srcObject = stream;

        // Configurar canvas para procesamiento
        if (!canvasRef.current) {
          const canvas = document.createElement('canvas');
          canvas.style.display = 'none';
          document.body.appendChild(canvas);
          canvasRef.current = canvas;
        }

        // Activar linterna INMEDIATAMENTE si está disponible
        if (enableTorch) {
          try {
            const [videoTrack] = stream.getVideoTracks();
            const capabilities = (videoTrack as any).getCapabilities?.();
            
            console.log('📱 Capacidades de cámara:', capabilities);
            
            if (capabilities?.torch) {
              await (videoTrack as any).applyConstraints({
                advanced: [{ torch: true }]
              });
              setTorchEnabled(true);
              console.log('🔦 ✅ Linterna ACTIVADA correctamente');
            } else {
              console.log('🔦 ❌ Linterna NO disponible en este dispositivo');
            }
          } catch (torchError) {
            console.error('🔦 ⚠️ Error activando linterna:', torchError);
          }
        }

        // Esperar video listo y comenzar captura
        const waitForVideo = () => {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            console.log('✅ Video listo, iniciando captura');
            setIsStreamActive(true);
            startFrameCapture();
          } else {
            setTimeout(waitForVideo, 100);
          }
        };

        waitForVideo();

      } catch (err) {
        console.error('❌ Error crítico abriendo cámara:', err);
        setIsStreamActive(false);
      }
    };

    const startFrameCapture = () => {
      if (!mounted || !isMonitoring) return;
      
      const loop = () => {
        if (!mounted || !isMonitoring) return;
        
        captureFrameAndEmit();
        rafRef.current = requestAnimationFrame(() => {
          setTimeout(loop, 1000 / targetFps);
        });
      };
      
      rafRef.current = requestAnimationFrame(loop);
    };

    const captureFrameAndEmit = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
        return;
      }

      // ROI optimizado para dedo
      const roiW = Math.min(roiSize, video.videoWidth);
      const roiH = Math.min(roiSize, video.videoHeight);
      const sx = Math.max(0, (video.videoWidth - roiW) / 2);
      const sy = Math.max(0, (video.videoHeight - roiH) / 2);

      canvas.width = roiW;
      canvas.height = roiH;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(video, sx, sy, roiW, roiH, 0, 0, roiW, roiH);
      const imageData = ctx.getImageData(0, 0, roiW, roiH);
      const data = imageData.data;

      let rSum = 0, gSum = 0, bSum = 0;
      let rSum2 = 0, gSum2 = 0, bSum2 = 0;
      let brightSum = 0;
      let brightPixels = 0;
      const threshold = coverageThresholdPixelBrightness;

      // Procesar píxeles
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1]; 
        const b = data[i + 2];
        const brightness = (r + g + b) / 3;
        
        rSum += r;
        gSum += g;
        bSum += b;
        rSum2 += r * r;
        gSum2 += g * g;
        bSum2 += b * b;
        brightSum += brightness;
        
        if (brightness >= threshold) brightPixels++;
      }
      
      const totalPixels = data.length / 4;
      const rMean = rSum / totalPixels;
      const gMean = gSum / totalPixels;
      const bMean = bSum / totalPixels;
      const brightnessMean = brightSum / totalPixels;
      
      // Calcular desviaciones
      const rVar = Math.max(0, rSum2/totalPixels - rMean*rMean);
      const gVar = Math.max(0, gSum2/totalPixels - gMean*gMean);
      const bVar = Math.max(0, bSum2/totalPixels - bMean*bMean);
      
      const rStd = Math.sqrt(rVar);
      const gStd = Math.sqrt(gVar);
      const bStd = Math.sqrt(bVar);
      
      // Frame diff para detectar movimiento
      const prevBrightness = prevBrightnessRef.current;
      const frameDiff = prevBrightness !== null ? Math.abs(brightnessMean - prevBrightness) : 0;
      prevBrightnessRef.current = brightnessMean;
      
      const coverageRatio = brightPixels / totalPixels;

      // CRÍTICO: Emitir muestra con valores correctos
      onSample?.({
        timestamp: Date.now(),
        rMean,
        gMean,
        bMean,
        brightnessMean,
        rStd,
        gStd,
        bStd,
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
        rafRef.current = null;
      }
      
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      if (videoRef.current && containerRef.current && containerRef.current.contains(videoRef.current)) {
        containerRef.current.removeChild(videoRef.current);
        videoRef.current = null;
      }
      
      if (canvasRef.current && document.body.contains(canvasRef.current)) {
        document.body.removeChild(canvasRef.current);
        canvasRef.current = null;
      }
      
      setIsStreamActive(false);
      setTorchEnabled(false);
    };
  }, [isMonitoring, onSample, onStreamReady, targetFps, roiSize, enableTorch, coverageThresholdPixelBrightness]);

  return (
    <div className="absolute inset-0 bg-black">
      {/* Contenedor para video */}
      <div 
        ref={containerRef}
        className="w-full h-full"
      />
      
      {/* Estados de la cámara */}
      {!isStreamActive && isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-white text-center p-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-lg">Iniciando cámara...</p>
            {enableTorch && (
              <p className="text-sm text-white/70 mt-2">Activando linterna...</p>
            )}
          </div>
        </div>
      )}
      
      {!isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-white text-center p-6">
            <div className="h-12 w-12 bg-gray-600 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl">
              📷
            </div>
            <p className="text-lg">Cámara desactivada</p>
          </div>
        </div>
      )}
      
      {/* Indicador de linterna */}
      {torchEnabled && (
        <div className="absolute top-4 left-4 bg-black/50 rounded-full p-2">
          <div className="text-yellow-400 text-xl">🔦</div>
        </div>
      )}
    </div>
  );
};

export default CameraView;
