import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR - SISTEMA UNIFICADO DE CAPTURA Y PROCESAMIENTO
 * 
 * Mejoras v2:
 * - Calidad de señal basada en SNR real + estabilidad RR
 * - Detección de picos más robusta
 * - Mejor detección de dedo
 * - Logs de debug para vibración
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

// ============ FILTRO IIR BUTTERWORTH 0.5-4Hz ============
class ButterworthFilter {
  private b: number[];
  private a: number[];
  private x: number[];
  private y: number[];
  
  constructor() {
    // Coeficientes para filtro pasabanda 0.5-4Hz @ 30Hz, orden 2
    this.b = [0.1311, 0, -0.2622, 0, 0.1311];
    this.a = [1, -2.1192, 1.8298, -0.7821, 0.1584];
    this.x = new Array(this.b.length).fill(0);
    this.y = new Array(this.a.length).fill(0);
  }
  
  filter(sample: number): number {
    this.x.pop();
    this.x.unshift(sample);
    
    let y = 0;
    for (let i = 0; i < this.b.length; i++) {
      y += this.b[i] * this.x[i];
    }
    for (let i = 1; i < this.a.length; i++) {
      y -= this.a[i] * this.y[i - 1];
    }
    
    this.y.pop();
    this.y.unshift(y);
    
    return y;
  }
  
  reset(): void {
    this.x.fill(0);
    this.y.fill(0);
  }
}

// ============ DETECTOR DE PICOS MEJORADO ============
class PeakDetector {
  private buffer: number[] = [];
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  private adaptiveThreshold = 0;
  private signalHistory: number[] = [];
  
  // Configuración optimizada
  private readonly BUFFER_SIZE = 150; // 5 segundos @ 30fps
  private readonly MIN_PEAK_INTERVAL = 333; // Max 180 BPM
  private readonly MAX_PEAK_INTERVAL = 1500; // Min 40 BPM
  private readonly REFRACTORY_PERIOD = 280; // ms después de pico
  
  addSample(value: number, timestamp: number): { isPeak: boolean; bpm: number } {
    this.buffer.push(value);
    if (this.buffer.length > this.BUFFER_SIZE) {
      this.buffer.shift();
    }
    
    // Mantener historial para SNR
    this.signalHistory.push(value);
    if (this.signalHistory.length > 300) {
      this.signalHistory.shift();
    }
    
    // Umbral adaptativo basado en percentiles
    if (this.buffer.length >= 60) { // 2 segundos mínimo
      const sorted = [...this.buffer].sort((a, b) => a - b);
      const p20 = sorted[Math.floor(sorted.length * 0.20)];
      const p80 = sorted[Math.floor(sorted.length * 0.80)];
      const range = p80 - p20;
      
      // Umbral = percentil 60 + pequeño margen
      const p60 = sorted[Math.floor(sorted.length * 0.60)];
      this.adaptiveThreshold = p60 + range * 0.15;
    }
    
    // Detectar pico
    let isPeak = false;
    const timeSinceLastPeak = timestamp - this.lastPeakTime;
    
    if (timeSinceLastPeak > this.REFRACTORY_PERIOD && this.buffer.length >= 9) {
      const window = this.buffer.slice(-9);
      const center = window[4]; // Punto central (índice 4)
      
      // Verificar máximo local estricto
      let isLocalMax = true;
      for (let i = 0; i < window.length; i++) {
        if (i !== 4 && window[i] >= center) {
          isLocalMax = false;
          break;
        }
      }
      
      // Verificar umbral
      const aboveThreshold = center > this.adaptiveThreshold;
      
      // Verificar prominencia: debe ser significativamente mayor que el mínimo cercano
      const localMin = Math.min(...window);
      const prominence = center - localMin;
      const avgRange = this.getSignalRange();
      const hasProminence = prominence > avgRange * 0.15; // 15% del rango
      
      if (isLocalMax && aboveThreshold && hasProminence) {
        isPeak = true;
        this.lastPeakTime = timestamp;
        this.peakTimes.push(timestamp);
        
        // Mantener últimos 30 picos
        if (this.peakTimes.length > 30) {
          this.peakTimes.shift();
        }
        
        console.log(`💓 PICO detectado: val=${center.toFixed(2)} thresh=${this.adaptiveThreshold.toFixed(2)} prom=${prominence.toFixed(2)}`);
      }
    }
    
    // Calcular BPM con mediana de intervalos válidos
    let bpm = 0;
    if (this.peakTimes.length >= 4) {
      const intervals: number[] = [];
      
      for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 8; i--) {
        const interval = this.peakTimes[i] - this.peakTimes[i - 1];
        if (interval >= this.MIN_PEAK_INTERVAL && interval <= this.MAX_PEAK_INTERVAL) {
          intervals.push(interval);
        }
      }
      
      if (intervals.length >= 3) {
        intervals.sort((a, b) => a - b);
        const medianInterval = intervals[Math.floor(intervals.length / 2)];
        bpm = 60000 / medianInterval;
      }
    }
    
    return { isPeak, bpm };
  }
  
  getSignalRange(): number {
    if (this.buffer.length < 30) return 1;
    const sorted = [...this.buffer].sort((a, b) => a - b);
    return sorted[sorted.length - 1] - sorted[0];
  }
  
  // SNR: relación señal-ruido
  getSNR(): number {
    if (this.signalHistory.length < 60) return 0;
    
    const recent = this.signalHistory.slice(-90);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    
    // Calcular varianza total
    const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
    const std = Math.sqrt(variance);
    
    // Calcular amplitud de señal (diferencia entre picos y valles)
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const signalAmplitude = p90 - p10;
    
    // SNR simplificado: amplitud / ruido
    if (std < 0.001) return 0;
    return Math.min(30, signalAmplitude / std); // Max 30 dB
  }
  
  getRRIntervals(): number[] {
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 10; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_PEAK_INTERVAL && interval <= this.MAX_PEAK_INTERVAL) {
        intervals.push(interval);
      }
    }
    return intervals;
  }
  
  // Coeficiente de variación de intervalos RR
  getRRVariability(): number {
    const intervals = this.getRRIntervals();
    if (intervals.length < 3) return 1;
    
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
    return Math.sqrt(variance) / mean;
  }
  
  reset(): void {
    this.buffer = [];
    this.peakTimes = [];
    this.lastPeakTime = 0;
    this.adaptiveThreshold = 0;
    this.signalHistory = [];
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
  const filterRef = useRef<ButterworthFilter | null>(null);
  const peakDetectorRef = useRef<PeakDetector | null>(null);
  const baselineRef = useRef(0);
  const bpmSmoothedRef = useRef(0);
  const frameCountRef = useRef(0);
  const qualitySmoothedRef = useRef(0);
  
  // Refs para callbacks
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
    let mounted = true;
    
    const cleanup = async () => {
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
            if (caps?.torch) {
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
      peakDetectorRef.current = null;
      baselineRef.current = 0;
      bpmSmoothedRef.current = 0;
      frameCountRef.current = 0;
      qualitySmoothedRef.current = 0;
    };
    
    const processFrame = () => {
      if (!isRunningRef.current) return;
      
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
      
      // Capturar frame (resolución pequeña para velocidad)
      ctx.drawImage(video, 0, 0, 64, 64);
      const imageData = ctx.getImageData(0, 0, 64, 64);
      const data = imageData.data;
      
      // ===== DETECCIÓN DE DEDO MEJORADA =====
      // Zona central 60%
      let redSum = 0, greenSum = 0, blueSum = 0;
      let skinPixels = 0;
      let highRedPixels = 0;
      
      const margin = 13; // ~20% de 64
      for (let y = margin; y < 51; y++) {
        for (let x = margin; x < 51; x++) {
          const i = (y * 64 + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          
          // Criterio de piel con flash: Rojo alto, Rojo > Verde > Azul
          if (r > 100 && r > g * 1.1 && g > b * 0.9) {
            redSum += r;
            greenSum += g;
            blueSum += b;
            skinPixels++;
            
            if (r > 180) highRedPixels++;
          }
        }
      }
      
      const totalPixels = 38 * 38; // (51-13)^2
      const skinRatio = skinPixels / totalPixels;
      const highRedRatio = highRedPixels / totalPixels;
      
      let avgRed = 0, avgGreen = 0, avgBlue = 0;
      if (skinPixels >= 200) {
        avgRed = redSum / skinPixels;
        avgGreen = greenSum / skinPixels;
        avgBlue = blueSum / skinPixels;
      } else {
        // Fallback: todos los píxeles
        redSum = greenSum = blueSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          redSum += data[i];
          greenSum += data[i + 1];
          blueSum += data[i + 2];
        }
        const n = data.length / 4;
        avgRed = redSum / n;
        avgGreen = greenSum / n;
        avgBlue = blueSum / n;
      }
      
      // Dedo detectado: suficientes píxeles de piel Y rojo promedio alto
      const fingerDetected = skinRatio > 0.4 && avgRed > 140;
      
      // ===== SEÑAL PPG =====
      if (baselineRef.current === 0) {
        baselineRef.current = avgRed;
      } else {
        // Baseline lento para seguir cambios DC
        baselineRef.current = baselineRef.current * 0.98 + avgRed * 0.02;
      }
      
      const signalValue = avgRed - baselineRef.current;
      const filteredValue = filterRef.current?.filter(signalValue) ?? signalValue;
      
      // ===== DETECCIÓN DE PICOS Y BPM =====
      const timestamp = Date.now();
      const { isPeak, bpm } = peakDetectorRef.current?.addSample(filteredValue, timestamp) 
        ?? { isPeak: false, bpm: 0 };
      
      if (bpm > 0) {
        if (bpmSmoothedRef.current === 0) {
          bpmSmoothedRef.current = bpm;
        } else {
          bpmSmoothedRef.current = bpmSmoothedRef.current * 0.85 + bpm * 0.15;
        }
      }
      
      // ===== CALIDAD DE SEÑAL MEJORADA =====
      let quality = 0;
      if (fingerDetected && peakDetectorRef.current) {
        const snr = peakDetectorRef.current.getSNR();
        const rrCV = peakDetectorRef.current.getRRVariability();
        const intervals = peakDetectorRef.current.getRRIntervals();
        
        // Factor SNR: 0-50 puntos (SNR de 0-15 = 0-50%)
        const snrScore = Math.min(50, (snr / 15) * 50);
        
        // Factor estabilidad RR: 0-40 puntos (CV bajo = más puntos)
        // CV típico saludable: 0.02-0.08
        const rrScore = intervals.length >= 3 
          ? Math.max(0, 40 * (1 - Math.min(1, rrCV / 0.3)))
          : 0;
        
        // Factor cobertura: 0-10 puntos (tener suficientes intervalos)
        const coverageScore = Math.min(10, intervals.length * 2);
        
        quality = snrScore + rrScore + coverageScore;
        
        // Suavizar calidad
        qualitySmoothedRef.current = qualitySmoothedRef.current * 0.9 + quality * 0.1;
        quality = qualitySmoothedRef.current;
      }
      
      // Log cada 2 segundos
      if (frameCountRef.current % 60 === 0) {
        const snr = peakDetectorRef.current?.getSNR() ?? 0;
        const rrCV = peakDetectorRef.current?.getRRVariability() ?? 0;
        console.log(`📊 PPG: R=${avgRed.toFixed(0)} skin=${(skinRatio*100).toFixed(0)}% SNR=${snr.toFixed(1)} CV=${rrCV.toFixed(2)} BPM=${bpmSmoothedRef.current.toFixed(0)} Q=${quality.toFixed(0)}%`);
      }
      
      // Enviar datos
      onDataRef.current({
        redValue: avgRed,
        greenValue: avgGreen,
        blueValue: avgBlue,
        signalValue,
        filteredValue,
        quality: Math.round(quality),
        fingerDetected,
        bpm: Math.round(bpmSmoothedRef.current),
        isPeak,
        rrIntervals: peakDetectorRef.current?.getRRIntervals() ?? [],
        timestamp
      });
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    const startCamera = async () => {
      if (!mounted) return;
      
      console.log('🎥 Iniciando cámara...');
      isRunningRef.current = true;
      
      filterRef.current = new ButterworthFilter();
      peakDetectorRef.current = new PeakDetector();
      
      if (canvasRef.current) {
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }
      
      try {
        let stream: MediaStream | null = null;
        
        const constraints = [
          { audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          { audio: false, video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } } },
          { audio: false, video: true }
        ];
        
        for (const c of constraints) {
          if (!mounted || !isRunningRef.current) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia(c);
            console.log('✅ Stream obtenido');
            break;
          } catch (e) {
            console.log('⚠️ Constraint falló:', (e as Error).message);
          }
        }
        
        if (!stream) throw new Error('No se pudo acceder a la cámara');
        if (!mounted || !isRunningRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        onStreamReadyRef.current?.(stream);
        
        // Encender flash
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              console.log('🔦 Flash ENCENDIDO');
            } else {
              console.log('⚠️ Este dispositivo no tiene flash/torch');
            }
          } catch (e) {
            console.log('⚠️ Error flash:', (e as Error).message);
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
        
        if (!mounted || !isRunningRef.current) {
          await cleanup();
          return;
        }
        
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
      mounted = false;
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