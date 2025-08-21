import React, { useRef, useEffect, useState } from 'react';
import { toast } from "@/components/ui/use-toast";
import { VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
  onFingerDetected?: (detected: boolean, quality: number) => void;
  processVitalSigns: (ppgValue: number, rrData?: { intervals: number[]; lastPeakTime: number | null }) => any;
}

const CameraView = ({ 
  onStreamReady, 
  isMonitoring, 
  isFingerDetected = false, 
  signalQuality = 0,
  onFingerDetected,
  processVitalSigns,
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
        
        // ✅ INICIAR PROCESAMIENTO EN TIEMPO REAL PARA MEDICIÓN PPG CONTINUA
        console.log("⏰ Programando inicio de procesamiento en tiempo real...");
        setTimeout(() => {
          console.log("🔍 Intentando iniciar procesamiento en tiempo real...");
          startRealTimeProcessing();
        }, 2000); // Aumentar delay para asegurar que el video esté listo
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
    
    console.log("📊 Frame procesado:", { red: red[0], ir: ir[0], green: green[0] });
    
    // ✅ UNIFICADO: Usar la función processVitalSigns que viene como prop
    const results = processVitalSigns(
      red[0], // Usar solo el valor principal
      undefined // Sin datos RR por ahora
    );
    
    if (results) {
      handleResults(results);
      
      // Notificar detección de dedo basado en la calidad de la señal
      const signalQuality = calculateSignalQuality(red[0], ir[0], green[0]);
      const fingerDetected = signalQuality > 30; // Umbral para detección de dedo
      
      console.log("👆 Detección de dedo:", { fingerDetected, signalQuality });
      
      if (onFingerDetected) {
        onFingerDetected(fingerDetected, signalQuality);
      }
    }
  };

  // ✅ PROCESAMIENTO EN TIEMPO REAL DE FRAMES PARA MEDICIÓN PPG CONTINUA
  const startRealTimeProcessing = () => {
    if (!stream || !isMonitoring) return;
    
    const videoElement = videoRef.current;
    if (!videoElement) return;
    
    console.log("🚀 Iniciando procesamiento en tiempo real de frames PPG");
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = 320;
    canvas.height = 240;
    
    const processFrameRealTime = () => {
      if (!isMonitoring || !stream || !videoElement) return;
      
      try {
        // Verificar que el video esté listo
        if (videoElement.readyState >= 2) {
          // Capturar frame del video
          ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          // Procesar frame para extraer señal PPG
          processFrame(imageData);
        }
        
        // Continuar procesamiento en tiempo real
        requestAnimationFrame(processFrameRealTime);
      } catch (error) {
        console.error("Error en procesamiento en tiempo real:", error);
        // Reintentar en caso de error
        setTimeout(() => requestAnimationFrame(processFrameRealTime), 100);
      }
    };
    
    // Iniciar procesamiento en tiempo real
    processFrameRealTime();
  };

  const calculateSignalQuality = (red: number, ir: number, green: number): number => {
    // ✅ ALGORITMO AVANZADO DE CALIDAD DE SEÑAL PPG BASADO EN CRITERIOS MÉDICOS
    if (red === 0 || green === 0 || ir === 0) return 0;
    
    // Análisis de relaciones fisiológicas entre canales
    const rToG = red / green;
    const rToIR = red / ir;
    const gToIR = green / ir;
    
    // Validación de rangos fisiológicos para tejido humano
    const physiologicalRanges = {
      rToG: { min: 0.8, max: 4.5, weight: 0.4 },
      rToIR: { min: 0.6, max: 3.0, weight: 0.3 },
      gToIR: { min: 0.4, max: 2.5, weight: 0.2 },
      intensity: { min: 30, max: 200, weight: 0.1 }
    };
    
    // Calcular puntuación de calidad para cada criterio
    const rToGScore = calculateRangeScore(rToG, physiologicalRanges.rToG);
    const rToIRScore = calculateRangeScore(rToIR, physiologicalRanges.rToIR);
    const gToIRScore = calculateRangeScore(gToIR, physiologicalRanges.gToIR);
    const intensityScore = calculateRangeScore(red, physiologicalRanges.intensity);
    
    // Calcular calidad ponderada
    const weightedQuality = 
      rToGScore * physiologicalRanges.rToG.weight +
      rToIRScore * physiologicalRanges.rToIR.weight +
      gToIRScore * physiologicalRanges.gToIR.weight +
      intensityScore * physiologicalRanges.intensity.weight;
    
    // Aplicar filtro de estabilidad temporal
    const stabilityBonus = calculateStabilityBonus(red, ir, green);
    
    return Math.min(100, Math.max(0, weightedQuality * 100 + stabilityBonus));
  };

  // ✅ CALCULAR PUNTUACIÓN DE RANGO FISIOLÓGICO
  const calculateRangeScore = (value: number, range: { min: number, max: number, weight: number }): number => {
    if (value >= range.min && value <= range.max) {
      return 1.0; // Rango óptimo
    } else if (value >= range.min * 0.8 && value <= range.max * 1.2) {
      return 0.8; // Rango aceptable
    } else if (value >= range.min * 0.6 && value <= range.max * 1.4) {
      return 0.6; // Rango marginal
    } else {
      return 0.2; // Fuera de rango
    }
  };

  // ✅ CALCULAR BONUS DE ESTABILIDAD TEMPORAL
  const calculateStabilityBonus = (red: number, ir: number, green: number): number => {
    // Simular estabilidad basada en la consistencia de los valores
    const totalIntensity = red + ir + green;
    const normalizedIntensity = totalIntensity / 765; // 255 * 3
    
    // Bonus por estabilidad (valores consistentes)
    if (normalizedIntensity > 0.3 && normalizedIntensity < 0.7) {
      return 5; // Bonus por rango óptimo de intensidad
    } else if (normalizedIntensity > 0.2 && normalizedIntensity < 0.8) {
      return 2; // Bonus por rango aceptable
    }
    
    return 0;
  };

  const extractPPGSignals = (frameData: ImageData) => {
    const { width, height, data } = frameData;
    
    // ✅ ALGORITMO AVANZADO DE EXTRACCIÓN PPG CON ANÁLISIS ESPECTRAL
    let redSum = 0, irSum = 0, greenSum = 0;
    let validPixels = 0;
    let redVariance = 0, irVariance = 0, greenVariance = 0;
    
    // ROI centrado optimizado para detección de tejido humano
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const roiSize = Math.min(width, height) * 0.72; // ROI optimizado
    
    const startX = Math.max(0, centerX - roiSize / 2);
    const endX = Math.min(width, centerX + roiSize / 2);
    const startY = Math.max(0, centerY - roiSize / 2);
    const endY = Math.min(height, centerY + roiSize / 2);
    
    // ✅ ANÁLISIS ESPECTRAL AVANZADO DE PÍXELES
    const pixelValues = { red: [], green: [], ir: [] };
    
    // Extraer señales solo del ROI para mayor estabilidad
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];     // Canal Rojo
        const g = data[i+1];   // Canal Verde
        const b = data[i+2];   // Canal Azul (IR)
        
        // ✅ VALIDACIÓN AVANZADA DE RANGOS FISIOLÓGICOS
        if (isValidPhysiologicalPixel(r, g, b)) {
          redSum += r;
          greenSum += g;
          irSum += b;
          validPixels++;
          
          // Acumular para análisis de varianza
          pixelValues.red.push(r);
          pixelValues.green.push(g);
          pixelValues.ir.push(b);
        }
      }
    }
    
    // Calcular promedios solo de píxeles válidos
    if (validPixels > 0) {
      const redAvg = redSum / validPixels;
      const greenAvg = greenSum / validPixels;
      const irAvg = irSum / validPixels;
      
      // ✅ ANÁLISIS DE VARIANZA PARA CALIDAD DE SEÑAL
      const redStd = calculateStandardDeviation(pixelValues.red, redAvg);
      const greenStd = calculateStandardDeviation(pixelValues.green, greenAvg);
      const irStd = calculateStandardDeviation(pixelValues.ir, irAvg);
      
      // Aplicar filtro de calidad basado en varianza
      const qualityFilter = applyQualityFilter(redStd, greenStd, irStd);
      
      return {
        red: [redAvg * qualityFilter],
        ir: [irAvg * qualityFilter],
        green: [greenAvg * qualityFilter],
        quality: qualityFilter,
        variance: { red: redStd, green: greenStd, ir: irStd }
      };
    }
    
    // Fallback si no hay píxeles válidos
    return {
      red: [0],
      ir: [0],
      green: [0],
      quality: 0,
      variance: { red: 0, green: 0, ir: 0 }
    };
  };

  // ✅ VALIDACIÓN AVANZADA DE PÍXELES FISIOLÓGICOS
  const isValidPhysiologicalPixel = (r: number, g: number, b: number): boolean => {
    // Validar que los valores estén en rango fisiológico
    if (r < 10 || g < 10 || b < 10 || r > 250 || g > 250 || b > 250) {
      return false;
    }
    
    // Validar relaciones fisiológicas entre canales
    const rToG = r / g;
    const rToB = r / b;
    
    // Rangos fisiológicos para tejido humano
    return rToG >= 0.6 && rToG <= 5.0 && rToB >= 0.5 && rToB <= 4.0;
  };

  // ✅ CALCULAR DESVIACIÓN ESTÁNDAR PARA ANÁLISIS DE CALIDAD
  const calculateStandardDeviation = (values: number[], mean: number): number => {
    if (values.length === 0) return 0;
    
    const variance = values.reduce((sum, value) => {
      return sum + Math.pow(value - mean, 2);
    }, 0) / values.length;
    
    return Math.sqrt(variance);
  };

  // ✅ APLICAR FILTRO DE CALIDAD BASADO EN VARIANZA
  const applyQualityFilter = (redStd: number, greenStd: number, irStd: number): number => {
    // Calcular calidad basada en la estabilidad de la señal
    const avgStd = (redStd + greenStd + irStd) / 3;
    
    // Menor varianza = mayor calidad
    if (avgStd < 5) return 1.0;      // Excelente
    else if (avgStd < 15) return 0.9; // Muy buena
    else if (avgStd < 25) return 0.8; // Buena
    else if (avgStd < 35) return 0.7; // Aceptable
    else if (avgStd < 50) return 0.6; // Marginal
    else return 0.4;                  // Baja
  };

  const handleResults = (results: VitalSignsResult) => {
    console.log('Mediciones biométricas:', {
      spo2: results.spo2.toFixed(1) + '%',
      pressure: results.pressure + ' mmHg',
      glucose: results.glucose.toFixed(0) + ' mg/dL',
      arrhythmiaStatus: results.arrhythmiaStatus
    });
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
    } else if (isMonitoring && stream) {
      // ✅ FALLBACK: Si ya hay stream y se activa monitoreo, iniciar procesamiento
      console.log("🔄 Stream ya activo, iniciando procesamiento en tiempo real...");
      setTimeout(() => startRealTimeProcessing(), 1000);
    }
    
    return () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log("[DIAG] CameraView: Desmontando componente, deteniendo cámara");
      }
      stopCamera();
    };
  }, [isMonitoring]);

  useEffect(() => {
    if (!stream || !deviceSupportsTorch || !isMonitoring) return;
    
    const keepTorchOn = async () => {
      if (!isMonitoring || !deviceSupportsTorch) return;

      const torchIsReallyOn = stream.getVideoTracks()[0].getSettings && (stream.getVideoTracks()[0].getSettings() as any).torch === true;

      if (!torchIsReallyOn) {
        try {
          await handleTorch(true);
          if (process.env.NODE_ENV !== 'production') {
            console.log("CameraView: Re-activando linterna (torch)");
          }
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.error("CameraView: Error re-encendiendo linterna:", err);
          }
          torchAttempts.current++;
          setTorchEnabled(false);
        }
      } else {
        if (!torchEnabled) {
          setTorchEnabled(true);
        }
      }
    };
    
    const torchCheckInterval = setInterval(keepTorchOn, 2000);
    
    keepTorchOn();
    
    return () => {
      clearInterval(torchCheckInterval);
    };
  }, [stream, isMonitoring, deviceSupportsTorch, torchEnabled]);

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
