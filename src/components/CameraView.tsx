import React, { useRef, useEffect, useState } from 'react';
import { toast } from "@/components/ui/use-toast";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

const CameraView = ({ 
  onStreamReady, 
  isMonitoring, 
  isFingerDetected = false, 
  signalQuality = 0,
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [deviceSupportsTorch, setDeviceSupportsTorch] = useState(false);
  const [deviceSupportsAutoFocus, setDeviceSupportsAutoFocus] = useState(false);

  const stopCamera = async () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        if (track.kind === 'video' && track.getCapabilities()?.torch) {
          track.applyConstraints({
            advanced: [{ torch: false }]
          }).catch(err => {
            console.error("Error desactivando linterna:", err);
          });
        }
        track.stop();
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      setStream(null);
      setTorchEnabled(false);
    }
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.error("Su dispositivo no soporta acceso a la cámara");
        throw new Error("getUserMedia no está soportado");
      }

      const isAndroid = /android/i.test(navigator.userAgent);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      let baseVideoConstraints: MediaTrackConstraints = {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };

      if (isAndroid) {
        Object.assign(baseVideoConstraints, {
          frameRate: { ideal: 30, max: 30 },
          resizeMode: 'crop-and-scale'
        });
      } else if (isIOS) {
        Object.assign(baseVideoConstraints, {
          frameRate: { ideal: 30, min: 30 },
        });
      } else {
        Object.assign(baseVideoConstraints, {
          frameRate: { ideal: 30 }
        });
      }

      const constraints: MediaStreamConstraints = {
        video: baseVideoConstraints,
        audio: false
      };

      console.log("CameraView: Iniciando cámara para detección PPG");
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("CameraView: Cámara iniciada exitosamente");
      
      const videoTrack = newStream.getVideoTracks()[0];

      if (videoTrack) {
        const capabilities = videoTrack.getCapabilities();
        console.log("CameraView: Capacidades de la cámara:", capabilities);
        
        const advancedConstraints: MediaTrackConstraintSet[] = [];
        
        // Configurar exposición manual para mejor detección PPG
        if (capabilities.exposureMode) {
          advancedConstraints.push({ exposureMode: 'manual' });
          
          if (capabilities.exposureTime) {
            const maxExposure = capabilities.exposureTime.max || 1000;
            const targetExposure = maxExposure * 0.8;
            advancedConstraints.push({ exposureTime: targetExposure });
            console.log(`CameraView: Exposición ajustada a ${targetExposure}`);
          }
        }
        
        // Configurar enfoque continuo
        if (capabilities.focusMode) {
          advancedConstraints.push({ focusMode: 'continuous' });
          setDeviceSupportsAutoFocus(true);
        }
        
        // Configurar balance de blancos
        if (capabilities.whiteBalanceMode) {
          advancedConstraints.push({ whiteBalanceMode: 'continuous' });
        }

        // Aplicar constraints avanzados
        if (advancedConstraints.length > 0) {
          try {
            await videoTrack.applyConstraints({ advanced: advancedConstraints });
            console.log("CameraView: Configuración avanzada aplicada");
          } catch (err) {
            console.error("CameraView: Error en configuración avanzada:", err);
          }
        }

        // Verificar soporte de linterna
        if (capabilities.torch) {
          setDeviceSupportsTorch(true);
          console.log("CameraView: Linterna disponible");
          
          // Activar linterna para mejor detección PPG
          try {
            await handleTorch(true);
            console.log("CameraView: Linterna activada para PPG");
          } catch (err) {
            console.error("CameraView: Error activando linterna:", err);
          }
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.style.transform = 'translateZ(0)';
        videoRef.current.style.backfaceVisibility = 'hidden';
      }
      
      setStream(newStream);
      
      // Notificar que el stream está listo
      if (onStreamReady) {
        onStreamReady(newStream);
      }

    } catch (error) {
      console.error("CameraView: Error iniciando cámara:", error);
      toast({
        title: "Error de cámara",
        description: "No se pudo acceder a la cámara. Verifica los permisos.",
        variant: "destructive"
      });
    }
  };

  const handleTorch = async (enable: boolean) => {
    if (!stream) return;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack || !videoTrack.getCapabilities()?.torch) return;

    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: enable }]
      });
      setTorchEnabled(enable);
      console.log(`CameraView: Linterna ${enable ? 'activada' : 'desactivada'}`);
    } catch (error) {
      console.error("CameraView: Error controlando linterna:", error);
    }
  };

  const handleAutoFocus = async () => {
    if (!stream || !deviceSupportsAutoFocus) return;

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      await videoTrack.applyConstraints({
        advanced: [{ focusMode: 'continuous' }]
      });
      console.log("CameraView: Enfoque automático activado");
    } catch (error) {
      console.error("CameraView: Error en enfoque automático:", error);
    }
  };

  // Efectos para controlar la cámara
  useEffect(() => {
    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isMonitoring]);

  // Mantener linterna encendida durante monitoreo
  useEffect(() => {
    if (isMonitoring && deviceSupportsTorch && !torchEnabled) {
      const timer = setTimeout(() => {
        handleTorch(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isMonitoring, deviceSupportsTorch, torchEnabled]);

  return (
    <div className="relative w-full h-full bg-black">
      {/* Video de la cámara */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
        style={{
          transform: 'scaleX(-1)', // Espejo horizontal
          filter: 'brightness(1.2) contrast(1.1)' // Mejorar visibilidad
        }}
      />

      {/* Overlay de información */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Indicador de estado de dedo */}
        <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          {isFingerDetected ? "✅ Dedo Detectado" : "❌ Sin Dedo"}
        </div>

        {/* Indicador de calidad de señal */}
        <div className="absolute top-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          Calidad: {Math.round(signalQuality)}%
        </div>

        {/* Indicador de linterna */}
        {deviceSupportsTorch && (
          <div className="absolute bottom-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
            {torchEnabled ? "💡 Linterna ON" : "💡 Linterna OFF"}
          </div>
        )}

        {/* Guía visual para posicionar el dedo */}
        {isMonitoring && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-32 h-32 border-4 border-white/30 rounded-full flex items-center justify-center">
              <div className="w-24 h-24 border-2 border-white/50 rounded-full flex items-center justify-center">
                <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
                  <span className="text-white/70 text-xs text-center">
                    Coloca tu dedo aquí
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Indicador de estado de monitoreo */}
        <div className="absolute bottom-4 right-4 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          {isMonitoring ? "⏱️ Monitoreando" : "⏸️ Pausado"}
        </div>
      </div>
    </div>
  );
};

export default CameraView;
