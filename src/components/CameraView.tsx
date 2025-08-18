import React, { useRef, useEffect, useState } from 'react';
import { toast } from "@/components/ui/use-toast";
// Importación corregida - usar clases disponibles
// import { AdvancedVitalSignsProcessor, BiometricReading } from '../modules/vital-signs/VitalSignsProcessor';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onPPGSignal?: (ppgValue: number, fingerDetected: boolean) => void; // NUEVA: callback para señal PPG
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

const CameraView = ({ 
  onStreamReady, 
  onPPGSignal,
  isMonitoring,
  isFingerDetected = false, 
  signalQuality = 0,
}: CameraViewProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  // Referencia al canvas para procesamiento de frames
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const processFrame = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return;
    
    // Ajustar tamaño del canvas al video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Capturar frame actual
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    try {
      // Extraer ImageData del frame REAL
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // PROCESAMIENTO REAL: Análisis de la región central donde está el dedo
      const centerX = Math.floor(canvas.width / 2);
      const centerY = Math.floor(canvas.height / 2);
      const roiSize = Math.min(80, Math.floor(Math.min(canvas.width, canvas.height) / 6));
      
      let redSum = 0, greenSum = 0, blueSum = 0, pixelCount = 0;
      
      // Extraer valores RGB promedio de la ROI central
      for (let y = centerY - roiSize; y < centerY + roiSize; y++) {
        for (let x = centerX - roiSize; x < centerX + roiSize; x++) {
          if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
            const index = (y * canvas.width + x) * 4;
            redSum += imageData.data[index];         // R
            greenSum += imageData.data[index + 1];   // G  
            blueSum += imageData.data[index + 2];    // B
            pixelCount++;
          }
        }
      }
      
      if (pixelCount > 0) {
        const avgRed = redSum / pixelCount;
        const avgGreen = greenSum / pixelCount;
        const avgBlue = blueSum / pixelCount;
        
        // PROCESAMIENTO PPG ESPECIALIZADO PARA CÁMARA
        const rgRatio = avgRed / (avgGreen + 1);
        const brightness = (avgRed + avgGreen + avgBlue) / 3;
        const redIntensity = avgRed / 255;
        
        // ALGORITMO SOFISTICADO DE EXTRACCIÓN PPG PARA CÁMARA (COMPILACIÓN CELULAR)
        // Sistema adaptativo multi-dimensional para optimizar señal débil
        if (!(window as any).ppgBaseline) (window as any).ppgBaseline = avgRed;
        if (!(window as any).ppgHistory) (window as any).ppgHistory = [];
        
        // BASELINE ADAPTATIVO INTELIGENTE con memoria histórica
        const alpha = (window as any).ppgHistory.length < 10 ? 0.1 : 0.02; // Adaptación inicial más rápida
        (window as any).ppgBaseline = (window as any).ppgBaseline * (1-alpha) + avgRed * alpha;
        
        // FILTRADO AVANZADO DE SEÑAL PPG
        const rawPPGSignal = (avgRed - (window as any).ppgBaseline) / (window as any).ppgBaseline;
        
        // Agregar al historial para análisis temporal
        (window as any).ppgHistory.push(rawPPGSignal);
        if ((window as any).ppgHistory.length > 20) (window as any).ppgHistory.shift();
        
        // ALGORITMO DE AMPLIFICACIÓN INTELIGENTE basado en varianza reciente
        const recentVariance = (window as any).ppgHistory.length > 5 ? 
          (window as any).ppgHistory.reduce((acc: number, val: number) => acc + Math.pow(val, 2), 0) / (window as any).ppgHistory.length : 0.01;
        const adaptiveGain = Math.max(3.0, Math.min(15.0, 1.0 / Math.sqrt(recentVariance))); // Gain inversamente proporcional a varianza
        
        const ppgAmplified = rawPPGSignal * adaptiveGain;
        const ppgNormalized = Math.max(0.0, Math.min(1.0, ppgAmplified + 0.5));
        
        // Criterios biofísicos mejorados para detectar tejido perfundido
        const fingerDetected = 
          avgRed > 50 &&                    // AUMENTADO: Mínima intensidad roja
          brightness > 70 &&                // AUMENTADO: Brillo mínimo  
          rgRatio > 1.1 && rgRatio < 3.8 && // AJUSTADO: Ratio fisiológico
          redIntensity > 0.25;              // AUMENTADO: Intensidad normalizada
        
        // ANÁLISIS AVANZADO CON ALGORITMOS DE VANGUARDIA
        const timestamp = Date.now();
        if (fingerDetected) {
          console.log(`CameraView: 🟢 ALGORITMO SOFISTICADO - PPG DE VANGUARDIA [${timestamp}]`, {
            // Valores cámara RAW
            avgRed: avgRed.toFixed(1),
            avgGreen: avgGreen.toFixed(1), 
            avgBlue: avgBlue.toFixed(1),
            brightness: brightness.toFixed(1),
            rgRatio: rgRatio.toFixed(3),
            
            // PROCESAMIENTO AVANZADO PPG
            baselineAdaptativo: (window as any).ppgBaseline.toFixed(2),
            señalPPGRaw: rawPPGSignal.toFixed(6),
            varianzaReciente: recentVariance.toFixed(6),
            gainAdaptativo: adaptiveGain.toFixed(2),
            ppgAmplificado: ppgAmplified.toFixed(6),
            ppgFinal: ppgNormalized.toFixed(6),
            
            // ANÁLISIS TEMPORAL INTELIGENTE
            historiaPPG: (window as any).ppgHistory.length,
            variacionDesdeUltimo: ppgNormalized - ((window as any).lastPPGValue || 0.5),
            timestamp,
            intervaloDeProceso: timestamp - ((window as any).lastPPGTimestamp || timestamp)
          });
          
          // Guardar para algoritmos adaptativos
          (window as any).lastPPGValue = ppgNormalized;
          (window as any).lastPPGTimestamp = timestamp;
          
          // ENVIAR SEÑAL PPG PROCESADA directamente CON ANÁLISIS
          if (onPPGSignal) {
            // Log crítico: QUÉ valor exacto se está enviando
            console.log(`📡 ENVIANDO PPG [${timestamp}]:`, {
              valor: ppgNormalized.toFixed(6),
              esVariacionSignificativa: Math.abs(ppgNormalized - ((window as any).lastSentPPG || 0.5)) > 0.01,
              ultimoEnviado: ((window as any).lastSentPPG || 'N/A'),
              diferencia: Math.abs(ppgNormalized - ((window as any).lastSentPPG || 0.5)).toFixed(6)
            });
            
            (window as any).lastSentPPG = ppgNormalized;
            onPPGSignal(ppgNormalized, fingerDetected);
          }
          
          // También llamar onStreamReady para compatibilidad
          if (onStreamReady && stream) {
            onStreamReady(stream);
          }
          
        } else {
          // Solo log cada 10 frames para evitar spam
          if (timestamp % 1000 < 100) { // Aprox cada segundo
            console.log('CameraView: 🔴 Sin dedo detectado', {
              avgRed: avgRed.toFixed(1),
              brightness: brightness.toFixed(1),
              rgRatio: rgRatio.toFixed(2),
              'razón': avgRed < 50 ? '❌ rojo bajo' : 
                       brightness < 70 ? '❌ brillo bajo' :
                       rgRatio <= 1.1 || rgRatio >= 3.8 ? '❌ ratio inválido' : '❌ intensidad baja'
            });
          }
        }
      }
    } catch (error) {
      console.error('CameraView: Error procesando frame real:', error);
    }
  };

  // PROCESAMIENTO CONTINUO DE FRAMES activado
  useEffect(() => {
    if (!isMonitoring || !stream) return;
    
    const intervalId = setInterval(() => {
      processFrame();
    }, 100); // Procesar cada 100ms (10 FPS para análisis)
    
    console.log('CameraView: Iniciando procesamiento continuo de frames para detección real');
    
    return () => {
      clearInterval(intervalId);
      console.log('CameraView: Deteniendo procesamiento de frames');
    };
  }, [isMonitoring, stream]);

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
    <>
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
      <canvas
        ref={canvasRef}
        className="hidden"
        style={{ display: 'none' }}
      />
    </>
  );
};

export default CameraView;
