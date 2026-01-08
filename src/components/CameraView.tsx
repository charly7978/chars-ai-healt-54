import React, { useRef, useEffect } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - IMPLEMENTACIÓN ULTRA SIMPLE
 * Sin useCallback, sin dependencias complejas
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const onStreamReadyRef = useRef(onStreamReady);
  
  // Actualizar ref sin causar re-render
  useEffect(() => {
    onStreamReadyRef.current = onStreamReady;
  }, [onStreamReady]);

  useEffect(() => {
    mountedRef.current = true;
    
    const stopCamera = async () => {
      console.log('🛑 Deteniendo cámara...');
      
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        
        for (const track of tracks) {
          if (track.kind === 'video') {
            try {
              await (track as any).applyConstraints({ 
                advanced: [{ torch: false }] 
              });
            } catch {}
          }
          track.stop();
        }
        
        streamRef.current = null;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const startCamera = async () => {
      console.log('📷 Intentando iniciar cámara...');
      
      // Limpiar cualquier stream anterior
      await stopCamera();
      
      if (!mountedRef.current) return;

      try {
        // Constraints simples para máxima compatibilidad
        let stream: MediaStream | null = null;
        
        // Intento 1: Cámara trasera específica
        try {
          console.log('📷 Intentando cámara trasera...');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { exact: "environment" },
              width: { ideal: 640 },
              height: { ideal: 480 }
            }
          });
          console.log('✅ Cámara trasera obtenida');
        } catch (e) {
          console.log('⚠️ Cámara trasera falló, probando cualquier cámara...');
        }
        
        // Intento 2: Cualquier cámara
        if (!stream) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            });
            console.log('✅ Cámara alternativa obtenida');
          } catch (e) {
            console.log('⚠️ Cámara alternativa falló, probando mínimo...');
          }
        }
        
        // Intento 3: Mínimo absoluto
        if (!stream) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true
          });
          console.log('✅ Cámara mínima obtenida');
        }
        
        if (!mountedRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;
        
        // Conectar al video
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Esperar a que esté listo
          await new Promise<void>((resolve) => {
            if (!videoRef.current) { resolve(); return; }
            
            if (videoRef.current.readyState >= 2) {
              resolve();
            } else {
              videoRef.current.onloadeddata = () => resolve();
              setTimeout(resolve, 2000); // Timeout de seguridad
            }
          });
          
          try {
            await videoRef.current.play();
            console.log('▶️ Video reproduciendo');
          } catch (e) {
            console.log('⚠️ Error play():', e);
          }
        }

        // Configurar flash
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          const caps = videoTrack.getCapabilities?.() as any || {};
          const settings = videoTrack.getSettings();
          
          console.log('📷 Cámara iniciada:', {
            label: videoTrack.label,
            width: settings.width,
            height: settings.height,
            hasTorch: caps.torch || false
          });
          
          // Encender flash
          if (caps.torch) {
            try {
              await videoTrack.applyConstraints({
                advanced: [{ torch: true }]
              } as any);
              console.log('🔦 Flash ENCENDIDO');
            } catch (e) {
              console.log('⚠️ No se pudo encender flash:', e);
            }
          }
        }

        // Notificar que está listo
        onStreamReadyRef.current?.(stream);

      } catch (err) {
        console.error('❌ Error cámara:', err);
      }
    };

    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      mountedRef.current = false;
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
        top: 0,
        left: 0,
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
