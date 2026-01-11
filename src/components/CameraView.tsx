import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG UNIFICADA
 * 
 * FLUJO ÚNICO:
 * 1. Inicializa cámara trasera con flash
 * 2. Expone el elemento video directamente via ref
 * 3. El padre (Index.tsx) captura frames del video
 * 
 * SIN duplicación, SIN canvas interno
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
  onStreamReady,
  isMonitoring,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);

  // Exponer video al padre
  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current
  }), []);

  useEffect(() => {
    let mounted = true;
    
    const stopCamera = async () => {
      if (streamRef.current) {
        // Apagar flash primero
        for (const track of streamRef.current.getVideoTracks()) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      isStartingRef.current = false;
    };

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      
      await stopCamera();
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

      const stopStream = async (s: MediaStream | null) => {
        if (!s) return;
        for (const t of s.getTracks()) {
          try { t.stop(); } catch {}
        }
      };

      const getTorchCapableBackStream = async (): Promise<MediaStream> => {
        // 1) Intento rápido: environment "ideal" (no exact) para maximizar compatibilidad
        let stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "environment",
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 30, min: 24, max: 30 },
          }
        });

        const firstTrack = stream.getVideoTracks()[0];
        const firstCaps: any = firstTrack?.getCapabilities?.() || {};
        if (firstCaps?.torch) {
          return stream;
        }

        // 2) Si no hay torch, probamos otras cámaras (algunos móviles eligen lente sin flash)
        // Nota: labels suelen venir vacíos hasta otorgar permisos (por eso hacemos el intento 1 primero)
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videos = devices.filter(d => d.kind === 'videoinput');

        // Orden heurístico: priorizar las que parezcan traseras
        const scored = videos.map(d => {
          const label = (d.label || '').toLowerCase();
          const score = (
            (label.includes('back') ? 3 : 0) +
            (label.includes('rear') ? 3 : 0) +
            (label.includes('environment') ? 2 : 0) +
            (label.includes('wide') ? 1 : 0)
          );
          return { d, score };
        }).sort((a, b) => b.score - a.score);

        for (const item of scored) {
          try {
            const candidate = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: item.d.deviceId },
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 30, min: 24, max: 30 },
              }
            });
            const t = candidate.getVideoTracks()[0];
            const caps: any = t?.getCapabilities?.() || {};
            if (caps?.torch) {
              await stopStream(stream);
              return candidate;
            }
            await stopStream(candidate);
          } catch {
            // seguimos
          }
        }

        // 3) Si ninguna expone torch, devolvemos el stream inicial
        return stream;
      };

      try {
        const stream = await getTorchCapableBackStream();
        
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          isStartingRef.current = false;
          return;
        }

        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Esperar metadata y reproducir
          await new Promise<void>((resolve) => {
            const video = videoRef.current!;
            video.onloadedmetadata = async () => {
              try {
                await video.play();
              } catch {}
              resolve();
            };
          });
        }

        // ACTIVAR FLASH - crítico para PPG
        const track = stream.getVideoTracks()[0];
        if (track) {
          // Esperar estabilización de cámara
          await new Promise(r => setTimeout(r, 500));
          
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const caps = track.getCapabilities?.() as any;
              if (caps?.torch) {
                await track.applyConstraints({ advanced: [{ torch: true } as any] });
                console.log('🔦 Flash ACTIVADO');
                break;
              }
            } catch (e) {
              await new Promise(r => setTimeout(r, 200));
            }
          }
        }

        console.log('📹 Cámara lista:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
        onStreamReady?.(stream);
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
  }, [isMonitoring, onStreamReady]);

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
        opacity: 1,
        pointerEvents: "none",
      }}
    />
  );
});

CameraView.displayName = 'CameraView';

export default CameraView;
            
