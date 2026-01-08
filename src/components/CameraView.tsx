import React, { useRef, useEffect } from "react";
import { globalCameraController } from "@/modules/camera/CameraController";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - CON SELECCIÓN INTELIGENTE DE CÁMARA
 * 
 * Características:
 * 1. Selección automática de cámara trasera principal (evita ultra-wide, macro)
 * 2. Inicialización optimizada para PPG
 * 3. Integración con CameraController para ajustes dinámicos
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const onStreamReadyRef = useRef(onStreamReady);
  
  // Mantener ref actualizada sin causar re-render
  useEffect(() => {
    onStreamReadyRef.current = onStreamReady;
  }, [onStreamReady]);

  useEffect(() => {
    let mounted = true;
    
    const stopCamera = async () => {
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        
        // Apagar torch ANTES de detener tracks
        for (const track of tracks) {
          if (track.kind === 'video') {
            try {
              const caps: any = track.getCapabilities?.() || {};
              if (caps.torch) {
                await track.applyConstraints({ advanced: [{ torch: false }] } as any);
              }
            } catch {}
          }
          try { track.stop(); } catch {}
        }
        
        streamRef.current = null;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      isStartingRef.current = false;
      globalCameraController.reset();
    };
    
    /**
     * Selecciona la cámara trasera principal, evitando ultra-wide, macro, telephoto
     */
    const selectMainBackCamera = async (): Promise<string | null> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        
        if (cameras.length === 0) return null;
        
        // Buscar cámara trasera principal
        const mainBack = cameras.find(cam => {
          const label = cam.label.toLowerCase();
          const isBack = label.includes('back') || label.includes('rear') || 
                         label.includes('trasera') || label.includes('0,') ||
                         label.includes('facing back');
          const isNotSpecial = !label.includes('ultra') && 
                               !label.includes('wide') && 
                               !label.includes('macro') && 
                               !label.includes('tele') &&
                               !label.includes('depth');
          return isBack && isNotSpecial;
        });
        
        if (mainBack) return mainBack.deviceId;
        
        // Fallback: cualquier cámara trasera
        const anyBack = cameras.find(cam => {
          const label = cam.label.toLowerCase();
          return label.includes('back') || label.includes('rear') || label.includes('trasera');
        });
        
        return anyBack?.deviceId || cameras[0]?.deviceId || null;
      } catch {
        return null;
      }
    };

    const startCamera = async () => {
      // Evitar múltiples inicios simultáneos
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      
      // Limpiar stream anterior
      await stopCamera();
      
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

      try {
        let stream: MediaStream;
        
        // PASO 1: Intentar seleccionar cámara principal por deviceId
        const mainCameraId = await selectMainBackCamera();
        
        try {
          if (mainCameraId) {
            // Usar deviceId específico para cámara principal
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: mainCameraId },
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
              }
            });
          } else {
            // Fallback: facingMode environment
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: { exact: "environment" },
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
              }
            });
          }
        } catch {
          // Fallback final: cualquier cámara
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 }
            }
          });
        }
        
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          isStartingRef.current = false;
          return;
        }

        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        // PASO 2: Configurar track con CameraController
        const track = stream.getVideoTracks()[0];
        if (track) {
          // Usar el nuevo CameraController para configuración inicial
          await globalCameraController.setTrack(track);
        }

        onStreamReadyRef.current?.(stream);
        isStartingRef.current = false;

      } catch (err) {
        console.error('❌ Error cámara:', err);
        isStartingRef.current = false;
      }
    };

    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      mounted = false;
      stopCamera();
    };
  }, [isMonitoring]); // SOLO depende de isMonitoring

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
