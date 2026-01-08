import React, { useRef, useEffect, useCallback } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - NUEVA IMPLEMENTACIÓN SIMPLIFICADA
 * 
 * Principios:
 * 1. getUserMedia simple y directo
 * 2. Sin auto-calibradores complejos
 * 3. Flash básico sin complicaciones
 * 4. Cleanup robusto
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isActiveRef = useRef(false);
  
  const stopCamera = useCallback(async () => {
    if (streamRef.current) {
      const tracks = streamRef.current.getTracks();
      
      // Apagar flash primero
      for (const track of tracks) {
        if (track.kind === 'video') {
          try {
            await (track as any).applyConstraints({ 
              advanced: [{ torch: false }] 
            });
          } catch {}
        }
        track.stop();
      }
      
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    isActiveRef.current = false;
  }, []);

  const startCamera = useCallback(async () => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;
    
    await stopCamera();

    try {
      // PASO 1: Obtener stream con constraints simples
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 }
        }
      };
      
      let stream: MediaStream;
      
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e) {
        // Fallback sin facingMode
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
          }
        });
      }
      
      if (!isActiveRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      
      // PASO 2: Conectar al video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {}
      }

      // PASO 3: Configurar track (flash, exposición)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities = videoTrack.getCapabilities?.() as any || {};
        
        // Encender flash si disponible
        if (capabilities.torch) {
          try {
            await videoTrack.applyConstraints({
              advanced: [{ torch: true }]
            } as any);
            console.log('🔦 Flash encendido');
          } catch (e) {
            console.log('⚠️ No se pudo encender flash');
          }
        }
        
        // Ajustes opcionales de exposición
        const advancedSettings: any[] = [];
        
        if (capabilities.exposureMode?.includes('manual')) {
          advancedSettings.push({ exposureMode: 'manual' });
        }
        
        if (capabilities.exposureCompensation) {
          const mid = (capabilities.exposureCompensation.min + capabilities.exposureCompensation.max) / 2;
          advancedSettings.push({ exposureCompensation: mid * 0.5 });
        }
        
        if (capabilities.focusMode?.includes('manual') && capabilities.focusDistance) {
          advancedSettings.push({ 
            focusMode: 'manual',
            focusDistance: capabilities.focusDistance.min 
          });
        }
        
        if (advancedSettings.length > 0) {
          try {
            await videoTrack.applyConstraints({ advanced: advancedSettings } as any);
          } catch {}
        }

        console.log('📷 Cámara iniciada', {
          torch: capabilities.torch || false,
          resolution: `${videoTrack.getSettings().width}x${videoTrack.getSettings().height}`
        });
      }

      // PASO 4: Notificar que el stream está listo
      onStreamReady?.(stream);

    } catch (err) {
      console.error('❌ Error iniciando cámara:', err);
      isActiveRef.current = false;
    }
  }, [onStreamReady, stopCamera]);

  useEffect(() => {
    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      stopCamera();
    };
  }, [isMonitoring, startCamera, stopCamera]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 0.001,
        pointerEvents: "none",
      }}
    />
  );
};

export default CameraView;
