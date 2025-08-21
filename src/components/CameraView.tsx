
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
      
      const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });
      console.log(`📷 Estado permisos: ${permission.state}`);
      
      if (permission.state === 'denied') {
        throw new Error('Permisos de cámara denegados');
      }

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

    const now = performance.now();
    const frameInterval = 1000 / targetFps;
    
    if (now - lastProcessTimeRef.current < frameInterval) {
      requestAnimationFrame(processFrame);
      return;
    }
    
    lastProcessTimeRef.current = now;
    frameCountRef.current++;

    canvas.width = targetW;
    canvas.height = Math.round(targetW * (video.videoHeight / video.videoWidth));

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let rSum = 0, gSum = 0, bSum = 0;
    let rSumSq = 0;
    let validPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // RESTAURAR UMBRALES QUE FUNCIONABAN ANTES
      if (r > 15 && r < 240 && g > 15 && g < 240 && b > 15 && b < 240) {
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

    const sample: CameraSample = {
      timestamp: now,
      rMean: rMean / 255,
      rStd: rStd / 255,
      frameDiff: frameCountRef.current > 1 ? Math.abs(rMean - (window as any).lastRMean || rMean) : 0
    };

    (window as any).lastRMean = rMean;

    onSample(sample);
    requestAnimationFrame(processFrame);
  };

  // Función para obtener el texto del estado de calidad
  const getQualityStatus = () => {
    if (!hasPermission) return "Iniciando cámara...";
    if (!isFingerDetected) return "Coloque su dedo sobre la cámara";
    if (signalQuality < 30) return "Mejore la posición del dedo";
    if (signalQuality < 70) return "Señal aceptable";
    return "Señal excelente";
  };

  const getQualityColor = () => {
    if (!isFingerDetected) return "text-red-400";
    if (signalQuality < 30) return "text-orange-400";
    if (signalQuality < 70) return "text-yellow-400";
    return "text-green-400";
  };

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover opacity-90"
        autoPlay
        playsInline
        muted
      />

      <canvas
        ref={canvasRef}
        className="hidden"
      />

      {/* INDICADOR DE CALIDAD LIMPIO PARA USUARIO FINAL */}
      <div className="absolute top-4 left-4 right-4">
        <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isFingerDetected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className={`text-sm font-medium ${getQualityColor()}`}>
                {getQualityStatus()}
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-300">Calidad</div>
              <div className={`text-sm font-bold ${getQualityColor()}`}>
                {signalQuality}%
              </div>
            </div>
          </div>
          
          {/* Barra de progreso de calidad */}
          <div className="mt-2 w-full bg-gray-700 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-300 ${
                signalQuality < 30 ? 'bg-red-500' : 
                signalQuality < 70 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(signalQuality, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* MENSAJE DE ERROR SI HAY */}
      {cameraError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-red-900/80 backdrop-blur-sm text-white p-4 rounded-lg text-center max-w-xs">
            <div className="text-lg font-semibold mb-2">❌ Error de Cámara</div>
            <div className="text-sm">{cameraError}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraView;
