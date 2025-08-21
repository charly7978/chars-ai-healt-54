
import React, { useRef, useEffect, useState } from 'react';
import { CameraSample } from '@/types';

interface CameraViewProps {
  onSample: (sample: CameraSample) => void;
  isMonitoring: boolean;
  targetFps?: number;
  targetW?: number;
  enableTorch?: boolean;
  isFingerDetected: boolean;
  signalQuality: number;
}

const CameraView = ({ 
  onSample, 
  isMonitoring, 
  targetFps = 30,
  targetW = 160,
  enableTorch = true,
  isFingerDetected,
  signalQuality
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingRef = useRef<boolean>(false);
  const frameCountRef = useRef<number>(0);
  const lastProcessTimeRef = useRef<number>(0);
  
  const [cameraError, setCameraError] = useState<string>("");
  const [hasPermission, setHasPermission] = useState<boolean>(false);

  useEffect(() => {
    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => stopCamera();
  }, [isMonitoring]);

  const startCamera = async () => {
    try {
      setCameraError("");
      
      // VERIFICAR PERMISOS
      const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      console.log(`📷 Estado permisos: ${permission.state}`);
      
      if (permission.state === 'denied') {
        throw new Error('Permisos de cámara denegados');
      }

      // CONFIGURACIÓN OPTIMIZADA
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: 'environment',
          width: { ideal: targetW * 2 },
          height: { ideal: Math.round(targetW * 1.5) },
          frameRate: { ideal: targetFps, max: targetFps }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setHasPermission(true);
        
        // APLICAR TORCH SI ESTÁ DISPONIBLE
        if (enableTorch) {
          const track = stream.getVideoTracks()[0];
          if ('applyConstraints' in track) {
            try {
              await (track as any).applyConstraints({
                advanced: [{ torch: true }]
              });
              console.log("🔦 Flash activado");
            } catch (err) {
              console.log("⚠️ Flash no disponible:", err);
            }
          }
        }
      }

      // INICIAR PROCESAMIENTO
      processingRef.current = true;
      processFrame();

    } catch (error) {
      console.error('Error cámara:', error);
      setCameraError(error instanceof Error ? error.message : 'Error desconocido');
      setHasPermission(false);
    }
  };

  const stopCamera = () => {
    processingRef.current = false;
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    frameCountRef.current = 0;
    setHasPermission(false);
  };

  const processFrame = () => {
    if (!processingRef.current || !videoRef.current || !canvasRef.current) {
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) {
      requestAnimationFrame(processFrame);
      return;
    }

    // CONTROL DE FPS
    const now = performance.now();
    const frameInterval = 1000 / targetFps;
    
    if (now - lastProcessTimeRef.current < frameInterval) {
      requestAnimationFrame(processFrame);
      return;
    }
    
    lastProcessTimeRef.current = now;
    frameCountRef.current++;

    // AJUSTAR CANVAS AL TAMAÑO DEL VIDEO
    canvas.width = targetW;
    canvas.height = Math.round(targetW * (video.videoHeight / video.videoWidth));

    // DIBUJAR FRAME
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // EXTRAER DATOS DE PÍXELES
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // CALCULAR VALORES PROMEDIO
    let rSum = 0, gSum = 0, bSum = 0;
    let rSumSq = 0;
    let validPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // FILTRAR PÍXELES MUY OSCUROS O MUY CLAROS
      if (r > 20 && r < 240 && g > 20 && g < 240 && b > 20 && b < 240) {
        rSum += r;
        gSum += g;
        bSum += b;
        rSumSq += r * r;
        validPixels++;
      }
    }

    if (validPixels === 0) {
      requestAnimationFrame(processFrame);
      return;
    }

    const rMean = rSum / validPixels;
    const gMean = gSum / validPixels;
    const bMean = bSum / validPixels;
    const rStd = Math.sqrt((rSumSq / validPixels) - (rMean * rMean));

    // CREAR SAMPLE OPTIMIZADA
    const sample: CameraSample = {
      timestamp: now,
      rMean: rMean / 255, // Normalizar 0-1
      rStd: rStd / 255,
      frameDiff: frameCountRef.current > 1 ? Math.abs(rMean - (window as any).lastRMean || rMean) : 0
    };

    (window as any).lastRMean = rMean;

    // ENVIAR SAMPLE
    onSample(sample);

    // CONTINUAR PROCESAMIENTO
    requestAnimationFrame(processFrame);
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* VIDEO PREVIEW */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        playsInline
        muted
      />

      {/* CANVAS OCULTO PARA PROCESAMIENTO */}
      <canvas
        ref={canvasRef}
        className="hidden"
      />

      {/* OVERLAY DE ESTADO LIMPIO */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {!hasPermission && (
          <div className="bg-black/70 text-white p-4 rounded-lg text-center">
            <div className="text-lg font-semibold mb-2">
              {cameraError ? '❌ Error de Cámara' : '📷 Iniciando Cámara...'}
            </div>
            {cameraError && (
              <div className="text-sm text-red-300">{cameraError}</div>
            )}
          </div>
        )}
        
        {hasPermission && (
          <div className="absolute bottom-4 left-4 right-4">
            <div className="bg-black/50 text-white p-3 rounded-lg text-center">
              <div className="text-sm">
                Coloque su dedo sobre la cámara trasera con flash
              </div>
              <div className="text-xs mt-1 text-gray-300">
                Estado: {isFingerDetected ? '✅ Dedo detectado' : '⏳ Buscando dedo'} 
                | Calidad: {signalQuality}%
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CameraView;
