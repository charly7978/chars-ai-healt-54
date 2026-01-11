import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - SOLO MANEJA LA CÁMARA Y EL FLASH
 * El procesamiento de frames se hace en Index.tsx via useSignalProcessor
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const onStreamReadyRef = useRef(onStreamReady);
  const flashRetryRef = useRef<number>(0);
  
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
      flashRetryRef.current = 0;
    };

    const enableFlash = async (track: MediaStreamTrack) => {
      // Intentar activar flash múltiples veces
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const caps: any = track.getCapabilities?.() || {};
          if (caps.torch) {
            await track.applyConstraints({ advanced: [{ torch: true }] } as any);
            console.log('🔦 Flash ACTIVADO en intento', attempt + 1);
            return true;
          }
        } catch (e) {
          console.warn(`Flash intento ${attempt + 1} falló:`, e);
          await new Promise(r => setTimeout(r, 200));
        }
      }
      console.warn('⚠️ No se pudo activar el flash después de 3 intentos');
      return false;
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
        // Configuración OPTIMIZADA para PPG con flash
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: "environment" }, // FORZAR cámara trasera
            width: { ideal: 640, min: 320 },
            height: { ideal: 480, min: 240 },
            frameRate: { ideal: 30, min: 24 }
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
          
          // Esperar a que el video esté listo antes de continuar
          await new Promise<void>((resolve) => {
            if (videoRef.current) {
              videoRef.current.onloadedmetadata = () => {
                videoRef.current?.play().then(resolve).catch(resolve);
              };
            } else {
              resolve();
            }
          });
        }

        // ACTIVAR FLASH - crítico para PPG
        const track = stream.getVideoTracks()[0];
        if (track) {
          // Esperar un poco para que la cámara se estabilice
          await new Promise(r => setTimeout(r, 300));
          await enableFlash(track);
        }

        console.log('📹 Cámara lista:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
        onStreamReadyRef.current?.(stream);
        isStartingRef.current = false;

      } catch (err) {
        console.error('❌ Error cámara:', err);
        
        // Fallback: intentar sin "exact" en facingMode
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: "environment",
              width: { ideal: 640 },
              height: { ideal: 480 }
            }
          });
          
          if (!mounted) {
            fallbackStream.getTracks().forEach(t => t.stop());
            isStartingRef.current = false;
            return;
          }
          
          streamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play().catch(() => {});
          }
          
          const track = fallbackStream.getVideoTracks()[0];
          if (track) {
            await new Promise(r => setTimeout(r, 300));
            await enableFlash(track);
          }
          
          onStreamReadyRef.current?.(fallbackStream);
        } catch (fallbackErr) {
          console.error('❌ Error cámara fallback:', fallbackErr);
        }
        
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
        transform: "none",
        WebkitTransform: "none",
        opacity: 1,
        pointerEvents: "none",
      }}
    />
  );
};

export default CameraView;
