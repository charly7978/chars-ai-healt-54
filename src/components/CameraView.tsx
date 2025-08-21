import React, { useRef, useEffect, useState } from 'react';
import { toast } from "@/components/ui/use-toast";
import { VitalSignsProcessor, VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
  processVitalSigns: (ppgValue: number, rrData?: { intervals: number[]; lastPeakTime: number | null }) => any;
  onFingerDetected?: (detected: boolean, quality: number) => void;
}

const CameraView = ({ 
  onStreamReady, 
  isMonitoring, 
  isFingerDetected = false, 
  signalQuality = 0,
  processVitalSigns,
  onFingerDetected,
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const frameIntervalRef = useRef<number>(1000 / 30); // 30 FPS
  const lastFrameTimeRef = useRef<number>(0);
  const [deviceSupportsAutoFocus, setDeviceSupportsAutoFocus] = useState(false);
  const [deviceSupportsTorch, setDeviceSupportsTorch] = useState(false);
  const torchAttempts = useRef<number>(0);
  const cameraInitialized = useRef<boolean>(false);
  const requestedTorch = useRef<boolean>(false);

  const stopCamera = async () => {
    if (stream) {
      stream.getTracks().forEach(track => {
        if (track.kind === 'video' && track.getCapabilities()?.torch) {
          track.applyConstraints({
            advanced: [{ torch: false }]
          }).catch(err => {
            if (process.env.NODE_ENV !== 'production') {
              console.error("Error desactivando linterna:", err);
            }
          });
        }
        
        track.stop();
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      setStream(null);
      setTorchEnabled(false);
      cameraInitialized.current = false;
      requestedTorch.current = false;
    }
  };

  const startCamera = async () => {
    alert("🎬 INICIANDO CÁMARA"); // LOG VISIBLE
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (process.env.NODE_ENV !== 'production') {
          console.error("Su dispositivo no soporta acceso a la cámara");
        }
        throw new Error("getUserMedia no está soportado");
      }

      const isAndroid = /android/i.test(navigator.userAgent);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

      let baseVideoConstraints: MediaTrackConstraints = {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };

      if (process.env.NODE_ENV !== 'production') {
        console.log("CameraView: Configurando cámara para detección de dedo");
      }

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

      if (process.env.NODE_ENV !== 'production') {
        console.log("CameraView: Intentando obtener acceso a la cámara con constraints:", constraints);
      }
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (process.env.NODE_ENV !== 'production') {
        console.log("CameraView: Acceso a la cámara obtenido exitosamente");
      }
      
      if (!onStreamReady) {
        if (process.env.NODE_ENV !== 'production') {
          console.error("CameraView: onStreamReady callback no disponible");
        }
        toast({
          title: "Error de cámara",
          description: "No hay callback para procesar el video",
          variant: "destructive"
        });
      }
      
      const videoTrack = newStream.getVideoTracks()[0];

      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities();
          if (process.env.NODE_ENV !== 'production') {
            console.log("CameraView: Capacidades de la cámara:", capabilities);
          }
          
          torchAttempts.current = 0;
          requestedTorch.current = false;
          
          const advancedConstraints: MediaTrackConstraintSet[] = [];
          
          if (capabilities.exposureMode) {
            advancedConstraints.push({ 
              exposureMode: 'manual'
            });
            if (process.env.NODE_ENV !== 'production') {
              console.log("CameraView: Modo de exposición manual aplicado");
            }

            if (capabilities.exposureTime) {
              const minExposure = capabilities.exposureTime.min || 0;
              const maxExposure = capabilities.exposureTime.max || 1000;
              const targetExposure = maxExposure * 0.8;
              
              advancedConstraints.push({
                exposureTime: targetExposure
              });
              if (process.env.NODE_ENV !== 'production') {
                console.log(`CameraView: Tiempo de exposición ajustado a ${targetExposure}`);
              }
            }
          }
          
          if (capabilities.focusMode) {
            advancedConstraints.push({ focusMode: 'continuous' });
            setDeviceSupportsAutoFocus(true);
            if (process.env.NODE_ENV !== 'production') {
              console.log("CameraView: Modo de enfoque continuo aplicado");
            }
          }
          
          if (capabilities.whiteBalanceMode) {
            advancedConstraints.push({ whiteBalanceMode: 'continuous' });
            if (process.env.NODE_ENV !== 'production') {
              console.log("CameraView: Modo de balance de blancos continuo aplicado");
            }
          }

          if (advancedConstraints.length > 0) {
            try {
              await videoTrack.applyConstraints({
                advanced: advancedConstraints
              });
              if (process.env.NODE_ENV !== 'production') {
                console.log("CameraView: Constraints avanzados aplicados exitosamente");
              }
            } catch (err) {
              if (process.env.NODE_ENV !== 'production') {
                console.error("CameraView: Error aplicando constraints avanzados:", err);
              }
            }
          }

          if (videoRef.current) {
            videoRef.current.style.transform = 'translateZ(0)';
            videoRef.current.style.backfaceVisibility = 'hidden';
          }
          
          if (capabilities.torch) {
            if (process.env.NODE_ENV !== 'production') {
              console.log("CameraView: Este dispositivo tiene linterna disponible");
            }
            setDeviceSupportsTorch(true);
            
            try {
              await handleTorch(true);
              if (process.env.NODE_ENV !== 'production') {
                console.log("CameraView: Linterna activada para medición PPG");
              }
            } catch (err) {
              if (process.env.NODE_ENV !== 'production') {
                console.error("CameraView: Error activando linterna:", err);
              }
              torchAttempts.current++;
              
              setTimeout(async () => {
                try {
                  await handleTorch(true);
                  if (process.env.NODE_ENV !== 'production') {
                    console.log("CameraView: Linterna activada en segundo intento");
                  }
                } catch (err) {
                  if (process.env.NODE_ENV !== 'production') {
                    console.error("CameraView: Error en segundo intento de linterna:", err);
                  }
                }
              }, 1000);
            }
          } else {
            if (process.env.NODE_ENV !== 'production') {
              console.log("CameraView: Este dispositivo no tiene linterna disponible");
            }
            setDeviceSupportsTorch(false);
          }
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.log("CameraView: No se pudieron aplicar algunas optimizaciones:", err);
          }
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
        if (process.env.NODE_ENV !== 'production') {
          console.log("CameraView: Llamando onStreamReady con stream:", {
            hasVideoTracks: newStream.getVideoTracks().length > 0,
            streamActive: newStream.active,
            timestamp: new Date().toISOString()
          });
        }
        onStreamReady(newStream);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error("CameraView: Error al iniciar la cámara:", err);
      }
    }
  };

  const handleTorch = async (enable: boolean) => {
    if (!deviceSupportsTorch) return;
    
    try {
      await stream?.getVideoTracks()[0].applyConstraints({
        advanced: [{ torch: enable }]
      });
      setTorchEnabled(enable);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error("Error al manejar linterna:", err);
      }
    }
  };

  const handleAutoFocus = async () => {
    if (!deviceSupportsAutoFocus) return;
    
    try {
      await stream?.getVideoTracks()[0].applyConstraints({
        advanced: [{ focusMode: 'continuous' }]
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn("Error al ajustar enfoque:", err);
      }
    }
  };

  const processFrame = (frameData: ImageData) => {
    const { red, ir, green } = extractPPGSignals(frameData);
    
    // ✅ RESTAURAR DETECCIÓN DE DEDO: Calcular calidad de señal
    const signalQuality = calculateSignalQuality(red[0], ir[0], green[0]);
    const fingerDetected = signalQuality > 15; // ✅ AJUSTAR: Umbral más permisivo (antes era 30)
    
    console.log("📊 Frame procesado:", { 
      red: red[0], 
      ir: ir[0], 
      green: green[0],
      signalQuality,
      fingerDetected
    });
    
    // LOG VISIBLE si detecta dedo
    if (fingerDetected) {
      alert(`✅ DEDO DETECTADO! Calidad: ${signalQuality}`);
    }
    
    // ✅ RESTAURAR CALLBACK: Notificar detección de dedo
    if (onFingerDetected) {
      onFingerDetected(fingerDetected, signalQuality);
    }
    
    // ✅ UNIFICADO: Usar solo el procesador principal
    // ✅ CORREGIR: Normalizar el valor RGB (0-255) a PPG (0-1) para detección correcta
    const normalizedPPGValue = red[0] / 255; // Normalizar de 0-255 a 0-1
    
    const results = processVitalSigns(
      normalizedPPGValue, // Valor normalizado para detección correcta
      undefined // Sin datos RR por ahora
    );
    
    if (results) {
      handleResults(results);
    }
  };

  // ✅ RESTAURAR FUNCIÓN: Calcular calidad de señal para detección de dedo
  const calculateSignalQuality = (red: number, ir: number, green: number): number => {
    // ✅ AJUSTAR: Umbrales más realistas para cámara
    // Validar que los valores estén en rango fisiológico (más permisivo)
    if (red < 5 || green < 5 || ir < 5) return 0; // Reducido de 10 a 5
    
    // Calcular ratios fisiológicos (más permisivos)
    const rToGRatio = red / green;
    const rToIRRatio = red / ir;
    
    // ✅ AJUSTAR: Ratios más permisivos para cámara
    if (rToGRatio < 0.5 || rToGRatio > 4.0) return 0; // Ampliado de 0.8-2.5 a 0.5-4.0
    if (rToIRRatio < 0.3 || rToIRRatio > 5.0) return 0; // Ampliado de 0.6-3.0 a 0.3-5.0
    
    // Calcular calidad basada en intensidad y estabilidad
    const intensity = (red + green + ir) / 3;
    const stabilityBonus = Math.min(20, intensity / 10);
    
    // Calidad final (0-100)
    return Math.min(100, Math.max(0, intensity + stabilityBonus));
  };

  const extractPPGSignals = (frameData: ImageData) => {
    const { width, height, data } = frameData;
    const pixelCount = width * height;
    
    // Promedios de canales con ROI centrado para mayor estabilidad
    let redSum = 0, irSum = 0, greenSum = 0;
    let validPixels = 0;
    
    // ROI centrado para evitar bordes y ruido - CALIBRACIÓN SUTIL PARA ROBUSTEZ
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const roiSize = Math.min(width, height) * 0.72; // ROI ligeramente ampliado para mayor robustez
    
    const startX = Math.max(0, centerX - roiSize / 2);
    const endX = Math.min(width, centerX + roiSize / 2);
    const startY = Math.max(0, centerY - roiSize / 2);
    const endY = Math.min(height, centerY + roiSize / 2);
    
    // Extraer señales solo del ROI para mayor estabilidad
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];     // Canal Rojo
        const g = data[i+1];   // Canal Verde
        const b = data[i+2];   // Canal Azul (IR)
        
        // Validar que los valores estén en rango fisiológico
        if (r > 0 && g > 0 && b > 0 && r < 255 && g < 255 && b < 255) {
          redSum += r;
          greenSum += g;
          irSum += b;
          validPixels++;
        }
      }
    }
    
    // Calcular promedios solo de píxeles válidos
    if (validPixels > 0) {
      return {
        red: [redSum / validPixels],
        ir: [irSum / validPixels],
        green: [greenSum / validPixels]
      };
    }
    
    // Fallback si no hay píxeles válidos
    return {
      red: [0],
      ir: [0],
      green: [0]
    };
  };

  const handleResults = (results: VitalSignsResult) => {
    console.log('Mediciones biométricas:', {
      spo2: results.spo2.toFixed(1) + '%',
      pressure: results.pressure + ' mmHg',
      glucose: results.glucose.toFixed(0) + ' mg/dL',
      arrhythmiaStatus: results.arrhythmiaStatus
    });
  };

  // ✅ RESTAURAR FUNCIÓN: Procesamiento en tiempo real de frames
  const startRealTimeProcessing = () => {
    if (!stream || !isMonitoring) return;
    
    const processNextFrame = () => {
      if (!stream || !isMonitoring) return;
      
      const video = videoRef.current;
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        requestAnimationFrame(processNextFrame);
        return;
      }
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      ctx.drawImage(video, 0, 0);
      const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      processFrame(frameData);
      
      // Continuar procesamiento
      requestAnimationFrame(processNextFrame);
    };
    
    // Iniciar procesamiento después de un delay para estabilizar la cámara
    setTimeout(() => {
      alert("🚀 INICIANDO PROCESAMIENTO DE FRAMES");
      processNextFrame();
    }, 2000);
  };

  useEffect(() => {
    if (isMonitoring && !stream) {
      if (process.env.NODE_ENV !== 'production') {
        console.log("[DIAG] CameraView: Iniciando cámara porque isMonitoring=true");
      }
      startCamera();
    } else if (!isMonitoring && stream) {
      if (process.env.NODE_ENV !== 'production') {
        console.log("[DIAG] CameraView: Deteniendo cámara porque isMonitoring=false");
      }
      stopCamera();
    }
    return () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log("[DIAG] CameraView: Desmontando componente, deteniendo cámara");
      }
      stopCamera();
    };
  }, [isMonitoring]);

  // ✅ RESTAURAR: Activar procesamiento en tiempo real cuando la cámara esté lista
  useEffect(() => {
    if (stream && isMonitoring) {
      console.log("🎥 CameraView: Cámara lista, iniciando procesamiento en tiempo real");
      alert("🎥 CÁMARA LISTA - INICIANDO PROCESAMIENTO"); // LOG VISIBLE
      startRealTimeProcessing();
    }
  }, [stream, isMonitoring]);

  useEffect(() => {
    if (!stream || !isMonitoring || !deviceSupportsAutoFocus) return;
    
    let focusInterval: number;
    
    const focusIntervalTime = isFingerDetected ? 4000 : 1500;
    
    const attemptRefocus = async () => {
      await handleAutoFocus();
    };
    
    attemptRefocus();
    
    focusInterval = window.setInterval(attemptRefocus, focusIntervalTime);
    
    return () => {
      clearInterval(focusInterval);
    };
  }, [stream, isMonitoring, isFingerDetected, deviceSupportsAutoFocus]);

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
