import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onAuxStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

/**
 * SISTEMA DE CÁMARA SIMPLIFICADO Y ROBUSTO PARA PPG
 * 
 * ESTRATEGIA SIMPLE:
 * 1. Usar facingMode: "environment" para cámara trasera principal
 * 2. Resolución baja para máximo FPS
 * 3. Flash (torch) si está disponible
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    startedRef.current = false;
  };

  /**
   * INICIO SIMPLE DE CÁMARA - Solo facingMode environment
   */
  const startCamera = async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      console.log('📷 Iniciando cámara trasera 720p@60fps...');
      
      // PASO 1: Obtener cámara trasera con 720p y 60fps
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 60, min: 30 }
        }
      }).catch(async () => {
        // Fallback si "exact" falla
        console.log('⚠️ Fallback a facingMode ideal');
        return navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "environment",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60, min: 30 }
          }
        });
      });

      streamRef.current = stream;
      
      // Asignar al video
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      
      // PASO 2: Configurar track para PPG
      const track = stream.getVideoTracks()[0];
      if (track) {
        await configurePPG(track);
      }
      
      // Notificar que el stream está listo
      onStreamReady?.(stream);
      
      // Log de información
      const settings = track?.getSettings?.() || {};
      console.log('✅ Cámara iniciada:', {
        label: track?.label,
        resolution: `${settings.width}x${settings.height}`,
        fps: settings.frameRate
      });
      
    } catch (err) {
      console.error('❌ Error iniciando cámara:', err);
      startedRef.current = false;
    }
  };

  /**
   * CONFIGURAR CÁMARA PARA PPG
   */
  const configurePPG = async (track: MediaStreamTrack) => {
    const caps: any = track.getCapabilities?.() || {};
    
    const applyConstraint = async (constraint: any) => {
      try {
        await track.applyConstraints({ advanced: [constraint] } as any);
        return true;
      } catch { return false; }
    };

    // FLASH (torch) - Lo más importante para PPG
    if (caps.torch === true) {
      await applyConstraint({ torch: true });
      console.log('🔦 Flash/Torch ACTIVADO');
    } else {
      console.log('💡 Sin flash - usando luz ambiente');
      
      // Compensar falta de flash con exposición alta
      if (caps.exposureCompensation?.max) {
        await applyConstraint({ exposureCompensation: caps.exposureCompensation.max });
      }
      if (caps.iso?.max) {
        const highIso = caps.iso.min + (caps.iso.max - caps.iso.min) * 0.8;
        await applyConstraint({ iso: highIso });
      }
    }
    
    // Focus cercano (para dedo)
    if (caps.focusDistance?.min !== undefined) {
      await applyConstraint({ focusDistance: caps.focusDistance.min });
    }
    
    // Modo manual si está disponible (más estable)
    if (caps.exposureMode?.includes?.('manual')) {
      await applyConstraint({ exposureMode: 'manual' });
    }
    if (caps.focusMode?.includes?.('manual')) {
      await applyConstraint({ focusMode: 'manual' });
    }
  };

  // EFECTO: Iniciar/detener cámara según isMonitoring
  useEffect(() => {
    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring]);

  // EFECTO: Mantener torch activo
  useEffect(() => {
    if (!isMonitoring) return;
    
    const interval = setInterval(() => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        const caps: any = track.getCapabilities?.() || {};
        if (caps.torch === true) {
          try {
            track.applyConstraints({ advanced: [{ torch: true }] } as any);
          } catch {}
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isMonitoring]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 0.001,
        pointerEvents: "none",
        // NO transformar - mantener orientación natural
      }}
    />
  );
};

export default CameraView;
