
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
  const cleanupRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const frameIntervalRef = useRef<number>(1000 / targetFps);
  const lastCaptureRef = useRef<number>(0);
  const torchTrackRef = useRef<MediaStreamTrack | null>(null);

  // CLEANUP PROFUNDO MEJORADO - Soluciona degradación
  const performDeepCleanup = () => {
    console.log('🧹 CLEANUP PROFUNDO CameraView iniciado...');
    
    // CRITICAL: Cancelar RAF primero
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    // CRITICAL: Apagar linterna ANTES de cerrar stream
    if (torchTrackRef.current && torchEnabled) {
      console.log('🔦 APAGANDO LINTERNA...');
      try {
        torchTrackRef.current.applyConstraints({
          torch: false
        } as any).catch(console.error);
      } catch (e) {
        console.log('🔦 Error apagando linterna:', e);
      }
      setTorchEnabled(false);
      torchTrackRef.current = null;
    }
    
    // CRITICAL: Cerrar stream completamente
    const stream = streamRef.current;
    if (stream) {
      console.log('📹 Cerrando stream y todos los tracks...');
      stream.getTracks().forEach(track => {
        console.log('🛑 Stopping track:', track.label, track.kind);
        track.stop();
        track.enabled = false;
        
        // FORCE cleanup de eventos
        track.onended = null;
        track.onmute = null;
        track.onunmute = null;
      });
      streamRef.current = null;
    }
    
    // CRITICAL: Limpiar video element
    if (videoRef.current) {
      console.log('📺 Limpiando video element...');
      const video = videoRef.current;
      video.pause();
      video.srcObject = null;
      video.src = '';
      video.load();
      
      // FORCE remove eventos
      video.onloadedmetadata = null;
      video.oncanplay = null;
      video.onplaying = null;
      video.onerror = null;
      video.onabort = null;
      
      videoRef.current = null;
    }
    
    // CRITICAL: Limpiar canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      canvasRef.current = null;
    }
    
    // CRITICAL: Limpiar container DOM
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    
    // RESET completo de estados
    setIsStreamActive(false);
    setTorchEnabled(false);
    setError(null);
    prevBrightnessRef.current = null;
    
    console.log('✅ CLEANUP PROFUNDO CameraView completado');
  };

  // FORZAR CLEANUP cuando isMonitoring cambia
  useEffect(() => {
    mountedRef.current = true;
    
    if (!isMonitoring) {
      console.log('🛑 isMonitoring=false, ejecutando cleanup...');
      performDeepCleanup();
      return;
    }

    let mounted = true;
    
    const startCamera = async () => {
      try {
        console.log('🎥 INICIANDO CÁMARA MEJORADA...');
        
        // CLEANUP PREVENTIVO antes de iniciar
        performDeepCleanup();
        
        // CONSTRAINTS OPTIMIZADAS
        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: targetFps, min: 15 },
            aspectRatio: { ideal: 16/9 },
            facingMode: { ideal: 'environment' }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted || !mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];
        torchTrackRef.current = videoTrack;
        
        console.log('📹 Stream obtenido:', videoTrack.getSettings());
        
        // CREAR VIDEO ELEMENT MEJORADO
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.controls = false;
        video.style.cssText = `
          width: 100%;
          height: 100%;
          object-fit: cover;
          transform: scaleX(-1);
          background: #000;
          border: none;
          outline: none;
        `;
        
        videoRef.current = video;

        // AGREGAR AL DOM INMEDIATAMENTE
        if (containerRef.current && mounted && mountedRef.current) {
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(video);
          console.log('✅ Video agregado al DOM');
        }

        // LINTERNA - MÚLTIPLES MÉTODOS ROBUSTOS
        if (enableTorch && mounted && mountedRef.current) {
          console.log('🔦 Intentando activar linterna...', videoTrack.getCapabilities());
          
          const tryTorchMethod = async (methodName: string, torchFn: () => Promise<void>) => {
            try {
              await torchFn();
              setTorchEnabled(true);
              console.log(`🔦 ✅ LINTERNA ACTIVADA - ${methodName}`);
              return true;
            } catch (e) {
              console.log(`🔦 ${methodName} falló:`, e);
              return false;
            }
          };

          // MÉTODO 1: Capabilities básico
          const method1Success = await tryTorchMethod('Capabilities', async () => {
            const capabilities = videoTrack.getCapabilities();
            if (capabilities.torch) {
              await videoTrack.applyConstraints({
                advanced: [{ torch: true }]
              });
            } else {
              throw new Error('Torch no disponible en capabilities');
            }
          });

          // MÉTODO 2: Forzar torch directo
          if (!method1Success) {
            const method2Success = await tryTorchMethod('Forzado', async () => {
              await videoTrack.applyConstraints({
                torch: true
              } as any);
            });

            // MÉTODO 3: Advanced constraints
            if (!method2Success) {
              const method3Success = await tryTorchMethod('Advanced', async () => {
                await videoTrack.applyConstraints({
                  advanced: [{ torch: true }]
                } as any);
              });

              // MÉTODO 4: ImageCapture API
              if (!method3Success) {
                await tryTorchMethod('ImageCapture', async () => {
                  const imageCapture = new ImageCapture(videoTrack);
                  await imageCapture.takePhoto();
                  await videoTrack.applyConstraints({ torch: true } as any);
                });
              }
            }
          }
        }

        // SETUP CANVAS
        const canvas = document.createElement('canvas');
        canvas.style.display = 'none';
        canvas.style.imageRendering = 'pixelated';
        canvasRef.current = canvas;

        // VIDEO READY HANDLERS
        const onVideoReady = () => {
          if (video.readyState >= 2 && video.videoWidth > 0 && mounted && mountedRef.current) {
            console.log('📹 Video listo:', {
              width: video.videoWidth,
              height: video.videoHeight,
              readyState: video.readyState
            });
            
            setIsStreamActive(true);
            setError(null);
            onStreamReady?.(stream);
            
            if (mounted && mountedRef.current && isMonitoring) {
              startOptimizedCapture();
            }
          }
        };

        // ASEGURAR srcObject DESPUÉS de eventos
        video.addEventListener('loadedmetadata', onVideoReady);
        video.addEventListener('canplay', onVideoReady);
        video.addEventListener('playing', onVideoReady);
        
        // SET srcObject AL FINAL
        video.srcObject = stream;

      } catch (err: any) {
        console.error('❌ ERROR CÁMARA:', err);
        setError(err.message);
        setIsStreamActive(false);
      }
    };

    // SISTEMA DE CAPTURA ULTRA-OPTIMIZADO
    const startOptimizedCapture = () => {
      let frameCount = 0;
      const startTime = performance.now();
      
      const captureLoop = (currentTime: number) => {
        if (!mounted || !mountedRef.current || !isMonitoring || !videoRef.current || !canvasRef.current) {
          return;
        }
        
        if (currentTime - lastCaptureRef.current >= frameIntervalRef.current) {
          try {
            const sample = captureFrame();
            if (sample && onSample) {
              onSample(sample);
              frameCount++;
              
              if (frameCount % 100 === 0) {
                const elapsed = (performance.now() - startTime) / 1000;
                const actualFps = frameCount / elapsed;
                console.log(`📊 Performance: ${actualFps.toFixed(1)} FPS real`);
              }
            }
            lastCaptureRef.current = currentTime;
          } catch (err) {
            console.error('Error captura frame:', err);
          }
        }
        
        rafRef.current = requestAnimationFrame(captureLoop);
      };
      
      rafRef.current = requestAnimationFrame(captureLoop);
      console.log('🎬 Captura de frames iniciada');
    };

    // CAPTURA DE FRAME ULTRA-OPTIMIZADA
    const captureFrame = (): CameraSample | null => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
        return null;
      }

      const centerX = video.videoWidth / 2;
      const centerY = video.videoHeight / 2;
      const roiW = Math.min(roiSize, video.videoWidth * 0.3);
      const roiH = Math.min(roiSize, video.videoHeight * 0.3);
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
      
      ctx.drawImage(video, sx, sy, roiW, roiH, 0, 0, roiW, roiH);
      const imageData = ctx.getImageData(0, 0, roiW, roiH);
      const data = imageData.data;

      let rSum = 0, gSum = 0, bSum = 0;
      let rSum2 = 0, gSum2 = 0, bSum2 = 0;
      let brightSum = 0;
      let brightPixels = 0;
      const threshold = coverageThresholdPixelBrightness;
      const totalPixels = data.length / 4;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1]; 
        const b = data[i + 2];
        const brightness = (r + g + b) * 0.333333;
        
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
      
      const rVar = Math.max(0, rSum2/totalPixels - rMean*rMean);
      const gVar = Math.max(0, gSum2/totalPixels - gMean*gMean);
      const bVar = Math.max(0, bSum2/totalPixels - bMean*bMean);
      
      const rStd = Math.sqrt(rVar);
      const gStd = Math.sqrt(gVar);
      const bStd = Math.sqrt(bVar);
      
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

    cleanupRef.current = performDeepCleanup;
    
    startCamera();

    return () => {
      mounted = false;
      mountedRef.current = false;
      performDeepCleanup();
    };
  }, [isMonitoring]);

  // CLEANUP AL DESMONTAR
  useEffect(() => {
    return () => {
      console.log('🗑️ CameraView desmontando...');
      mountedRef.current = false;
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  return (
    <div className="absolute inset-0 bg-black overflow-hidden">
      <div 
        ref={containerRef}
        className="w-full h-full relative"
        style={{ 
          overflow: 'hidden',
          background: 'radial-gradient(circle at center, #111 0%, #000 100%)'
        }}
      />
      
      {!isStreamActive && isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/95 backdrop-blur-sm">
          <div className="text-white text-center p-6 bg-black/50 rounded-2xl border border-white/10">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4 shadow-lg"></div>
            <p className="text-lg font-medium mb-2">Iniciando cámara PPG optimizada...</p>
            {enableTorch && <p className="text-sm text-white/70 animate-pulse">Activando linterna médica...</p>}
            {error && <p className="text-sm text-red-400 mt-2 bg-red-500/10 p-2 rounded">Error: {error}</p>}
          </div>
        </div>
      )}
      
      {!isMonitoring && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 via-black to-gray-800">
          <div className="text-white text-center p-6 bg-black/30 rounded-2xl backdrop-blur border border-white/10">
            <div className="h-12 w-12 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl shadow-lg">📷</div>
            <p className="text-lg font-medium">Sistema PPG en standby</p>
            <p className="text-sm text-white/60 mt-1">Presiona iniciar para comenzar</p>
          </div>
        </div>
      )}
      
      {torchEnabled && (
        <div className="absolute top-4 right-4 bg-yellow-500/20 border border-yellow-500/30 rounded-full p-3 backdrop-blur">
          <div className="text-yellow-400 text-xl animate-pulse filter drop-shadow-lg">🔦</div>
        </div>
      )}
      
      {isStreamActive && isMonitoring && (
        <div className="absolute bottom-4 left-4 bg-green-500/20 border border-green-500/30 rounded-full px-4 py-2 backdrop-blur">
          <div className="text-green-400 text-sm flex items-center font-medium">
            <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse shadow-lg"></div>
            CAPTURANDO SEÑAL PPG
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraView;
