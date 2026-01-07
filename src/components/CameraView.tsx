import React, { useRef, useEffect } from "react";
import { CameraAutoCalibrator } from "@/modules/camera/CameraAutoCalibrator";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onCalibrationUpdate?: (state: { brightness: number; recommendation: string }) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - CON AUTO-CALIBRACIÓN INTELIGENTE
 * 
 * Basado en HKUST 2023: "Optimizing Camera Exposure Control Settings"
 * 
 * CAMBIOS CLAVE:
 * 1. NO maximizar exposición (causa saturación)
 * 2. Buscar brillo óptimo: 80-160 (no saturado ni oscuro)
 * 3. Auto-ajustar según señal PPG recibida
 * 4. Priorizar exposición sobre ISO (menos ruido)
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onCalibrationUpdate,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);
  const calibratorRef = useRef<CameraAutoCalibrator | null>(null);
  const torchAppliedRef = useRef(false);

  // Inicializar calibrador
  useEffect(() => {
    if (!calibratorRef.current) {
      calibratorRef.current = new CameraAutoCalibrator();
    }
    return () => {
      calibratorRef.current?.reset();
    };
  }, []);

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
    calibratorRef.current?.reset();
  };

  /**
   * OBTENER LA CÁMARA TRASERA PRINCIPAL
   */
  const getPrimaryRearCameraId = async (): Promise<string | null> => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ 
        video: true, audio: false 
      });
      tempStream.getTracks().forEach(t => t.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(d => d.kind === 'videoinput');
      
      console.log('📷 Cámaras disponibles:', cameras.map(c => ({
        id: c.deviceId.slice(0, 8),
        label: c.label
      })));
      
      // Filtrar cámaras traseras
      const rearCameras = cameras.filter(cam => {
        const label = cam.label.toLowerCase();
        return label.includes('back') || 
               label.includes('rear') || 
               label.includes('environment') ||
               label.includes('trasera') ||
               label.includes('facing back') ||
               label.includes('camera 0') ||
               label.includes('camera0');
      });
      
      // Excluir cámaras secundarias
      const primaryCameras = rearCameras.filter(cam => {
        const label = cam.label.toLowerCase();
        const isSecondary = label.includes('telephoto') ||
                            label.includes('tele') ||
                            label.includes('wide') ||
                            label.includes('ultra') ||
                            label.includes('macro') ||
                            label.includes('depth') ||
                            label.includes('camera 1') ||
                            label.includes('camera 2') ||
                            label.includes('camera 3') ||
                            label.includes('camera1') ||
                            label.includes('camera2');
        return !isSecondary;
      });
      
      if (primaryCameras.length > 0) return primaryCameras[0].deviceId;
      if (rearCameras.length > 0) return rearCameras[0].deviceId;
      if (cameras.length > 1) return cameras[cameras.length - 1].deviceId;
      if (cameras.length === 1) return cameras[0].deviceId;
      
      return null;
    } catch (err) {
      console.error('Error enumerando cámaras:', err);
      return null;
    }
  };

  const startCamera = async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      console.log('📷 Iniciando cámara con auto-calibración...');
      
      const primaryCameraId = await getPrimaryRearCameraId();
      
      let stream: MediaStream;
      
      if (primaryCameraId) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: primaryCameraId },
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            frameRate: { ideal: 60, min: 30 }
          }
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60, min: 30 }
          }
        });
      }

      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      
      // Configurar con AUTO-CALIBRADOR
      const track = stream.getVideoTracks()[0];
      if (track && calibratorRef.current) {
        // Detectar capacidades
        await calibratorRef.current.detectCapabilities(track);
        
        // Aplicar configuración óptima (NO máxima)
        await calibratorRef.current.applyOptimalPPGSettings(track);
        
        const settings = track.getSettings?.() || {};
        console.log('✅ Cámara PPG calibrada:', {
          label: track.label,
          resolution: `${settings.width}x${settings.height}`,
          fps: settings.frameRate
        });
      }
      
      onStreamReady?.(stream);
      
    } catch (err) {
      console.error('❌ Error iniciando cámara:', err);
      startedRef.current = false;
    }
  };

  useEffect(() => {
    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [isMonitoring]);

  useEffect(() => {
    if (!isMonitoring) {
      torchAppliedRef.current = false;
      return;
    }
    
    // Aplicar torch UNA SOLA VEZ cuando inicia
    if (!torchAppliedRef.current && streamRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        const caps: any = track.getCapabilities?.() || {};
        if (caps.torch === true) {
          track.applyConstraints({ advanced: [{ torch: true }] } as any)
            .then(() => { torchAppliedRef.current = true; })
            .catch(() => {});
        }
      }
    }
    
    // Reportar calibración cada 5 segundos (no cada 2s)
    const interval = setInterval(() => {
      if (calibratorRef.current && onCalibrationUpdate) {
        const state = calibratorRef.current.getState();
        onCalibrationUpdate({
          brightness: state.currentBrightness,
          recommendation: state.recommendation
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isMonitoring, onCalibrationUpdate]);

  // Exponer calibrador para uso externo
  useEffect(() => {
    if (streamRef.current && calibratorRef.current) {
      const track = streamRef.current.getVideoTracks()[0];
      if (track) {
        // Guardar referencia global para que FrameProcessor pueda usarlo
        (window as any).__cameraCalibrator = calibratorRef.current;
      }
    }
    return () => {
      delete (window as any).__cameraCalibrator;
    };
  }, [isMonitoring]);

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
        transform: "none",
        filter: "none",
      }}
    />
  );
};

export default CameraView;

// Exportar tipo del calibrador para uso en otros módulos
export type { CameraAutoCalibrator };
