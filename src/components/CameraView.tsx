
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

  // OPTIMIZACIÓN CRÍTICA: Evitar re-renders innecesarios
  const frameIntervalRef = useRef<number>(1000 / targetFps);
  const lastCaptureRef = useRef<number>(0);

  // CLEANUP PROFUNDO - Soluciona degradación después del primer uso
  const performDeepCleanup = () => {
    console.log('🧹 CLEANUP PROFUNDO iniciado...');
    
    // Cancelar RAF
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    
    // Limpiar stream completamente
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      streamRef.current = null;
    }
    
    // Limpiar video element
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.src = '';
      videoRef.current.load();
      videoRef.current = null;
    }
    
    // Limpiar canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      canvasRef.current = null;
    }
    
    // Limpiar DOM container
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    
    // Reset estados
    setIsStreamActive(false);
    setTorchEnabled(false);
    setError(null);
    prevBrightnessRef.current = null;
    
    console.log('✅ CLEANUP PROFUNDO completado');
  };

  useEffect(() => {
    mountedRef.current = true;
    
    if (!isMonitoring) {
      performDeepCleanup();
      return;
    }

    let mounted = true;
    
    const startCamera = async () => {
      try {
        console.log('🎥 INICIANDO CÁMARA OPTIMIZADA VERSIÓN 2.0...');
        
        // Cleanup preventivo
        performDeepCleanup();
        
        // CONSTRAINTS MEJORADAS - Sin facingMode problemático
        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: targetFps, min: 15 },
            aspectRatio: { ideal: 16/9 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (!mounted || !mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        console.log('📹 Stream obtenido:', stream.getVideoTracks()[0].getSettings());
        
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
        video.srcObject = stream;
        
        videoRef.current = video;

        // FORZAR AGREGADO AL DOM - SIEMPRE
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(video);
          console.log('✅ Video agregado al DOM forzadamente');
        }

        // LINTERNA - MÉTODO AGRESIVO Y MÚLTIPLE
        if (enableTorch) {
          const videoTrack = stream.getVideoTracks()[0];
          console.log('🔦 Intentando activar linterna...', videoTrack.getCapabilities());
          
          // MÉTODO 1: Torch capability check + apply
          try {
            const capabilities = videoTrack.getCapabilities();
            if (capabilities.torch) {
              await videoTrack.applyConstraints({
                advanced: [{ torch: true }]
              });
              setTorchEnabled(true);
              console.log('🔦 ✅ LINTERNA ACTIVADA - Método 1 (capabilities)');
            } else {
              console.log('🔦 ❌ Torch no disponible en capabilities');
            }
          } catch (e1) {
            console.log('🔦 Método 1 falló:', e1);
            
            // MÉTODO 2: Forzar torch sin verificar capabilities
            try {
              await videoTrack.applyConstraints({
                torch: true as any
              });
              setTorchEnabled(true);
              console.log('🔦 ✅ LINTERNA ACTIVADA - Método 2 (forzado)');
            } catch (e2) {
              console.log('🔦 Método 2 falló:', e2);
              
              // MÉTODO 3: Advanced constraints con exposición manual
              try {
                await videoTrack.applyConstraints({
                  advanced: [{ 
                    torch: true,
                    exposureMode: 'manual' as any,
                    exposureCompensation: { exact: 2.0 } as any
                  }]
                });
                setTorchEnabled(true);
                console.log('🔦 ✅ LINTERNA ACTIVADA - Método 3 (advanced + exposure)');
              } catch (e3) {
                console.log('🔦 Todos los métodos fallaron:', e3);
                console.log('🔦 ⚠️ Continuando sin linterna...');
              }
            }
          }
        }

        // CANVAS OPTIMIZADO MEJORADO
        const canvas = document.createElement('canvas');
        canvas.style.display = 'none';
        canvas.style.imageRendering = 'pixelated';
        canvasRef.current = canvas;

        // ESPERAR VIDEO READY Y INICIAR CAPTURA
        const onVideoReady = () => {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            console.log('📹 Video listo:', {
              width: video.videoWidth,
              height: video.videoHeight,
              readyState: video.readyState
            });
            
            setIsStreamActive(true);
            setError(null);
            onStreamReady?.(stream);
            
            // INICIAR CAPTURA OPTIMIZADA
            if (mounted && mountedRef.current && isMonitoring) {
              startOptimizedCapture();
            }
          }
        };

        video.addEventListener('loadedmetadata', onVideoReady);
        video.addEventListener('canplay', onVideoReady);
        video.addEventListener('playing', onVideoReady);

      } catch (err: any) {
        console.error('❌ ERROR CÁMARA:', err);
        setError(err.message);
        setIsStreamActive(false);
      }
    };

    // SISTEMA DE CAPTURA ULTRA-OPTIMIZADO V2
    const startOptimizedCapture = () => {
      let frameCount = 0;
      const startTime = performance.now();
      
      const captureLoop = (currentTime: number) => {
        if (!mounted || !mountedRef.current || !isMonitoring || !videoRef.current || !canvasRef.current) {
          return;
        }
        
        // THROTTLING INTELIGENTE - Solo capturar si pasó suficiente tiempo
        if (currentTime - lastCaptureRef.current >= frameIntervalRef.current) {
          try {
            const sample = captureFrame();
            if (sample && onSample) {
              onSample(sample);
              frameCount++;
              
              // Log de performance cada 100 frames
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

    // CAPTURA DE FRAME ULTRA-OPTIMIZADA V2
    const captureFrame = (): CameraSample | null => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
        return null;
      }

      // ROI OPTIMIZADA - Centrada y proporcional
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

    // Guardar función de cleanup
    cleanupRef.current = performDeepCleanup;
    
    startCamera();

    // CLEANUP MEJORADO
    return () => {
      mounted = false;
      mountedRef.current = false;
      performDeepCleanup();
    };
  }, [isMonitoring]);

  // Cleanup al desmontar componente
  useEffect(() => {
    return () => {
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
      
      {/* INDICADORES OPTIMIZADOS */}
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
      
      {/* INDICADORES DE ESTADO MEJORADOS */}
      {torchEnabled && (
        <div className="absolute top-4 left-4 bg-yellow-500/20 border border-yellow-500/30 rounded-full p-3 backdrop-blur">
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
