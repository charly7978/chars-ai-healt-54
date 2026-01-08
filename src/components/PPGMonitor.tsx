import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR v4 - CALIBRACIÓN DINÁMICA CONTINUA
 * 
 * El sistema ajusta CONSTANTEMENTE:
 * - Flash: encender si imagen oscura, apagar si saturada
 * - Exposición: reducir si saturada, aumentar si oscura
 * - Todo en tiempo real, cada frame
 */

interface PPGData {
  redValue: number;
  greenValue: number;
  blueValue: number;
  signalValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  bpm: number;
  isPeak: boolean;
  rrIntervals: number[];
  timestamp: number;
}

interface PPGMonitorProps {
  isActive: boolean;
  onData: (data: PPGData) => void;
  onCameraReady?: () => void;
  onError?: (error: string) => void;
  onStreamReady?: (stream: MediaStream | null) => void;
}

// ============ FILTRO SUAVIZADO SIMPLE ============
class SmoothingFilter {
  private buffer: number[] = [];
  private readonly SIZE = 15;
  
  filter(value: number): number {
    this.buffer.push(value);
    if (this.buffer.length > this.SIZE) {
      this.buffer.shift();
    }
    
    if (this.buffer.length < 3) return 0;
    
    const avg = this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
    return value - avg; // Componente AC
  }
  
  reset(): void {
    this.buffer = [];
  }
}

// ============ DETECTOR DE PICOS ============
class PeakDetector {
  private signalBuffer: number[] = [];
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  
  private readonly BUFFER_SIZE = 180;
  private readonly MIN_INTERVAL = 350;
  private readonly MAX_INTERVAL = 1500;
  
  process(value: number, timestamp: number): { isPeak: boolean; bpm: number } {
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    if (this.signalBuffer.length < 60) {
      return { isPeak: false, bpm: 0 };
    }
    
    const recent = this.signalBuffer.slice(-90);
    const sorted = [...recent].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    
    const threshold = min + range * 0.55;
    
    let isPeak = false;
    const timeSinceLastPeak = timestamp - this.lastPeakTime;
    
    if (timeSinceLastPeak > this.MIN_INTERVAL && this.signalBuffer.length >= 7) {
      const window = this.signalBuffer.slice(-7);
      const center = window[3];
      
      const isMax = center > window[0] && center > window[1] && center > window[2] &&
                    center >= window[4] && center >= window[5] && center >= window[6];
      
      const aboveThreshold = center > threshold;
      const prominence = center - Math.min(window[0], window[6]);
      const hasProminence = prominence > range * 0.15;
      
      if (isMax && aboveThreshold && hasProminence && range > 0.2) {
        isPeak = true;
        this.lastPeakTime = timestamp;
        this.peakTimes.push(timestamp);
        
        if (this.peakTimes.length > 30) {
          this.peakTimes.shift();
        }
        
        console.log(`💓 PICO: val=${center.toFixed(2)} thresh=${threshold.toFixed(2)} prom=${prominence.toFixed(2)}`);
      }
    }
    
    let bpm = 0;
    if (this.peakTimes.length >= 4) {
      const intervals: number[] = [];
      for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 8; i--) {
        const interval = this.peakTimes[i] - this.peakTimes[i - 1];
        if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
          intervals.push(interval);
        }
      }
      
      if (intervals.length >= 3) {
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        bpm = 60000 / median;
      }
    }
    
    return { isPeak, bpm };
  }
  
  getSignalRange(): number {
    if (this.signalBuffer.length < 30) return 0;
    const sorted = [...this.signalBuffer].sort((a, b) => a - b);
    return sorted[sorted.length - 1] - sorted[0];
  }
  
  getRRIntervals(): number[] {
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 10; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
        intervals.push(interval);
      }
    }
    return intervals;
  }
  
  getCV(): number {
    const intervals = this.getRRIntervals();
    if (intervals.length < 3) return 1;
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    return Math.sqrt(variance) / mean;
  }
  
  reset(): void {
    this.signalBuffer = [];
    this.peakTimes = [];
    this.lastPeakTime = 0;
  }
}

// ============ COMPONENTE PRINCIPAL ============
const PPGMonitor: React.FC<PPGMonitorProps> = ({ 
  isActive, 
  onData, 
  onCameraReady,
  onError,
  onStreamReady
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const mountedRef = useRef(true);
  
  const filterRef = useRef<SmoothingFilter | null>(null);
  const detectorRef = useRef<PeakDetector | null>(null);
  
  const bpmSmoothedRef = useRef(0);
  const qualitySmoothedRef = useRef(0);
  const frameCountRef = useRef(0);
  
  // Estado de cámara
  const cameraStateRef = useRef({
    flashOn: false,
    flashCapable: false,
    exposureCapable: false,
    minExposure: 0,
    maxExposure: 0,
    currentExposure: 0,
    lastAdjustTime: 0,
  });
  
  // Callbacks refs
  const onDataRef = useRef(onData);
  const onCameraReadyRef = useRef(onCameraReady);
  const onErrorRef = useRef(onError);
  const onStreamReadyRef = useRef(onStreamReady);
  
  useEffect(() => {
    onDataRef.current = onData;
    onCameraReadyRef.current = onCameraReady;
    onErrorRef.current = onError;
    onStreamReadyRef.current = onStreamReady;
  }, [onData, onCameraReady, onError, onStreamReady]);
  
  useEffect(() => {
    mountedRef.current = true;
    
    const cleanup = async () => {
      if (!isRunningRef.current && !streamRef.current) return;
      
      console.log('🧹 Cleanup PPGMonitor');
      isRunningRef.current = false;
      
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        for (const track of tracks) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch && cameraStateRef.current.flashOn) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
        onStreamReadyRef.current?.(null);
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      filterRef.current = null;
      detectorRef.current = null;
      bpmSmoothedRef.current = 0;
      qualitySmoothedRef.current = 0;
      frameCountRef.current = 0;
      cameraStateRef.current = {
        flashOn: false,
        flashCapable: false,
        exposureCapable: false,
        minExposure: 0,
        maxExposure: 0,
        currentExposure: 0,
        lastAdjustTime: 0,
      };
    };
    
    // ===== CALIBRACIÓN DINÁMICA =====
    const adjustCamera = async (avgBrightness: number) => {
      const state = cameraStateRef.current;
      const now = Date.now();
      
      // No ajustar más de 1 vez por segundo
      if (now - state.lastAdjustTime < 1000) return;
      
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      
      // IMAGEN MUY OSCURA (< 60): necesitamos más luz
      if (avgBrightness < 60) {
        // Primero intentar encender flash
        if (state.flashCapable && !state.flashOn) {
          try {
            await track.applyConstraints({ advanced: [{ torch: true } as any] });
            state.flashOn = true;
            state.lastAdjustTime = now;
            console.log('🔦 Flash ENCENDIDO (imagen oscura)');
            return;
          } catch {}
        }
        
        // Si no hay flash o ya está encendido, subir exposición
        if (state.exposureCapable && state.currentExposure < state.maxExposure) {
          const newExp = Math.min(state.maxExposure, state.currentExposure + 0.5);
          try {
            await track.applyConstraints({ 
              advanced: [{ exposureCompensation: newExp } as any] 
            });
            state.currentExposure = newExp;
            state.lastAdjustTime = now;
            console.log(`📷 Exposición aumentada: ${newExp.toFixed(1)}`);
          } catch {}
        }
      }
      
      // IMAGEN SATURADA (> 240): necesitamos menos luz
      else if (avgBrightness > 240) {
        // Primero intentar reducir exposición
        if (state.exposureCapable && state.currentExposure > state.minExposure) {
          const newExp = Math.max(state.minExposure, state.currentExposure - 0.5);
          try {
            await track.applyConstraints({ 
              advanced: [{ exposureCompensation: newExp } as any] 
            });
            state.currentExposure = newExp;
            state.lastAdjustTime = now;
            console.log(`📷 Exposición reducida: ${newExp.toFixed(1)}`);
            return;
          } catch {}
        }
        
        // Si exposición al mínimo y aún saturado, apagar flash
        if (state.flashOn) {
          try {
            await track.applyConstraints({ advanced: [{ torch: false } as any] });
            state.flashOn = false;
            state.lastAdjustTime = now;
            console.log('🔦 Flash APAGADO (saturación)');
          } catch {}
        }
      }
      
      // RANGO ÓPTIMO (80-200): estamos bien, asegurar flash encendido para PPG
      else if (avgBrightness >= 80 && avgBrightness <= 200) {
        if (state.flashCapable && !state.flashOn) {
          try {
            await track.applyConstraints({ advanced: [{ torch: true } as any] });
            state.flashOn = true;
            state.lastAdjustTime = now;
            console.log('🔦 Flash ENCENDIDO (rango óptimo)');
          } catch {}
        }
      }
    };
    
    const processFrame = () => {
      if (!isRunningRef.current || !mountedRef.current) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      frameCountRef.current++;
      
      // Capturar frame
      ctx.drawImage(video, 0, 0, 64, 64);
      const imageData = ctx.getImageData(0, 0, 64, 64);
      const data = imageData.data;
      
      // ===== EXTRAER VALORES RGB =====
      let redSum = 0, greenSum = 0, blueSum = 0;
      let totalPixels = 0;
      
      // Zona central
      for (let y = 16; y < 48; y++) {
        for (let x = 16; x < 48; x++) {
          const i = (y * 64 + x) * 4;
          redSum += data[i];
          greenSum += data[i + 1];
          blueSum += data[i + 2];
          totalPixels++;
        }
      }
      
      const avgRed = redSum / totalPixels;
      const avgGreen = greenSum / totalPixels;
      const avgBlue = blueSum / totalPixels;
      const avgBrightness = (avgRed + avgGreen + avgBlue) / 3;
      
      // ===== CALIBRACIÓN DINÁMICA CONTINUA =====
      // Cada 10 frames (~333ms) verificar si necesitamos ajustar
      if (frameCountRef.current % 10 === 0) {
        adjustCamera(avgBrightness);
      }
      
      // ===== DETECCIÓN DE DEDO =====
      // Dedo cubriendo cámara con flash = predominancia roja clara
      const fingerDetected = avgRed > 80 && 
                            avgRed > avgGreen * 1.05 && 
                            avgGreen > avgBlue * 0.9 &&
                            avgBrightness > 50 && 
                            avgBrightness < 250;
      
      // ===== SEÑAL PPG =====
      // Usar combinación de canales: rojo es más afectado por sangre
      const rawSignal = avgRed * 0.6 + avgGreen * 0.4;
      const filteredValue = filterRef.current?.filter(rawSignal) ?? 0;
      
      // ===== DETECCIÓN DE PICOS =====
      const timestamp = Date.now();
      const { isPeak, bpm } = detectorRef.current?.process(filteredValue, timestamp) 
        ?? { isPeak: false, bpm: 0 };
      
      if (bpm > 0) {
        bpmSmoothedRef.current = bpmSmoothedRef.current === 0 
          ? bpm 
          : bpmSmoothedRef.current * 0.85 + bpm * 0.15;
      }
      
      // ===== CALIDAD DE SEÑAL =====
      let quality = 0;
      if (fingerDetected && detectorRef.current) {
        const range = detectorRef.current.getSignalRange();
        const cv = detectorRef.current.getCV();
        const intervals = detectorRef.current.getRRIntervals();
        
        // Rango de señal: 0-50 puntos
        const rangeScore = Math.min(50, (range / 2) * 50);
        
        // Estabilidad: 0-35 puntos
        const stabilityScore = intervals.length >= 3 
          ? Math.max(0, 35 * (1 - Math.min(1, cv / 0.3)))
          : 0;
        
        // Cobertura: 0-15 puntos
        const coverageScore = Math.min(15, intervals.length * 3);
        
        quality = rangeScore + stabilityScore + coverageScore;
        qualitySmoothedRef.current = qualitySmoothedRef.current * 0.9 + quality * 0.1;
        quality = qualitySmoothedRef.current;
      }
      
      // Log cada 2 segundos
      if (frameCountRef.current % 60 === 0) {
        const range = detectorRef.current?.getSignalRange() ?? 0;
        const cv = detectorRef.current?.getCV() ?? 0;
        const state = cameraStateRef.current;
        console.log(`📊 Brillo=${avgBrightness.toFixed(0)} R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} Flash=${state.flashOn ? 'ON' : 'OFF'} range=${range.toFixed(2)} Q=${quality.toFixed(0)}%`);
      }
      
      // Enviar datos
      onDataRef.current({
        redValue: avgRed,
        greenValue: avgGreen,
        blueValue: avgBlue,
        signalValue: rawSignal,
        filteredValue,
        quality: Math.round(quality),
        fingerDetected,
        bpm: Math.round(bpmSmoothedRef.current),
        isPeak,
        rrIntervals: detectorRef.current?.getRRIntervals() ?? [],
        timestamp
      });
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    const startCamera = async () => {
      if (!mountedRef.current) return;
      
      console.log('🎥 Iniciando cámara...');
      isRunningRef.current = true;
      
      filterRef.current = new SmoothingFilter();
      detectorRef.current = new PeakDetector();
      
      if (canvasRef.current) {
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }
      
      try {
        let stream: MediaStream | null = null;
        
        const constraints = [
          { audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } },
          { audio: false, video: { facingMode: 'environment' } },
          { audio: false, video: true }
        ];
        
        for (const c of constraints) {
          if (!mountedRef.current || !isRunningRef.current) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia(c);
            console.log('✅ Stream obtenido');
            break;
          } catch (e) {
            console.log('⚠️ Constraint falló:', (e as Error).message);
          }
        }
        
        if (!stream) throw new Error('No se pudo acceder a la cámara');
        if (!mountedRef.current || !isRunningRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        onStreamReadyRef.current?.(stream);
        
        // Detectar capacidades de la cámara
        const track = stream.getVideoTracks()[0];
        const state = cameraStateRef.current;
        
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            
            // Flash
            if (caps?.torch) {
              state.flashCapable = true;
              // Encender flash inicialmente
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              state.flashOn = true;
              console.log('🔦 Flash disponible y ENCENDIDO');
            } else {
              console.log('⚠️ Flash NO disponible');
            }
            
            // Exposición
            if (caps?.exposureCompensation) {
              state.exposureCapable = true;
              state.minExposure = caps.exposureCompensation.min;
              state.maxExposure = caps.exposureCompensation.max;
              // Empezar en exposición media
              const midExp = (state.minExposure + state.maxExposure) / 2;
              await track.applyConstraints({ 
                advanced: [{ exposureCompensation: midExp } as any] 
              });
              state.currentExposure = midExp;
              console.log(`📷 Exposición: min=${state.minExposure} max=${state.maxExposure} actual=${midExp}`);
            }
          } catch (e) {
            console.log('⚠️ Error detectando capacidades:', (e as Error).message);
          }
        }
        
        // Conectar video
        const video = videoRef.current;
        if (!video) throw new Error('Video element no disponible');
        
        video.srcObject = stream;
        
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (video.videoWidth > 0) resolve();
            else reject(new Error('Video timeout'));
          }, 3000);
          
          video.oncanplay = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
        
        await video.play();
        console.log('▶️ Video:', video.videoWidth, 'x', video.videoHeight);
        
        if (!mountedRef.current || !isRunningRef.current) {
          await cleanup();
          return;
        }
        
        console.log('📷 Cámara lista - calibración dinámica activa');
        onCameraReadyRef.current?.();
        animationRef.current = requestAnimationFrame(processFrame);
        
      } catch (error: any) {
        console.error('❌ Error cámara:', error.message);
        onErrorRef.current?.(error.message);
        await cleanup();
      }
    };
    
    if (isActive) {
      startCamera();
    } else {
      cleanup();
    }
    
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [isActive]);
  
  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: 'fixed',
          top: -1,
          left: -1,
          width: 1,
          height: 1,
          opacity: 0,
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
