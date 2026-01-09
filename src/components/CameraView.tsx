import React, { useRef, useEffect } from "react";
import { globalCameraController } from "@/modules/camera/CameraController";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - SOLO CÁMARA TRASERA PRINCIPAL
 * 
 * Características:
 * 1. SOLO cámara trasera principal (camera0, facing back)
 * 2. SIN sensores auxiliares (ultra-wide, macro, depth, telephoto)
 * 3. 60 FPS, baja resolución
 * 4. Flash siempre encendido
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const onStreamReadyRef = useRef(onStreamReady);
  
  useEffect(() => {
    onStreamReadyRef.current = onStreamReady;
  }, [onStreamReady]);

  useEffect(() => {
    let mounted = true;
    
    const stopCamera = async () => {
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        
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
     * Selecciona SOLO la cámara trasera principal
     * Excluye: ultra-wide, macro, telephoto, depth, angular
     */
    const selectMainBackCamera = async (): Promise<string | null> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        
        console.log('📷 Cámaras disponibles:', cameras.map(c => c.label));
        
        if (cameras.length === 0) return null;
        
        // Buscar cámara trasera PRINCIPAL - excluir TODOS los sensores especiales
        const mainBack = cameras.find(cam => {
          const label = cam.label.toLowerCase();
          
          // Debe ser trasera
          const isBack = label.includes('back') || 
                         label.includes('rear') || 
                         label.includes('trasera') ||
                         label.includes('facing back') ||
                         label.includes('camera 0') ||
                         label.includes('camera0');
          
          // NO debe ser sensor especial
          const isSpecialSensor = 
            label.includes('ultra') ||
            label.includes('wide') ||
            label.includes('macro') ||
            label.includes('tele') ||
            label.includes('depth') ||
            label.includes('angular') ||
            label.includes('zoom') ||
            label.includes('aux') ||
            label.includes('secondary') ||
            label.includes('2') ||
            label.includes('3') ||
            label.includes('4');
          
          return isBack && !isSpecialSensor;
        });
        
        if (mainBack) {
          console.log('✅ Cámara principal seleccionada:', mainBack.label);
          return mainBack.deviceId;
        }
        
        // Fallback: primera cámara trasera sin filtro de sensores
        const anyBack = cameras.find(cam => {
          const label = cam.label.toLowerCase();
          return label.includes('back') || label.includes('rear') || label.includes('trasera');
        });
        
        if (anyBack) {
          console.log('⚠️ Usando cámara trasera alternativa:', anyBack.label);
          return anyBack.deviceId;
        }
        
        console.log('⚠️ Usando primera cámara disponible');
        return cameras[0]?.deviceId || null;
      } catch {
        return null;
      }
    };

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      
      await stopCamera();
      
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

      try {
        let stream: MediaStream;
        
        const mainCameraId = await selectMainBackCamera();
        
        // Configuración: BAJA resolución, 60 FPS
        const videoConstraints = {
          width: { ideal: 320, max: 480 },
          height: { ideal: 240, max: 360 },
          frameRate: { ideal: 60, min: 30 }
        };
        
        try {
          if (mainCameraId) {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: mainCameraId },
                ...videoConstraints
              }
            });
          } else {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: { exact: "environment" },
                ...videoConstraints
              }
            });
          }
        } catch {
          // Fallback final
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: videoConstraints
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

        const track = stream.getVideoTracks()[0];
        if (track) {
          const settings = track.getSettings();
          console.log(`📹 Cámara iniciada: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);
          
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
        transform: "none", // SIN efecto espejo
      }}
    />
  );
};

export default CameraView;