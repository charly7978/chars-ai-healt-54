import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - SELECCIÓN ROBUSTA POR DEVICE ID
 * 
 * Estrategia: enumerar cámaras, filtrar traseras por label,
 * seleccionar la PRIMERA (principal), NO la segunda (telefoto/wide)
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
   * OBTENER LA CÁMARA TRASERA PRINCIPAL
   * 1. Enumerar todos los dispositivos
   * 2. Filtrar cámaras traseras por label (back, rear, environment, trasera, 0)
   * 3. Excluir cámaras secundarias (telephoto, wide, ultra, 2, 3)
   * 4. Seleccionar la PRIMERA que quede
   */
  const getPrimaryRearCameraId = async (): Promise<string | null> => {
    try {
      // Primero pedir permiso genérico para obtener labels
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
        // Es trasera si contiene estas palabras
        const isRear = label.includes('back') || 
                       label.includes('rear') || 
                       label.includes('environment') ||
                       label.includes('trasera') ||
                       label.includes('facing back') ||
                       label.includes('camera 0') ||
                       label.includes('camera0');
        return isRear;
      });
      
      // Excluir cámaras secundarias (telefoto, wide, ultra)
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
      
      console.log('📷 Cámaras traseras principales:', primaryCameras.map(c => c.label));
      
      // Retornar la primera cámara principal, o la primera trasera, o null
      if (primaryCameras.length > 0) {
        return primaryCameras[0].deviceId;
      }
      if (rearCameras.length > 0) {
        return rearCameras[0].deviceId;
      }
      
      // Si no encontramos trasera por label, intentar la primera cámara
      // (en móviles suele ser la frontal, así que usamos la última)
      if (cameras.length > 1) {
        return cameras[cameras.length - 1].deviceId;
      }
      if (cameras.length === 1) {
        return cameras[0].deviceId;
      }
      
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
      console.log('📷 Buscando cámara trasera principal...');
      
      // PASO 1: Obtener ID de cámara principal
      const primaryCameraId = await getPrimaryRearCameraId();
      
      let stream: MediaStream;
      
      if (primaryCameraId) {
        console.log('📷 Usando cámara por deviceId:', primaryCameraId.slice(0, 8));
        // Usar deviceId exacto - esto GARANTIZA la cámara correcta
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
        console.log('⚠️ No se encontró cámara por ID, usando facingMode');
        // Fallback a facingMode
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
      
      // Configurar para PPG
      const track = stream.getVideoTracks()[0];
      if (track) {
        await configurePPG(track);
        
        const settings = track.getSettings?.() || {};
        console.log('✅ Cámara iniciada:', {
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
      console.log('💡 Sin flash - compensando con exposición');
      if (caps.exposureCompensation?.max) {
        await applyConstraint({ exposureCompensation: caps.exposureCompensation.max });
      }
      if (caps.iso?.max) {
        await applyConstraint({ iso: Math.min(caps.iso.max, 1600) });
      }
    }
    
    // Focus cercano para dedo
    if (caps.focusDistance?.min !== undefined) {
      await applyConstraint({ focusDistance: caps.focusDistance.min });
    }
    
    // Modo manual para estabilidad
    if (caps.exposureMode?.includes?.('manual')) {
      await applyConstraint({ exposureMode: 'manual' });
    }
    if (caps.focusMode?.includes?.('manual')) {
      await applyConstraint({ focusMode: 'manual' });
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

  // Mantener torch activo
  useEffect(() => {
    if (!isMonitoring) return;
    
    const interval = setInterval(() => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        const caps: any = track.getCapabilities?.() || {};
        if (caps.torch === true) {
          track.applyConstraints({ advanced: [{ torch: true }] } as any).catch(() => {});
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
      }}
    />
  );
};

export default CameraView;
