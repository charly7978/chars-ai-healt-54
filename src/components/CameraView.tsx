import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

/**
 * Cámara trasera principal (la que tiene flash) optimizada para PPG.
 * Una sola cámara, configuración manual para máxima estabilidad.
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => {
        try { t.stop(); } catch {}
      });
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    streamRef.current = null;
    startedRef.current = false;
  };

  /**
   * Configuración óptima para PPG:
   * - Torch ON para iluminar el dedo
   * - Modos manuales para evitar ajustes automáticos
   */
  const optimizeForPPG = async (track: MediaStreamTrack) => {
    const caps: any = track.getCapabilities?.() || {};
    const constraints: any[] = [];

    // 1. TORCH - Crítico
    if (caps.torch) {
      constraints.push({ torch: true });
    }

    // 2. Modos manuales
    if (caps.exposureMode?.includes?.('manual')) {
      constraints.push({ exposureMode: 'manual' });
    }
    if (caps.focusMode?.includes?.('manual')) {
      constraints.push({ focusMode: 'manual' });
    }
    if (caps.whiteBalanceMode?.includes?.('manual')) {
      constraints.push({ whiteBalanceMode: 'manual' });
    }

    // 3. Focus cercano (dedo muy próximo)
    if (caps.focusDistance?.min !== undefined) {
      constraints.push({ focusDistance: caps.focusDistance.min });
    }

    // 4. ISO bajo para reducir ruido
    if (caps.iso?.min !== undefined) {
      constraints.push({ iso: caps.iso.min });
    }

    // Aplicar constraints
    for (const c of constraints) {
      try {
        await track.applyConstraints({ advanced: [c] } as any);
      } catch {}
    }

    console.log('📷 Cámara optimizada:', { torch: caps.torch, constraints });
  };

  const startCamera = async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      // SIEMPRE usar la cámara trasera principal con facingMode environment
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Optimizar para PPG
      const track = stream.getVideoTracks()[0];
      if (track) {
        await optimizeForPPG(track);
      }

      onStreamReady?.(stream);
      console.log('✅ Cámara trasera principal iniciada');

    } catch (e) {
      // Fallback sin "exact" si falla
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "environment",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
          }
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];
        if (track) await optimizeForPPG(track);

        onStreamReady?.(stream);
        console.log('✅ Cámara iniciada (fallback)');

      } catch (err) {
        console.error("❌ No se pudo iniciar cámara:", err);
        startedRef.current = false;
        stopStream();
      }
    }
  };

  useEffect(() => {
    if (isMonitoring) {
      startCamera();
    } else {
      stopStream();
    }
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring]);

  // Mantener torch activa
  useEffect(() => {
    if (!isMonitoring) return;
    
    const interval = setInterval(() => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        try {
          track.applyConstraints({ advanced: [{ torch: true }] } as any);
        } catch {}
      }
    }, 2000);

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
        opacity: 0.0001,
        pointerEvents: "none"
      }}
    />
  );
};

export default CameraView;
