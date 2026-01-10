import React, { useRef, useEffect } from "react";
import { globalCameraController } from "@/modules/camera/CameraController";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  // Callback vital: Envía el valor numérico del brillo rojo al procesador
  onFrameData?: (averageRed: number) => void; 
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - VERSIÓN FINAL OPTIMIZADA
 * 1. Lee solo el centro de la imagen (ROI 40x40px).
 * 2. Invierte la señal (Sangre = Oscuridad = Pico).
 * 3. Usa requestAnimationFrame para sincronía perfecta.
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onFrameData,
  isMonitoring,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<number>();
  const isStartingRef = useRef(false);
  const onStreamReadyRef = useRef(onStreamReady);
  
  // Actualizar refs para evitar dependencias en useEffect
  useEffect(() => {
    onStreamReadyRef.current = onStreamReady;
  }, [onStreamReady]);

  // ========== LÓGICA DE PROCESAMIENTO DE IMAGEN ==========
  const processFrame = () => {
    if (videoRef.current && canvasRef.current && onFrameData) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Solo procesamos si hay video real corriendo
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx) {
          // 1. OPTIMIZACIÓN: Leer solo el CENTRO de la imagen
          // El flash ilumina mejor el centro. Los bordes tienen ruido.
          // Calculamos el centro exacto del video.
          const roiSize = 40; // Región de interés de 40x40 píxeles
          const centerX = (video.videoWidth - roiSize) / 2;
          const centerY = (video.videoHeight - roiSize) / 2;
          
          // Dibujamos solo ese pedacito en nuestro canvas de 40x40
          ctx.drawImage(video, centerX, centerY, roiSize, roiSize, 0, 0, roiSize, roiSize);
          
          // 2. Obtener datos de píxeles
          const frame = ctx.getImageData(0, 0, roiSize, roiSize);
          const data = frame.data;
          let sumRed = 0;
          let count = 0;

          // 3. Promediar canal ROJO
          for (let i = 0; i < data.length; i += 4) {
            sumRed += data[i];
            count++;
          }

          const averageRed = sumRed / count;

          // 4. INVERTIR SEÑAL Y ENVIAR
          // Importante: Si hay muy poca luz (averageRed < 1), no enviamos nada para no meter ruido.
          if (averageRed > 1) { 
             // Enviamos negativo porque el latido oscurece la imagen
             onFrameData(-averageRed); 
          }
        }
      }
    }
    
    // Bucle continuo
    if (isMonitoring) {
      requestRef.current = requestAnimationFrame(processFrame);
    }
  };

  // ========== GESTIÓN DE CÁMARA ==========
  useEffect(() => {
    let mounted = true;
    
    const stopCamera = async () => {
      // Detener loop de procesamiento
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = undefined;
      }

      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        for (const track of tracks) {
          if (track.kind === 'video') {
            try {
              // Intentar apagar flash
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
        // Configuración óptima para PPG
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 192 }, // Baja resolución = más rápido
            height: { ideal: 144 },
            frameRate: { ideal: 60, min: 30 } // Prioridad a los FPS
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

        // Encender Flash (Torch)
        const track = stream.getVideoTracks()[0];
        if (track) {
          await globalCameraController.setTrack(track);
          try {
             await track.applyConstraints({ advanced: [{ torch: true }] } as any);
          } catch (e) {
             console.warn("No se pudo activar el flash nativamente", e);
          }
        }

        onStreamReadyRef.current?.(stream);
        isStartingRef.current = false;

        // INICIAR BUCLE
        requestRef.current = requestAnimationFrame(processFrame);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring]);

  return (
    <>
      {/* Canvas oculto pequeño para procesar el ROI */}
      <canvas 
        ref={canvasRef} 
        width={40} 
        height={40} 
        style={{ display: 'none' }} 
      />

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
          opacity: 1, // Visible para que el usuario pueda apuntar
          pointerEvents: "none",
        }}
      />
    </>
  );
};

export default CameraView;
