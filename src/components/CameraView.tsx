
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Fingerprint, Flashlight } from 'lucide-react';
import { FrameProcessor } from '../modules/signal-processing/FrameProcessor';
import { CameraSample } from '../types';

interface CameraViewProps {
  onSample: (sample: CameraSample) => void;
  isMonitoring: boolean;
  targetFps?: number;
  roiSize?: number;
  enableTorch?: boolean;
  coverageThresholdPixelBrightness?: number;
}

const CameraView = ({ 
  onSample, 
  isMonitoring, 
  targetFps = 30,
  roiSize = 240,
  enableTorch = false,
  coverageThresholdPixelBrightness = 20
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<FrameProcessor | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [fingerDetected, setFingerDetected] = useState(false);
  const lastFrameTimeRef = useRef(0);
  const frameIntervalMs = 1000 / targetFps;

  // CLEANUP TOTAL Y PROFUNDO
  const performDeepCleanup = useCallback(async () => {
    console.log('🧹 CLEANUP PROFUNDO CameraView iniciado...');
    
    try {
      // Parar animaciones
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Limpiar flags
      isProcessingRef.current = false;
      setFingerDetected(false);
      
      // APAGAR LINTERNA CORRECTAMENTE
      if (streamRef.current && torchEnabled) {
        const videoTrack = streamRef.current.getVideoTracks()[0];
        if (videoTrack && videoTrack.getCapabilities && videoTrack.applyConstraints) {
          try {
            await videoTrack.applyConstraints({
              advanced: [{ torch: false }]
            });
            console.log('✅ Linterna apagada correctamente');
          } catch (error) {
            console.log('⚠️ Error apagando linterna:', error);
          }
        }
        setTorchEnabled(false);
      }
      
      // Parar stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('🛑 Track detenido:', track.kind);
        });
        streamRef.current = null;
      }
      
      // Limpiar video
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
        videoRef.current.currentTime = 0;
      }
      
      // Reset procesador
      if (processorRef.current) {
        processorRef.current = null;
      }
      
      console.log('✅ CLEANUP PROFUNDO CameraView completado');
    } catch (error) {
      console.error('❌ Error en cleanup profundo:', error);
    }
  }, [torchEnabled]);

  // ACTIVACIÓN DE LINTERNA MEJORADA - 4 MÉTODOS
  const activateTorch = useCallback(async () => {
    if (!streamRef.current) return false;
    
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return false;
    
    try {
      // MÉTODO 1: Constraint torch directo
      if (videoTrack.getCapabilities && videoTrack.applyConstraints) {
        const capabilities = videoTrack.getCapabilities();
        if (capabilities.torch) {
          await videoTrack.applyConstraints({
            advanced: [{ torch: true }]
          });
          console.log('✅ Linterna activada - Método 1 (torch constraint)');
          return true;
        }
      }
      
      // MÉTODO 2: Constraint flashlight
      try {
        await videoTrack.applyConstraints({
          advanced: [{ flashlight: true }]
        });
        console.log('✅ Linterna activada - Método 2 (flashlight constraint)');
        return true;
      } catch {}
      
      // MÉTODO 3: ImageCapture API
      if ('ImageCapture' in window) {
        try {
          const imageCapture = new (window as any).ImageCapture(videoTrack);
          await imageCapture.setOptions({ torch: true });
          console.log('✅ Linterna activada - Método 3 (ImageCapture)');
          return true;
        } catch {}
      }
      
      // MÉTODO 4: Media Capabilities API
      if ((navigator as any).mediaDevices && (navigator as any).mediaDevices.getSupportedConstraints) {
        const supportedConstraints = (navigator as any).mediaDevices.getSupportedConstraints();
        if (supportedConstraints.torch || supportedConstraints.flashlight) {
          await videoTrack.applyConstraints({
            torch: true
          });
          console.log('✅ Linterna activada - Método 4 (Media Capabilities)');
          return true;
        }
      }
      
      console.log('⚠️ Ningún método de linterna disponible');
      return false;
      
    } catch (error) {
      console.error('❌ Error activando linterna:', error);
      return false;
    }
  }, []);

  const startCamera = useCallback(async () => {
    console.log('🎥 INICIANDO CÁMARA OPTIMIZADA VERSIÓN 2.0...');
    
    try {
      // Cleanup preventivo
      await performDeepCleanup();
      
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
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error('Video element not available'));
            return;
          }
          
          videoRef.current.onloadedmetadata = () => {
            if (videoRef.current) {
              videoRef.current.play()
                .then(() => {
                  console.log('✅ Video iniciado correctamente');
                  resolve();
                })
                .catch(reject);
            }
          };
          
          videoRef.current.onerror = reject;
        });
        
        // Activar linterna si está habilitada
        if (enableTorch) {
          const torchActivated = await activateTorch();
          setTorchEnabled(torchActivated);
        }
        
        // Inicializar procesador
        processorRef.current = new FrameProcessor(roiSize, coverageThresholdPixelBrightness);
        
        console.log('✅ Cámara iniciada exitosamente');
      }
    } catch (error) {
      console.error('❌ ERROR CÁMARA:', error);
      throw error;
    }
  }, [performDeepCleanup, targetFps, enableTorch, activateTorch, roiSize, coverageThresholdPixelBrightness]);

  const processFrame = useCallback(() => {
    if (!isMonitoring || !videoRef.current || !processorRef.current || isProcessingRef.current) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    const currentTime = performance.now();
    if (currentTime - lastFrameTimeRef.current < frameIntervalMs) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }
    
    isProcessingRef.current = true;
    lastFrameTimeRef.current = currentTime;
    
    try {
      const sample = processorRef.current.processVideoFrame(videoRef.current, Date.now());
      
      if (sample) {
        const isFingerPresent = sample.coverageRatio > 0.3 && sample.rMean > 40;
        setFingerDetected(isFingerPresent);
        onSample(sample);
      }
    } catch (error) {
      console.error('Error procesando frame:', error);
    } finally {
      isProcessingRef.current = false;
    }
    
    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [isMonitoring, onSample, frameIntervalMs]);

  // EFECTO PRINCIPAL DE MONITOREO
  useEffect(() => {
    console.log(`🛑 isMonitoring=${isMonitoring}, ejecutando ${isMonitoring ? 'inicio' : 'cleanup'}...`);
    
    if (isMonitoring) {
      startCamera()
        .then(() => {
          processFrame();
        })
        .catch(console.error);
    } else {
      performDeepCleanup();
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isMonitoring, startCamera, processFrame, performDeepCleanup]);

  // CLEANUP AL DESMONTAR
  useEffect(() => {
    return () => {
      console.log('🗑️ CameraView desmontando...');
      performDeepCleanup();
    };
  }, [performDeepCleanup]);

  return (
    <div className="relative w-full h-full bg-gray-900 overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        style={{
          filter: 'brightness(1.1) contrast(1.2) saturate(0.8)',
          transform: 'scaleX(-1)'
        }}
      />
      
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
      
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center space-x-4">
        {enableTorch && (
          <div className={`flex items-center space-x-2 px-3 py-2 rounded-full ${
            torchEnabled ? 'bg-yellow-500/30' : 'bg-gray-500/30'
          } backdrop-blur-md border border-white/20`}>
            <Flashlight className={`w-5 h-5 ${
              torchEnabled ? 'text-yellow-300' : 'text-gray-300'
            }`} />
            <span className="text-xs text-white font-medium">
              {torchEnabled ? 'ON' : 'OFF'}
            </span>
          </div>
        )}
        
        <div className={`flex items-center space-x-2 px-3 py-2 rounded-full ${
          fingerDetected ? 'bg-green-500/30' : 'bg-red-500/30'
        } backdrop-blur-md border border-white/20`}>
          <Fingerprint className={`w-5 h-5 ${
            fingerDetected ? 'text-green-300 animate-pulse' : 'text-red-300'
          }`} />
          <span className="text-xs text-white font-medium">
            {fingerDetected ? 'DETECTADO' : 'SIN DEDO'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraView;
