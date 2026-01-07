import React, { useRef, useEffect, useCallback } from "react";

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
  }, []);

  const startCamera = useCallback(async () => {
    if (isActiveRef.current || streamRef.current) return;
    isActiveRef.current = true;

    try {
      // Obtener lista de cámaras
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      tempStream.getTracks().forEach(t => t.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      
      // Buscar cámara trasera principal
      let deviceId: string | undefined;
      const rearCam = cameras.find(cam => {
        const label = cam.label.toLowerCase();
        return (label.includes('back') || label.includes('rear') || label.includes('environment')) &&
               !label.includes('tele') && !label.includes('wide') && !label.includes('ultra');
      });
      
      if (rearCam) {
        deviceId = rearCam.deviceId;
      } else if (cameras.length > 0) {
        deviceId = cameras[cameras.length - 1].deviceId;
      }

      // Obtener stream con configuración PPG óptima
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: deviceId 
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
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
        
        // Aplicar configuración UNA VEZ
        const settings: any[] = [];
        
        // Torch
        if (caps.torch === true) {
          settings.push({ torch: true });
        }
        
        // Exposición media (30% del rango, no máxima para evitar saturación)
        if (caps.exposureCompensation) {
          const range = caps.exposureCompensation.max - caps.exposureCompensation.min;
          settings.push({ exposureCompensation: caps.exposureCompensation.min + range * 0.3 });
        }
        
        // ISO bajo (menos ruido)
        if (caps.iso) {
          settings.push({ iso: Math.min(caps.iso.min + 200, caps.iso.max) });
        }
        
        // Focus cercano
        if (caps.focusDistance?.min !== undefined) {
          settings.push({ focusDistance: caps.focusDistance.min });
        }
        
        // Aplicar TODO de una vez
        if (settings.length > 0) {
          try {
            await track.applyConstraints({ advanced: settings } as any);
          } catch {}
        }
        
        console.log('📷 Cámara lista:', {
          label: track.label.slice(0, 30),
          torch: caps.torch === true,
          fps: track.getSettings?.()?.frameRate || 30
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
