import React, { useRef, useEffect } from "react";
import { globalCalibrator } from "@/modules/camera/CameraAutoCalibrator";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - VERSIÓN ESTABLE
 * 
 * PRINCIPIOS:
 * 1. SIN useCallback para evitar re-renders
 * 2. Refs para todo el estado mutable
 * 3. Cleanup completo con torch apagado
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
      globalCalibrator.reset();
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
        
        // Intentar cámara trasera
        try {
          // OPTIMIZADO: 640x480 es suficiente para PPG según literatura científica
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { exact: "environment" },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 }
            }
          });
        } catch {
          // Fallback: cualquier cámara
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

        // Configurar track
        const track = stream.getVideoTracks()[0];
        if (track) {
          const caps: any = track.getCapabilities?.() || {};
          
          globalCalibrator.setTrack(track);
          
          // Torch
          if (caps.torch === true) {
            try {
              await track.applyConstraints({ advanced: [{ torch: true }] } as any);
            } catch {}
          }
          
          // Exposición y otros ajustes
          const settings: any[] = [];
          
          // PPG CIENTÍFICO: Exposición BAJA para evitar saturación con flash+dedo
          if (caps.exposureCompensation) {
            const range = caps.exposureCompensation.max - caps.exposureCompensation.min;
            // 25% de exposición - literatura científica recomienda exposición mínima
            const targetExposure = caps.exposureCompensation.min + range * 0.25;
            settings.push({ exposureCompensation: targetExposure });
            console.log(`📷 Exposición inicial: ${targetExposure.toFixed(1)} (25% del rango)`);
          }
          
          // ISO MÍNIMO para reducir ruido
          if (caps.iso) {
            settings.push({ iso: caps.iso.min });
            console.log(`📷 ISO: ${caps.iso.min} (mínimo)`);
          }
          
          // White Balance manual para maximizar canal rojo
          if (caps.whiteBalanceMode) {
            settings.push({ whiteBalanceMode: 'manual' });
          }
          if (caps.colorTemperature) {
            // Temperatura baja = más rojo (mejor para PPG)
            settings.push({ colorTemperature: caps.colorTemperature.min });
            console.log(`📷 Temp color: ${caps.colorTemperature.min}K (máximo rojo)`);
          }
          
          if (caps.focusDistance?.min !== undefined) {
            settings.push({ focusDistance: caps.focusDistance.min });
          }
          
          if (settings.length > 0) {
            try {
              await track.applyConstraints({ advanced: settings } as any);
            } catch {}
          }
          
          console.log('📷 Cámara iniciada');
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
