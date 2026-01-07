import React, { useRef, useEffect, useCallback } from "react";
import { globalCalibrator } from "@/modules/camera/CameraAutoCalibrator";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - VERSIÓN ULTRA-LIGERA
 * 
 * PRINCIPIOS:
 * 1. Mínima lógica - solo captura y entrega stream
 * 2. SIN intervalos acumulativos
 * 3. Torch aplicado una vez y listo
 * 4. Cleanup completo en desmontaje
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isActiveRef = useRef(false);

  const stopCamera = useCallback(() => {
    isActiveRef.current = false;
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    globalCalibrator.reset();
  }, []);

  const startCamera = useCallback(async () => {
    // Evitar múltiples inicios
    if (isActiveRef.current) return;
    
    // Limpiar stream anterior si existe
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => { try { t.stop(); } catch {} });
      streamRef.current = null;
    }
    
    isActiveRef.current = true;

    try {
      // Intentar obtener cámara trasera directamente (sin tempStream)
      let stream: MediaStream | null = null;
      
      // Primer intento: cámara trasera con facingMode
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }
        });
      } catch {
        // Segundo intento: cualquier cámara
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }
        });
      }
      
      if (!stream) {
        throw new Error('No se pudo obtener stream');
      }
      
      // Verificar que seguimos activos
      if (!isActiveRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Configurar track para PPG
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps: any = track.getCapabilities?.() || {};
        
        // Configurar calibrador con el track
        globalCalibrator.setTrack(track);
        
        // Aplicar torch primero (separado para mayor compatibilidad)
        if (caps.torch === true) {
          try {
            await track.applyConstraints({ advanced: [{ torch: true }] } as any);
          } catch {}
        }
        
        // Aplicar resto de configuración
        const settings: any[] = [];
        
        // Exposición media (30% del rango)
        if (caps.exposureCompensation) {
          const range = caps.exposureCompensation.max - caps.exposureCompensation.min;
          settings.push({ exposureCompensation: caps.exposureCompensation.min + range * 0.3 });
        }
        
        // ISO bajo
        if (caps.iso) {
          settings.push({ iso: Math.min(caps.iso.min + 200, caps.iso.max) });
        }
        
        // Focus cercano
        if (caps.focusDistance?.min !== undefined) {
          settings.push({ focusDistance: caps.focusDistance.min });
        }
        
        if (settings.length > 0) {
          try {
            await track.applyConstraints({ advanced: settings } as any);
          } catch {}
        }
        
        const s = track.getSettings?.() || {};
        console.log('📷 Cámara lista:', {
          res: `${s.width}x${s.height}`,
          fps: s.frameRate,
          torch: caps.torch === true
        });
      }

      onStreamReady?.(stream);

    } catch (err) {
      console.error('❌ Error cámara:', err);
      isActiveRef.current = false;
    }
  }, [onStreamReady]);

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
      disablePictureInPicture
      disableRemotePlayback
      style={{
        position: "absolute",
        inset: 0,
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
