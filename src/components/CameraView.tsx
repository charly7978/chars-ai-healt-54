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
      // ===== MODO SIN FLASH - ILUMINACIÓN ADAPTATIVA =====
      console.log('💡 Sin flash - usando iluminación adaptativa');
      
      // Exposición automática continua para adaptarse a la luz
      if (caps.exposureMode?.includes?.('continuous')) {
        await tryConstraint({ exposureMode: 'continuous' });
      }
      
      // Compensación de exposición alta para captar más luz
      if (caps.exposureCompensation?.max !== undefined) {
        await tryConstraint({ exposureCompensation: caps.exposureCompensation.max * 0.8 });
      }
      
      // ISO alto para más sensibilidad sin flash
      if (caps.iso?.max !== undefined) {
        const midIso = (caps.iso.min + caps.iso.max) / 2;
        await tryConstraint({ iso: midIso });
      }
      
      // Balance de blancos automático
      if (caps.whiteBalanceMode?.includes?.('continuous')) {
        await tryConstraint({ whiteBalanceMode: 'continuous' });
      }
      
      // Focus cercano sigue siendo importante
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
   * Encuentra y prueba cámaras para identificar cuál tiene flash
   */
  const findCameraWithFlash = async (): Promise<{
    mainCamera: MediaDeviceInfo | null;
    auxCamera: MediaDeviceInfo | null;
    allCameras: MediaDeviceInfo[];
  }> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d => d.kind === "videoinput");
    
    // Filtrar solo cámaras traseras
    const backCameras = videos.filter(d => {
      const label = (d.label || '').toLowerCase();
      const isBack = label.includes('back') || label.includes('rear') || label.includes('environment');
      const isFront = label.includes('front') || label.includes('selfie') || label.includes('user');
      return isBack || (!isFront && videos.length <= 2); // Si solo hay 2, asumir que una es trasera
    });

    console.log('📷 Cámaras traseras detectadas:', backCameras.map(c => c.label));

    // Probar cada cámara para ver cuál tiene flash
    let cameraWithFlash: MediaDeviceInfo | null = null;
    let cameraWithoutFlash: MediaDeviceInfo | null = null;

    for (const camera of backCameras) {
      try {
        const testStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: camera.deviceId } }
        });
        
        const track = testStream.getVideoTracks()[0];
        const hasFlash = checkFlash(track);
        
        console.log(`📷 Probando ${camera.label}: flash=${hasFlash}`);
        
        // Detener el stream de prueba
        track.stop();
        
        if (hasFlash && !cameraWithFlash) {
          cameraWithFlash = camera;
        } else if (!hasFlash && !cameraWithoutFlash) {
          cameraWithoutFlash = camera;
        }
        
        // Si ya encontramos ambas, salir
        if (cameraWithFlash && cameraWithoutFlash) break;
        
      } catch (e) {
        console.log(`⚠️ No se pudo probar ${camera.label}`);
      }
    }

    return {
      mainCamera: cameraWithFlash || backCameras[0] || null,
      auxCamera: cameraWithFlash ? cameraWithoutFlash : null,
      allCameras: backCameras
    };
  };

  const startCameras = async () => {
    if (startedRef.current) return;
    startedRef.current = true;

    try {
      // Buscar cámara con flash primero
      const { mainCamera, auxCamera, allCameras } = await findCameraWithFlash();
      
      if (!mainCamera && allCameras.length === 0) {
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

      // ===== CÁMARA PRINCIPAL (con flash si está disponible) =====
      if (mainCamera) {
        try {
          const mainStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: { exact: mainCamera.deviceId },
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
          
          onStreamReady?.(mainStream);
          console.log('✅ Cámara PRINCIPAL iniciada:', mainCamera.label, hasFlashRef.current ? '(con flash)' : '(sin flash)');
          
        } catch (e) {
          console.error('❌ Error con cámara principal:', e);
        }
      }

      // ===== CÁMARA AUXILIAR (si hay dos traseras) =====
      if (auxCamera && onAuxStreamReady) {
        try {
          const auxStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: { exact: auxCamera.deviceId },
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
          if (track) await optimizeForPPG(track, true); // Sin flash para la auxiliar
          
          onAuxStreamReady(auxStream);
          console.log('✅ Cámara AUXILIAR iniciada:', auxCamera.label);
          
        } catch (e) {
          console.log('ℹ️ Cámara auxiliar no disponible:', e);
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
