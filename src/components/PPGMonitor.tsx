import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * PPG MONITOR - SISTEMA UNIFICADO NUEVO
 * 
 * Un solo componente que maneja:
 * 1. Captura de cámara con flash
 * 2. Extracción de señal PPG (canal rojo)
 * 3. Detección de latidos
 * 4. Cálculo de BPM
 * 
 * Sin módulos externos, todo auto-contenido.
 */

interface PPGData {
  redValue: number;
  signalValue: number;
  quality: number;
  fingerDetected: boolean;
  bpm: number;
  isPeak: boolean;
  rrIntervals: number[];
}

interface PPGMonitorProps {
  isActive: boolean;
  onData: (data: PPGData) => void;
  onCameraReady?: () => void;
  onError?: (error: string) => void;
}

const PPGMonitor: React.FC<PPGMonitorProps> = ({ 
  isActive, 
  onData, 
  onCameraReady,
  onError 
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  
  // Buffers para análisis
  const redValuesRef = useRef<number[]>([]);
  const peakTimesRef = useRef<number[]>([]);
  const lastPeakTimeRef = useRef<number>(0);
  const baselineRef = useRef<number>(0);
  const bpmRef = useRef<number>(0);
  
  // Constantes
  const BUFFER_SIZE = 150; // 5 segundos @ 30fps
  const MIN_PEAK_DISTANCE_MS = 300; // Máximo 200 BPM
  const MAX_PEAK_DISTANCE_MS = 2000; // Mínimo 30 BPM
  
  // Iniciar cámara
  const startCamera = useCallback(async () => {
    console.log('🎥 PPGMonitor: Iniciando cámara...');
    
    try {
      // Intentar cámara trasera primero
      let stream: MediaStream | null = null;
      
      const constraints = [
        // Intento 1: Trasera con resolución específica
        {
          audio: false,
          video: {
            facingMode: { exact: 'environment' },
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 30 }
          }
        },
        // Intento 2: Trasera simple
        {
          audio: false,
          video: { facingMode: 'environment' }
        },
        // Intento 3: Cualquier cámara
        {
          audio: false,
          video: true
        }
      ];
      
      for (const constraint of constraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraint);
          console.log('✅ Cámara obtenida con:', JSON.stringify(constraint.video));
          break;
        } catch (e) {
          console.log('⚠️ Falló constraint:', e);
        }
      }
      
      if (!stream) {
        throw new Error('No se pudo acceder a ninguna cámara');
      }
      
      if (!activeRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      
      streamRef.current = stream;
      
      // Conectar al video
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        await new Promise<void>((resolve, reject) => {
          const video = videoRef.current!;
          const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
          
          video.onloadedmetadata = () => {
            clearTimeout(timeout);
            video.play()
              .then(() => resolve())
              .catch(reject);
          };
        });
        
        console.log('▶️ Video reproduciendo:', 
          videoRef.current.videoWidth, 'x', videoRef.current.videoHeight);
      }
      
      // Encender flash
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = track.getCapabilities?.() as any;
        
        if (capabilities?.torch) {
          try {
            await track.applyConstraints({
              advanced: [{ torch: true } as any]
            });
            console.log('🔦 Flash ENCENDIDO');
          } catch (e) {
            console.log('⚠️ Flash no disponible:', e);
          }
        } else {
          console.log('ℹ️ Esta cámara no tiene flash');
        }
      }
      
      onCameraReady?.();
      
      // Iniciar captura de frames
      startFrameCapture();
      
    } catch (error: any) {
      console.error('❌ Error cámara:', error);
      onError?.(error.message || 'Error de cámara');
    }
  }, [onCameraReady, onError]);
  
  // Detener cámara
  const stopCamera = useCallback(() => {
    console.log('🛑 PPGMonitor: Deteniendo...');
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        // Apagar flash primero
        try {
          (track as any).applyConstraints?.({
            advanced: [{ torch: false }]
          });
        } catch {}
        track.stop();
      });
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    // Reset buffers
    redValuesRef.current = [];
    peakTimesRef.current = [];
    lastPeakTimeRef.current = 0;
    baselineRef.current = 0;
    bpmRef.current = 0;
  }, []);
  
  // Captura de frames
  const startFrameCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Configurar canvas
    canvas.width = 64;  // Pequeño para velocidad
    canvas.height = 48;
    
    let lastFrameTime = 0;
    const targetInterval = 1000 / 30; // 30 FPS
    
    const processFrame = (timestamp: number) => {
      if (!activeRef.current) return;
      
      // Control de FPS
      if (timestamp - lastFrameTime < targetInterval) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      lastFrameTime = timestamp;
      
      if (video.readyState < 2 || video.videoWidth === 0) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      // Capturar frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Procesar y emitir datos
      const data = analyzeFrame(imageData, timestamp);
      onData(data);
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    animationRef.current = requestAnimationFrame(processFrame);
  }, [onData]);
  
  // Análisis del frame
  const analyzeFrame = useCallback((imageData: ImageData, timestamp: number): PPGData => {
    const data = imageData.data;
    const pixelCount = data.length / 4;
    
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let skinPixels = 0;
    
    // Extraer valores RGB (región central)
    const startX = Math.floor(imageData.width * 0.25);
    const endX = Math.floor(imageData.width * 0.75);
    const startY = Math.floor(imageData.height * 0.25);
    const endY = Math.floor(imageData.height * 0.75);
    
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * imageData.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Filtro para piel/dedo (rojo dominante)
        if (r > 60 && r > g * 1.1 && r > b * 1.2) {
          redSum += r;
          greenSum += g;
          blueSum += b;
          skinPixels++;
        }
      }
    }
    
    // Si no hay suficientes píxeles de piel, usar todos
    if (skinPixels < 50) {
      redSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        redSum += data[i];
      }
      skinPixels = pixelCount;
    }
    
    const avgRed = redSum / skinPixels;
    const fingerDetected = skinPixels > 100 && avgRed > 100;
    
    // Agregar al buffer
    redValuesRef.current.push(avgRed);
    if (redValuesRef.current.length > BUFFER_SIZE) {
      redValuesRef.current.shift();
    }
    
    // Calcular baseline (promedio móvil)
    const buffer = redValuesRef.current;
    if (buffer.length >= 30) {
      const recent = buffer.slice(-30);
      baselineRef.current = recent.reduce((a, b) => a + b, 0) / recent.length;
    }
    
    // Señal normalizada (desviación del baseline)
    const signalValue = avgRed - baselineRef.current;
    
    // Calcular calidad de señal
    let quality = 0;
    if (buffer.length >= 30) {
      const recent = buffer.slice(-30);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      const range = max - min;
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      
      // Calidad basada en: rango de señal, nivel de rojo, variabilidad
      if (mean > 0 && fingerDetected) {
        const pulsatility = range / mean; // Índice de perfusión aproximado
        quality = Math.min(100, Math.max(0, pulsatility * 500));
      }
    }
    
    // Detección de picos
    const isPeak = detectPeak(buffer, timestamp);
    
    // Calcular BPM
    const intervals = peakTimesRef.current;
    let bpm = bpmRef.current;
    
    if (intervals.length >= 3) {
      // Calcular BPM de los últimos intervalos
      const recentIntervals: number[] = [];
      for (let i = intervals.length - 1; i > 0 && recentIntervals.length < 5; i--) {
        const interval = intervals[i] - intervals[i - 1];
        if (interval >= MIN_PEAK_DISTANCE_MS && interval <= MAX_PEAK_DISTANCE_MS) {
          recentIntervals.push(interval);
        }
      }
      
      if (recentIntervals.length >= 2) {
        const avgInterval = recentIntervals.reduce((a, b) => a + b, 0) / recentIntervals.length;
        const newBpm = 60000 / avgInterval;
        
        // Suavizado
        if (bpm === 0) {
          bpm = newBpm;
        } else {
          bpm = bpm * 0.7 + newBpm * 0.3;
        }
        
        bpmRef.current = bpm;
      }
    }
    
    // Calcular intervalos RR para arritmias
    const rrIntervals: number[] = [];
    for (let i = intervals.length - 1; i > 0 && rrIntervals.length < 10; i--) {
      const interval = intervals[i] - intervals[i - 1];
      if (interval >= MIN_PEAK_DISTANCE_MS && interval <= MAX_PEAK_DISTANCE_MS) {
        rrIntervals.push(interval);
      }
    }
    
    return {
      redValue: avgRed,
      signalValue,
      quality,
      fingerDetected,
      bpm: Math.round(bpm),
      isPeak,
      rrIntervals
    };
  }, []);
  
  // Detección de picos mejorada
  const detectPeak = useCallback((buffer: number[], timestamp: number): boolean => {
    if (buffer.length < 15) return false;
    
    const timeSinceLastPeak = timestamp - lastPeakTimeRef.current;
    if (timeSinceLastPeak < MIN_PEAK_DISTANCE_MS) return false;
    
    // Obtener últimos valores
    const recent = buffer.slice(-15);
    const current = recent[recent.length - 4]; // Valor hace 4 frames (para confirmar pico)
    
    // Verificar que es un máximo local
    const before = recent.slice(0, -4);
    const after = recent.slice(-3);
    
    const maxBefore = Math.max(...before);
    const maxAfter = Math.max(...after);
    
    // Es pico si el valor central es mayor que los anteriores y los siguientes están bajando
    if (current >= maxBefore && current > maxAfter) {
      // Verificar amplitud mínima
      const min = Math.min(...recent);
      const amplitude = current - min;
      const threshold = baselineRef.current * 0.005; // 0.5% del baseline
      
      if (amplitude > threshold && amplitude > 0.5) {
        lastPeakTimeRef.current = timestamp;
        peakTimesRef.current.push(timestamp);
        
        // Mantener solo últimos 20 picos
        if (peakTimesRef.current.length > 20) {
          peakTimesRef.current.shift();
        }
        
        return true;
      }
    }
    
    return false;
  }, []);
  
  // Control de activación
  useEffect(() => {
    activeRef.current = isActive;
    
    if (isActive) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      activeRef.current = false;
      stopCamera();
    };
  }, [isActive, startCamera, stopCamera]);
  
  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          opacity: 0.001,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{ display: 'none' }}
      />
    </>
  );
};

export default PPGMonitor;
