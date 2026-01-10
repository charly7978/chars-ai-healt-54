import React, { useRef, useEffect } from "react";
import { globalCameraController } from "@/modules/camera/CameraController";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  // Callback vital: Envía el valor numérico del brillo rojo al procesador
  onFrameData?: (averageRed: number) => void; 
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG - MODO PROCESAMIENTO
 * * - Captura video RAW
 * - Procesa frames en un canvas oculto
 * - Extrae el promedio del canal ROJO
 * - Invierte la señal para detectar valles como picos
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
      
      // Verificamos que el video tenga datos reales
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx) {
          // 1. Dibujar frame actual en canvas pequeño (50x50 es rápido y suficiente)
          ctx.drawImage(video, 0, 0, 50, 50);
          
          // 2. Obtener datos de píxeles crudos
          const frame = ctx.getImageData(0, 0, 50, 50);
          const data = frame.data;
          let sumRed = 0;
          let count = 0;

          // 3. Recorrer píxeles (Stride = 4 bytes: R, G, B, A)
          // Optimizamos saltando de 4 en 4 para leer solo píxeles alternos si fuera necesario,
          // pero 50x50 es pequeño, así que leemos todo.
          for (let i = 0; i < data.length; i += 4) {
            sumRed += data[i]; // Canal Rojo
            count++;
          }

          // 4. Calcular promedio
          const averageRed = sumRed / count;

          // 5. IMPORTANTE: Invertimos el valor (-averageRed).
          // Cuando el corazón bombea, hay más sangre -> la imagen es MÁS OSCURA (menor valor rojo).
          // Al invertirlo, convertimos ese oscurecimiento en un PICO positivo para el algoritmo.
          // Solo enviamos si hay suficiente luz (>10) para evitar ruido en oscuridad total.
          if (averageRed > 5) { 
             onFrameData(-averageRed); 
          }
        }
      }
    }
    
    // Bucle continuo mientras se esté monitoreando
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
          // Apagar flash antes de detener
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
        // Configuración óptima para PPG: FrameRate alto si es posible, resolución baja
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 192 }, // Resolución baja para procesar rápido
            height: { ideal: 144 },
            frameRate: { ideal: 60, min: 30 } // Intentar 60fps para mejor precisión temporal
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
          // Esperar a que reproduzca para iniciar procesamiento
          await videoRef.current.play().catch(() => {});
        }

        // Encender Flash (Torch)
        const track = stream.getVideoTracks()[0];
        if (track) {
          await globalCameraController.setTrack(track);
          // Intentar forzar torch
          try {
             await track.applyConstraints({ advanced: [{ torch: true }] } as any);
          } catch (e) {
             console.warn("No se pudo activar el flash nativamente", e);
          }
        }

        onStreamReadyRef.current?.(stream);
        isStartingRef.current = false;

        // INICIAR BUCLE DE PROCESAMIENTO
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
      {/* Canvas Oculto para procesamiento de píxeles */}
      <canvas 
        ref={canvasRef} 
        width={50} 
        height={50} 
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
          // Opacidad 1 para ver el video (útil para debug visual del usuario)
          // Puedes cambiarlo a 0.01 si prefieres que no se vea
          opacity: 1, 
          pointerEvents: "none",
          transform: "none",
        }}
      />
    </>
  );
};

export default CameraView;
      
