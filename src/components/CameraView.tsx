
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
  coverageThresholdPixelBrightness = 25
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const prevBrightnessRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OPTIMIZACIÓN CRÍTICA: Evitar re-renders innecesarios
  const frameIntervalRef = useRef<number>(1000 / targetFps);
  const lastCaptureRef = useRef<number>(0);

  useEffect(() => {
    if (!isMonitoring) return;

    let mounted = true;
    
    const startCamera = async () => {
      try {
        console.log('🎥 INICIANDO CÁMARA OPTIMIZADA...');
        
        // CONSTRAINTS CORREGIDAS - SIN facingMode problemático
        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { exact: targetFps }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        
        // CREAR Y CONFIGURAR VIDEO INMEDIATAMENTE
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1)';
        video.srcObject = stream;
        
        videoRef.current = video;

        // AGREGAR AL DOM GARANTIZADO
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(video);
        }

        // ACTIVAR LINTERNA INMEDIATAMENTE - MÉTODO CORRECTO
        if (enableTorch) {
          const videoTrack = stream.getVideoTracks()[0];
          
          try {
            // MÉTODO 1: Advanced constraints
            await videoTrack.applyConstraints({
              advanced: [{ 
                torch: true,
                exposureMode: 'manual' as any,
                exposureTime: 100000,
                whiteBalanceMode: 'manual' as any
              }]
            });
            setTorchEnabled(true);
            console.log('🔦 ✅ LINTERNA ACTIVADA - Método advanced');
          } catch {
            try {
              // MÉTODO 2: Básico
              await videoTrack.applyConstraints({
                torch: true as any
              });
              setTorchEnabled(true);
              console.log('🔦 ✅ LINTERNA ACTIVADA - Método básico');
            } catch {
              console.log('🔦 ❌ Linterna no disponible');
            }
          }
        }

        // CANVAS OPTIMIZADO
        const canvas = document.createElement('canvas');
        canvas.style.display = 'none';
        canvasRef.current = canvas;

        // ESPERAR VIDEO READY Y INICIAR CAPTURA
        const onVideoReady = () => {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            setIsStreamActive(true);
            setError(null);
            onStreamReady?.(stream);
            
            // INICIAR CAPTURA OPTIMIZADA
            if (mounted && isMonitoring) {
              startOptimizedCapture();
            }
          }
        };

        video.addEventListener('loadedmetadata', onVideoReady);
        video.addEventListener('canplay', onVideoReady);

      } catch (err: any) {
        console.error('❌ ERROR CÁMARA:', err);
        setError(err.message);
        setIsStreamActive(false);
      }
    };

    // SISTEMA DE CAPTURA ULTRA-OPTIMIZADO
    const startOptimizedCapture = () => {
      const captureLoop = (currentTime: number) => {
        if (!mounted || !isMonitoring || !videoRef.current || !canvasRef.current) {
          return;
        }
        
        // THROTTLING INTELIGENTE - Solo capturar si pasó suficiente tiempo
        if (currentTime - lastCaptureRef.current >= frameIntervalRef.current) {
          try {
            const sample = captureFrame();
            if (sample && onSample) {
              onSample(sample);
            }
            lastCaptureRef.current = currentTime;
          } catch (err) {
            console.error('Error captura:', err);
          }
        }
        
        rafRef.current = requestAnimationFrame(captureLoop);
      };
      
      rafRef.current = requestAnimationFrame(captureLoop);
    };

    // CAPTURA DE FRAME ULTRA-OPTIMIZADA
    const captureFrame = (): CameraSample | null => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
        return null;
      }

      // ROI OPTIMIZADA - Centrada
      const centerX = video.videoWidth / 2;
      const centerY = video.videoHeight / 2;
      const roiW = Math.min(roiSize, video.videoWidth * 0.4);
      const roiH = Math.min(roiSize, video.videoHeight * 0.4);
      const sx = centerX - roiW / 2;
      const sy = centerY - roiH / 2;

      canvas.width = roiW;
      canvas.height = roiH;
      
      const ctx = canvas.getContext('2d', { 
        alpha: false,
        desynchronized: true,
        willReadFrequently: true 
      });
      if (!ctx) return null;
      
      // CAPTURA DIRECTA ROI
      ctx.drawImage(video, sx, sy, roiW, roiH, 0, 0, roiW, roiH);
      const imageData = ctx.getImageData(0, 0, roiW, roiH);
      const data = imageData.data;

      // PROCESAMIENTO ULTRA-OPTIMIZADO
      let rSum = 0, gSum = 0, bSum = 0;
      let rSum2 = 0, gSum2 = 0, bSum2 = 0;
      let brightSum = 0;
      let brightPixels = 0;
      const threshold = coverageThresholdPixelBrightness;
      const totalPixels = data.length / 4;

      // LOOP OPTIMIZADO - Menos cálculos
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1]; 
        const b = data[i + 2];
        const brightness = (r + g + b) * 0.333333; // Más rápido que /3
        
        rSum += r;
        gSum += g;
        bSum += b;
        rSum2 += r * r;
        gSum2 += g * g;
        bSum2 += b * b;
        brightSum += brightness;
        
        if (brightness >= threshold) brightPixels++;
      }
      
      const rMean = rSum / totalPixels;
      const gMean = gSum / totalPixels;
      const bMean = bSum / totalPixels;
      const brightnessMean = brightSum / totalPixels;
      
      // VARIANZAS OPTIMIZADAS
      const rVar = Math.max(0, rSum2/totalPixels - rMean*rMean);
      const gVar = Math.max(0, gSum2/totalPixels - gMean*gMean);
      const bVar = Math.max(0, bSum2/totalPixels - bMean*bMean);
      
      const rStd = Math.sqrt(rVar);
      const gStd = Math.sqrt(gVar);
      const bStd = Math.sqrt(bVar);
      
      // FRAME DIFF OPTIMIZADO
      const prevBrightness = prevBrightnessRef.current;
      const frameDiff = prevBrightness !== null ? Math.abs(brightnessMean - prevBrightness) : 0;
      prevBrightnessRef.current = brightnessMean;
      
      const coverageRatio = brightPixels / totalPixels;

      return {
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
      };
    };

    startCamera();

    // CLEANUP OPTIMIZADO
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
      
      videoRef.current = null;
      canvasRef.current = null;
      
      setIsStreamActive(false);
      setTorchEnabled(false);
      setError(null);
    };
  }, [isMonitoring]); // SOLO isMonitoring como dependencia

  return (
    <div className="absolute inset-0 bg-black">
      <div 
        ref={containerRef}
        className="w-full h-full"
        style={{ overflow: 'hidden' }}
      />
      
      {/* INDICADORES OPTIMIZADOS */}
      {!isStreamActive && isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90">
          <div className="text-white text-center p-6">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-lg font-medium">Iniciando cámara PPG...</p>
            {enableTorch && <p className="text-sm text-white/70 mt-2">Configurando linterna...</p>}
            {error && <p className="text-sm text-red-400 mt-2">Error: {error}</p>}
          </div>
        </div>
      )}
      
      {!isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-white text-center p-6">
            <div className="h-12 w-12 bg-gray-600 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl">📷</div>
            <p className="text-lg">Sistema PPG Desactivado</p>
          </div>
        </div>
      )}
      
      {/* INDICADORES DE ESTADO */}
      {torchEnabled && (
        <div className="absolute top-4 left-4 bg-black/70 rounded-full p-2">
          <div className="text-yellow-400 text-xl animate-pulse">🔦</div>
        </div>
      )}
      
      {isStreamActive && isMonitoring && (
        <div className="absolute bottom-4 left-4 bg-black/70 rounded-full px-3 py-1">
          <div className="text-green-400 text-sm flex items-center">
            <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
            CAPTURANDO PPG
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraView;
