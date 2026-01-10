import React, { useRef, useEffect } from "react";
import { globalCameraController } from "@/modules/camera/CameraController";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - MODO RAW
 * 
 * - Solo cámara trasera principal
 * - Sin efectos, sin espejo, sin filtros
 * - Flash encendido
 * - Datos crudos directos
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

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      
      await stopCamera();
      
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

      try {
        // Configuración simple: cámara trasera, baja resolución, 30fps
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 320 },
            height: { ideal: 240 },
            frameRate: { ideal: 30 }
          }
        });
        
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

        // Solo encender flash
        const track = stream.getVideoTracks()[0];
        if (track) {
          await globalCameraController.setTrack(track);
          const settings = track.getSettings();
          console.log(`📹 Cámara: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);
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
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 0.001,
        pointerEvents: "none",
        // FORZAR SIN ESPEJO - Modo RAW
        transform: "none",
        WebkitTransform: "none",
        MozTransform: "none",
        msTransform: "none",
        OTransform: "none",
        // Sin escala ni flip
        scale: "1",
      }}
    />
  );
};

export default CameraView;