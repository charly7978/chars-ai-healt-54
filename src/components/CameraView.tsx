import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onAuxStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

/**
 * Cámara trasera principal + secundaria opcional para mejor PPG.
 * Prioriza SIEMPRE la cámara trasera principal con flash.
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onAuxStreamReady,
  isMonitoring,
}) => {
  const v1Ref = useRef<HTMLVideoElement | null>(null);
  const v2Ref = useRef<HTMLVideoElement | null>(null);
  const s1Ref = useRef<MediaStream | null>(null);
  const s2Ref = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);

  const stopStream = (stream: MediaStream | null) => {
    if (stream) {
      stream.getTracks().forEach(t => {
        try { t.stop(); } catch {}
      });
    }
  };

  const stopAll = () => {
    stopStream(s1Ref.current);
    stopStream(s2Ref.current);
    if (v1Ref.current) v1Ref.current.srcObject = null;
    if (v2Ref.current) v2Ref.current.srcObject = null;
    s1Ref.current = null;
    s2Ref.current = null;
    startedRef.current = false;
  };

  /**
   * Configuración óptima para PPG:
   * - Torch ON
   * - Modos manuales
   * - Focus cercano
   */
  const optimizeForPPG = async (track: MediaStreamTrack) => {
    const caps: any = track.getCapabilities?.() || {};
    
    // Aplicar cada constraint individualmente para máxima compatibilidad
    const tryConstraint = async (c: any) => {
      try {
        await track.applyConstraints({ advanced: [c] } as any);
        return true;
      } catch { return false; }
    };

    // 1. TORCH - Lo más importante
    if (caps.torch) await tryConstraint({ torch: true });
    
    // 2. Modos manuales
    if (caps.exposureMode?.includes?.('manual')) await tryConstraint({ exposureMode: 'manual' });
    if (caps.focusMode?.includes?.('manual')) await tryConstraint({ focusMode: 'manual' });
    if (caps.whiteBalanceMode?.includes?.('manual')) await tryConstraint({ whiteBalanceMode: 'manual' });
    
    // 3. Focus cercano
    if (caps.focusDistance?.min !== undefined) await tryConstraint({ focusDistance: caps.focusDistance.min });
    
    // 4. ISO bajo
    if (caps.iso?.min !== undefined) await tryConstraint({ iso: caps.iso.min });

    console.log('📷 Optimizado:', { torch: caps.torch, label: track.label });
  };

  /**
   * Encuentra cámaras traseras ordenadas por prioridad
   */
  const findBackCameras = async (): Promise<MediaDeviceInfo[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d => d.kind === "videoinput");
    
    // Priorizar por etiquetas comunes de cámara trasera
    const scored = videos.map(d => {
      const label = (d.label || '').toLowerCase();
      let score = 0;
      
      // Cámara principal trasera (máxima prioridad)
      if (label.includes('back') && label.includes('0')) score += 100;
      else if (label.includes('rear') && label.includes('0')) score += 100;
      else if (label.includes('back camera 0')) score += 100;
      else if (label.includes('main')) score += 90;
      else if (label.includes('wide')) score += 80;
      else if (label.includes('back')) score += 70;
      else if (label.includes('rear')) score += 70;
      else if (label.includes('environment')) score += 60;
      
      // Penalizar cámaras secundarias
      if (label.includes('ultra') || label.includes('tele') || label.includes('macro')) score -= 30;
      if (label.includes('front') || label.includes('selfie')) score -= 100;
      if (/\b[2-9]\b/.test(label)) score -= 20; // camera 2, 3, etc.
      
      return { device: d, score };
    });
    
    // Ordenar por score descendente
    scored.sort((a, b) => b.score - a.score);
    
    console.log('📷 Cámaras encontradas:', scored.map(s => ({ label: s.device.label, score: s.score })));
    
    return scored.map(s => s.device);
  };

  const startCameras = async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      const cameras = await findBackCameras();
      
      // SIEMPRE intentar primero con la cámara principal trasera
      // Usar facingMode: environment como constraint principal
      try {
        const mainStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: "environment" },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
          }
        });
        
        s1Ref.current = mainStream;
        if (v1Ref.current) {
          v1Ref.current.srcObject = mainStream;
          await v1Ref.current.play().catch(() => {});
        }
        
        const track = mainStream.getVideoTracks()[0];
        if (track) await optimizeForPPG(track);
        
        onStreamReady?.(mainStream);
        console.log('✅ Cámara principal iniciada:', track?.label);
        
      } catch (e) {
        // Fallback: intentar con deviceId específico de la primera cámara trasera
        if (cameras.length > 0) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: { exact: cameras[0].deviceId },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 }
            }
          });
          
          s1Ref.current = stream;
          if (v1Ref.current) {
            v1Ref.current.srcObject = stream;
            await v1Ref.current.play().catch(() => {});
          }
          
          const track = stream.getVideoTracks()[0];
          if (track) await optimizeForPPG(track);
          
          onStreamReady?.(stream);
          console.log('✅ Cámara iniciada (fallback deviceId):', track?.label);
        }
      }

      // Intentar cámara auxiliar si hay más de una trasera
      if (cameras.length >= 2 && onAuxStreamReady) {
        try {
          const auxStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: { exact: cameras[1].deviceId },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 }
            }
          });
          
          s2Ref.current = auxStream;
          if (v2Ref.current) {
            v2Ref.current.srcObject = auxStream;
            await v2Ref.current.play().catch(() => {});
          }
          
          const track = auxStream.getVideoTracks()[0];
          if (track) await optimizeForPPG(track);
          
          onAuxStreamReady(auxStream);
          console.log('✅ Cámara auxiliar iniciada:', track?.label);
          
        } catch (e) {
          console.log('ℹ️ Cámara auxiliar no disponible');
        }
      }
      
    } catch (err) {
      console.error("❌ Error iniciando cámaras:", err);
      startedRef.current = false;
      stopAll();
    }
  };

  useEffect(() => {
    if (isMonitoring) {
      startCameras();
    } else {
      stopAll();
    }
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring]);

  // Mantener torch activa
  useEffect(() => {
    if (!isMonitoring) return;
    
    const interval = setInterval(() => {
      [s1Ref.current, s2Ref.current].forEach(stream => {
        const track = stream?.getVideoTracks()[0];
        if (track) {
          try {
            track.applyConstraints({ advanced: [{ torch: true }] } as any);
          } catch {}
        }
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [isMonitoring]);

  return (
    <>
      <video
        ref={v1Ref}
        data-cam="primary"
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
      <video
        ref={v2Ref}
        data-cam="aux"
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
    </>
  );
};

export default CameraView;
