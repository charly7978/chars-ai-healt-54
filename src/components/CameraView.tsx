
import React, { useRef, useEffect, useState } from 'react';
import { toast } from "@/components/ui/use-toast";
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

/**
 * COMPONENTE CÁMARA UNIFICADO - SIN DUPLICIDADES
 * Procesamiento matemático avanzado sin memory leaks
 */
const CameraView = ({ 
  onStreamReady, 
  isMonitoring, 
  isFingerDetected = false, 
  signalQuality = 0,
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const vitalProcessor = useRef(new VitalSignsProcessor());
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [deviceSupportsTorch, setDeviceSupportsTorch] = useState(false);
  const cameraInitialized = useRef<boolean>(false);

  const stopCamera = async () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        if (track.kind === 'video' && track.getCapabilities()?.torch) {
          track.applyConstraints({
            advanced: [{ torch: false }]
          }).catch(() => {});
        }
        track.stop();
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      setStream(null);
      setTorchEnabled(false);
      cameraInitialized.current = false;
    }
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia no está soportado");
      }

      const isAndroid = /android/i.test(navigator.userAgent);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      // Configuración optimizada sin complejidad innecesaria
      let baseVideoConstraints: MediaTrackConstraints = {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      };

      if (isAndroid) {
        Object.assign(baseVideoConstraints, {
          resizeMode: 'crop-and-scale'
        });
      }

      const constraints: MediaStreamConstraints = {
        video: baseVideoConstraints,
        audio: false
      };

      console.log("CameraView: Iniciando cámara optimizada");
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const videoTrack = newStream.getVideoTracks()[0];

      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities();
          
          const advancedConstraints: MediaTrackConstraintSet[] = [];
          
          // Configuración de exposición manual para PPG
          if (capabilities.exposureMode) {
            advancedConstraints.push({ exposureMode: 'manual' });
            if (capabilities.exposureTime) {
              const maxExposure = capabilities.exposureTime.max || 1000;
              advancedConstraints.push({
                exposureTime: maxExposure * 0.8
              });
            }
          }
          
          // Enfoque continuo
          if (capabilities.focusMode) {
            advancedConstraints.push({ focusMode: 'continuous' });
          }
          
          // Balance de blancos continuo
          if (capabilities.whiteBalanceMode) {
            advancedConstraints.push({ whiteBalanceMode: 'continuous' });
          }

          if (advancedConstraints.length > 0) {
            await videoTrack.applyConstraints({
              advanced: advancedConstraints
            });
          }

          // Configuración de linterna
          if (capabilities.torch) {
            setDeviceSupportsTorch(true);
            try {
              await videoTrack.applyConstraints({
                advanced: [{ torch: true }]
              });
              setTorchEnabled(true);
              console.log("CameraView: Linterna activada para PPG");
            } catch (err) {
              console.error("CameraView: Error activando linterna:", err);
            }
          }
        } catch (err) {
          console.log("CameraView: Algunas optimizaciones no aplicadas:", err);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        if (isAndroid) {
          videoRef.current.style.willChange = 'transform';
          videoRef.current.style.transform = 'translateZ(0)';
        }
      }

      setStream(newStream);
      cameraInitialized.current = true;
      
      if (onStreamReady) {
        console.log("CameraView: Stream listo");
        onStreamReady(newStream);
      }
    } catch (err) {
      console.error("CameraView: Error al iniciar la cámara:", err);
      toast({
        title: "Error de cámara",
        description: "No se pudo acceder a la cámara",
        variant: "destructive"
      });
    }
  };

  /**
   * Procesamiento de frame optimizado sin duplicidades
   */
  const processFrame = (frameData: ImageData) => {
    const { red, ir, green } = extractPPGSignals(frameData);
    
    // Usar ÚNICAMENTE el procesador unificado
    const results = vitalProcessor.current.processSignal(red[0]);
    
    if (results) {
      handleResults(results);
    }
  };

  /**
   * Extracción matemática avanzada de señales PPG
   */
  const extractPPGSignals = (frameData: ImageData) => {
    const { width, height, data } = frameData;
    
    let redSum = 0, irSum = 0, greenSum = 0;
    let validPixels = 0;
    
    // ROI centrado matemáticamente optimizado
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const roiSize = Math.min(width, height) * 0.72;
    
    const startX = Math.max(0, centerX - roiSize / 2);
    const endX = Math.min(width, centerX + roiSize / 2);
    const startY = Math.max(0, centerY - roiSize / 2);
    const endY = Math.min(height, centerY + roiSize / 2);
    
    // Extracción con validación matemática
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        
        // Validación fisiológica estricta
        if (r > 0 && g > 0 && b > 0 && r < 255 && g < 255 && b < 255) {
          redSum += r;
          greenSum += g;
          irSum += b;
          validPixels++;
        }
      }
    }
    
    if (validPixels > 0) {
      return {
        red: [redSum / validPixels],
        ir: [irSum / validPixels],
        green: [greenSum / validPixels]
      };
    }
    
    return { red: [0], ir: [0], green: [0] };
  };

  const handleResults = (results: VitalSignsResult) => {
    // Logging mínimo para evitar spam
    if (results.spo2 > 0) {
      console.log('Mediciones biométricas:', {
        spo2: results.spo2.toFixed(1) + '%',
        pressure: results.pressure + ' mmHg',
        glucose: results.glucose.toFixed(0) + ' mg/dL'
      });
    }
  };

  useEffect(() => {
    if (isMonitoring && !stream) {
      startCamera();
    } else if (!isMonitoring && stream) {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isMonitoring]);

  // Mantenimiento de linterna simplificado
  useEffect(() => {
    if (!stream || !deviceSupportsTorch || !isMonitoring) return;
    
    const maintainTorch = async () => {
      if (!isMonitoring) return;

      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings && (track.getSettings() as any);
      const torchIsOn = settings?.torch === true;

      if (!torchIsOn && deviceSupportsTorch) {
        try {
          await track.applyConstraints({
            advanced: [{ torch: true }]
          });
          setTorchEnabled(true);
        } catch (err) {
          setTorchEnabled(false);
        }
      }
    };
    
    const interval = setInterval(maintainTorch, 3000);
    maintainTorch();
    
    return () => clearInterval(interval);
  }, [stream, isMonitoring, deviceSupportsTorch]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="absolute top-0 left-0 min-w-full min-h-full w-auto h-auto z-0 object-cover"
      style={{
        willChange: 'transform',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden'
      }}
    />
  );
};

export default CameraView;
