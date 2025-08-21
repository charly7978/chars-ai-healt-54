
import React, { useEffect, useRef, useState } from 'react';
import { CameraSample } from '@/types';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onSample?: (s: CameraSample) => void;
  isMonitoring: boolean;
  targetFps?: number;
  targetW?: number;
  enableTorch?: boolean;
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
  const [cameraError, setCameraError] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      try {
        console.log(`🎥 Iniciando cámara - Monitoreo: ${isMonitoring}`);
        setCameraError("");
        
        // Solicitar permisos explícitamente primero
        const permissions = await navigator.permissions.query({name: 'camera' as PermissionName});
        if (permissions.state === 'denied') {
          throw new Error('Permisos de cámara denegados');
        }

        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640, min: 320 },
            height: { ideal: 480, min: 240 },
            frameRate: { ideal: targetFps, min: 15 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!mounted) return;
        
        streamRef.current = stream;
        onStreamReady?.(stream);
        setIsStreaming(true);

        console.log(`✅ Stream obtenido correctamente`);

        // crear video visible para debug
        if (!videoRef.current) {
          const v = document.createElement('video');
          v.autoplay = true;
          v.playsInline = true;
          v.muted = true;
          v.style.position = 'absolute';
          v.style.top = '10px';
          v.style.right = '10px';
          v.style.width = '120px';
          v.style.height = '90px';
          v.style.zIndex = '50';
          v.style.border = '2px solid #00ff00';
          v.style.borderRadius = '8px';
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

        // intentar linterna
        try {
          const [track] = stream.getVideoTracks();
          const capabilities = (track as any).getCapabilities?.();
          if (enableTorch && capabilities?.torch) {
            console.log(`💡 Activando linterna...`);
            await (track as any).applyConstraints({ advanced: [{ torch: true }] });
            console.log(`✅ Linterna activada`);
          }
        } catch (e) {
          console.log(`⚠️ Linterna no disponible`);
        }

        // esperar video cargado
        await new Promise<void>((resolve) => {
          const v = videoRef.current!;
          if (v.readyState >= 1) return resolve();
          const onLoaded = () => { v.removeEventListener('loadedmetadata', onLoaded); resolve(); };
          v.addEventListener('loadedmetadata', onLoaded);
        });

        console.log(`🎬 Iniciando procesamiento de frames...`);
        
        const loop = (ts: number) => {
          if (!mounted || !isMonitoring) return;
          
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
        
      } catch (err: any) {
        console.error('❌ Error cámara:', err);
        setCameraError(err.message || 'Error desconocido de cámara');
        setIsStreaming(false);
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

      const sample: CameraSample = {
        timestamp: Date.now(),
        rMean: mean,
        rStd: std,
        frameDiff
      };

      console.log(`📊 Sample: rMean=${mean.toFixed(1)}, std=${std.toFixed(1)}, diff=${frameDiff.toFixed(1)}`);
      onSample?.(sample);
    };

    if (isMonitoring) start();

    return () => {
      mounted = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const s = streamRef.current; 
      if (s) s.getTracks().forEach(t => t.stop());
      if (videoRef.current) { 
        try { document.body.removeChild(videoRef.current); } catch (e) {} 
        videoRef.current = null; 
      }
      if (canvasRef.current) { 
        try { document.body.removeChild(canvasRef.current); } catch (e) {} 
        canvasRef.current = null; 
      }
      setIsStreaming(false);
    };
  }, [isMonitoring, onSample, onStreamReady, targetFps, targetW, enableTorch]);

  // Renderizar estado de la cámara
  return (
    <div className="absolute inset-0 bg-black flex items-center justify-center">
      {!isMonitoring && (
        <div className="text-white text-center">
          <div className="text-xl mb-2">📷</div>
          <div>Cámara desactivada</div>
        </div>
      )}
      
      {isMonitoring && !isStreaming && !cameraError && (
        <div className="text-white text-center">
          <div className="text-xl mb-2 animate-pulse">🔄</div>
          <div>Iniciando cámara...</div>
        </div>
      )}
      
      {cameraError && (
        <div className="text-red-500 text-center p-4">
          <div className="text-xl mb-2">❌</div>
          <div className="font-bold">Error de Cámara</div>
          <div className="text-sm mt-2">{cameraError}</div>
          <div className="text-xs mt-2">Asegúrate de permitir el acceso a la cámara</div>
        </div>
      )}
      
      {isStreaming && (
        <div className="text-white text-center">
          <div className="text-xl mb-2">📹</div>
          <div>Cámara activa</div>
          <div className="text-sm mt-2">
            Dedo: {isFingerDetected ? '✅' : '❌'} | 
            Calidad: {signalQuality}%
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraView;
