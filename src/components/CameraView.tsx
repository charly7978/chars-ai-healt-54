import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onAuxStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

/**
 * SISTEMA DE CÁMARA INTELIGENTE PARA PPG
 * 
 * PRIORIDAD:
 * 1. Buscar cámara con FLASH (torch) - esa es la principal
 * 2. Si hay dos cámaras traseras, usar ambas
 * 3. Si no hay flash, usar iluminación adaptativa (exposición alta)
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
  const hasFlashRef = useRef(false);

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
    hasFlashRef.current = false;
  };

  /**
   * Verifica si un track tiene flash disponible
   */
  const checkFlash = (track: MediaStreamTrack): boolean => {
    const caps: any = track.getCapabilities?.() || {};
    return caps.torch === true;
  };

  /**
   * Configura la cámara para PPG con flash O iluminación adaptativa
   */
  const optimizeForPPG = async (track: MediaStreamTrack, forceNoFlash = false) => {
    const caps: any = track.getCapabilities?.() || {};
    
    const tryConstraint = async (c: any) => {
      try {
        await track.applyConstraints({ advanced: [c] } as any);
        return true;
      } catch { return false; }
    };

    const hasFlash = caps.torch === true && !forceNoFlash;
    hasFlashRef.current = hasFlash;

    if (hasFlash) {
      // ===== MODO CON FLASH =====
      console.log('🔦 Flash disponible - usando modo con torch');
      
      await tryConstraint({ torch: true });
      
      // Modos manuales para estabilidad
      if (caps.exposureMode?.includes?.('manual')) await tryConstraint({ exposureMode: 'manual' });
      if (caps.focusMode?.includes?.('manual')) await tryConstraint({ focusMode: 'manual' });
      if (caps.whiteBalanceMode?.includes?.('manual')) await tryConstraint({ whiteBalanceMode: 'manual' });
      
      // Focus cercano
      if (caps.focusDistance?.min !== undefined) await tryConstraint({ focusDistance: caps.focusDistance.min });
      
      // ISO bajo con flash
      if (caps.iso?.min !== undefined) await tryConstraint({ iso: caps.iso.min });
      
    } else {
      // ===== MODO SIN FLASH - ILUMINACIÓN ADAPTATIVA MEJORADA =====
      console.log('💡 Sin flash - usando iluminación adaptativa MEJORADA');
      
      // Exposición automática continua
      if (caps.exposureMode?.includes?.('continuous')) {
        await tryConstraint({ exposureMode: 'continuous' });
      }
      
      // Compensación de exposición al MÁXIMO para más luz
      if (caps.exposureCompensation?.max !== undefined) {
        await tryConstraint({ exposureCompensation: caps.exposureCompensation.max });
      }
      
      // Tiempo de exposición largo para más luz (si está disponible)
      if (caps.exposureTime?.max !== undefined) {
        // Usar 80% del máximo para evitar blur excesivo
        const longExposure = Math.min(caps.exposureTime.max * 0.8, 100000); // máx 100ms
        await tryConstraint({ exposureTime: longExposure });
      }
      
      // ISO ALTO para máxima sensibilidad (75% del máximo)
      if (caps.iso?.max !== undefined) {
        const highIso = caps.iso.min + (caps.iso.max - caps.iso.min) * 0.75;
        await tryConstraint({ iso: highIso });
      }
      
      // Brillo al máximo si está disponible
      if (caps.brightness?.max !== undefined) {
        await tryConstraint({ brightness: caps.brightness.max });
      }
      
      // Balance de blancos automático
      if (caps.whiteBalanceMode?.includes?.('continuous')) {
        await tryConstraint({ whiteBalanceMode: 'continuous' });
      }
      
      // Focus cercano
      if (caps.focusDistance?.min !== undefined) {
        await tryConstraint({ focusDistance: caps.focusDistance.min });
      }
    }

    console.log('📷 Cámara configurada:', { 
      label: track.label, 
      flash: hasFlash,
      caps: { torch: caps.torch, exposureMode: caps.exposureMode }
    });
  };

  /**
   * Encuentra cámaras - PRIORIDAD: cámara principal (índice 0 / "camera 0")
   * La cámara principal es la que tiene mejor sensor, aunque no tenga flash
   */
  const findCameras = async (): Promise<{
    primaryCamera: MediaDeviceInfo | null;
    secondaryCamera: MediaDeviceInfo | null;
    primaryHasFlash: boolean;
  }> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d => d.kind === "videoinput");
    
    // Filtrar cámaras traseras
    const backCameras = videos.filter(d => {
      const label = (d.label || '').toLowerCase();
      const isBack = label.includes('back') || label.includes('rear') || 
                     label.includes('environment') || label.includes('camera 0') ||
                     label.includes('trasera');
      const isFront = label.includes('front') || label.includes('selfie') || 
                      label.includes('user') || label.includes('frontal');
      return isBack || (!isFront && videos.length <= 2);
    });

    console.log('📷 Cámaras traseras detectadas:', backCameras.map(c => c.label));

    if (backCameras.length === 0) {
      return { primaryCamera: null, secondaryCamera: null, primaryHasFlash: false };
    }

    // Ordenar: priorizar "camera 0" o la primera detectada (suele ser la principal)
    const sortedCameras = [...backCameras].sort((a, b) => {
      const aLabel = (a.label || '').toLowerCase();
      const bLabel = (b.label || '').toLowerCase();
      
      // "camera 0" siempre primero
      if (aLabel.includes('camera 0') && !bLabel.includes('camera 0')) return -1;
      if (bLabel.includes('camera 0') && !aLabel.includes('camera 0')) return 1;
      
      // Luego por índice en el label (camera 0 < camera 1 < camera 2)
      const aMatch = aLabel.match(/camera\s*(\d+)/);
      const bMatch = bLabel.match(/camera\s*(\d+)/);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1]) - parseInt(bMatch[1]);
      }
      
      return 0;
    });

    console.log('📷 Cámaras ordenadas por prioridad:', sortedCameras.map(c => c.label));

    // La primera es SIEMPRE la principal
    const primaryCamera = sortedCameras[0];
    const secondaryCamera = sortedCameras.length > 1 ? sortedCameras[1] : null;

    // Probar si la principal tiene flash
    let primaryHasFlash = false;
    try {
      const testStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: primaryCamera.deviceId } }
      });
      const track = testStream.getVideoTracks()[0];
      primaryHasFlash = checkFlash(track);
      track.stop();
      console.log(`📷 Cámara principal ${primaryCamera.label}: flash=${primaryHasFlash}`);
    } catch (e) {
      console.log('⚠️ No se pudo probar flash de cámara principal');
    }

    return { primaryCamera, secondaryCamera, primaryHasFlash };
  };

  const startCameras = async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      // Buscar cámaras - PRIORIDAD: principal (camera 0)
      const { primaryCamera, secondaryCamera, primaryHasFlash } = await findCameras();
      
      if (!primaryCamera) {
        // Fallback: usar facingMode environment
        console.log('⚠️ No se detectaron cámaras, usando fallback');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "environment" }
        });
        
        s1Ref.current = stream;
        if (v1Ref.current) {
          v1Ref.current.srcObject = stream;
          await v1Ref.current.play().catch(() => {});
        }
        
        const track = stream.getVideoTracks()[0];
        if (track) await optimizeForPPG(track);
        onStreamReady?.(stream);
        return;
      }

      // ===== CÁMARA PRINCIPAL (siempre camera 0) =====
      try {
        const mainStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: primaryCamera.deviceId },
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 },
            frameRate: { ideal: 15, max: 30 }
          }
        });
        
        s1Ref.current = mainStream;
        if (v1Ref.current) {
          v1Ref.current.srcObject = mainStream;
          await v1Ref.current.play().catch(() => {});
        }
        
        const track = mainStream.getVideoTracks()[0];
        if (track) await optimizeForPPG(track);
        
        hasFlashRef.current = primaryHasFlash;
        onStreamReady?.(mainStream);
        console.log('✅ Cámara PRINCIPAL iniciada:', primaryCamera.label, primaryHasFlash ? '(con flash)' : '(iluminación adaptativa)');
        
      } catch (e) {
        console.error('❌ Error con cámara principal:', e);
      }

      // ===== CÁMARA SECUNDARIA (si hay dos traseras) =====
      if (secondaryCamera && onAuxStreamReady) {
        try {
          const auxStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: { exact: secondaryCamera.deviceId },
              width: { ideal: 320, max: 640 },
              height: { ideal: 240, max: 480 },
              frameRate: { ideal: 15, max: 30 }
            }
          });
          
          s2Ref.current = auxStream;
          if (v2Ref.current) {
            v2Ref.current.srcObject = auxStream;
            await v2Ref.current.play().catch(() => {});
          }
          
          const track = auxStream.getVideoTracks()[0];
          if (track) await optimizeForPPG(track, true); // Sin flash para la secundaria
          
          onAuxStreamReady(auxStream);
          console.log('✅ Cámara SECUNDARIA iniciada:', secondaryCamera.label);
          
        } catch (e) {
          console.log('ℹ️ Cámara secundaria no disponible:', e);
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

  // Mantener configuración activa (torch + exposición)
  useEffect(() => {
    if (!isMonitoring) return;
    
    const interval = setInterval(() => {
      [s1Ref.current, s2Ref.current].forEach((stream, idx) => {
        const track = stream?.getVideoTracks()[0];
        if (track) {
          try {
            const caps: any = track.getCapabilities?.() || {};
            if (caps.torch && idx === 0) {
              // Mantener torch solo en cámara principal
              track.applyConstraints({ advanced: [{ torch: true }] } as any);
            }
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
