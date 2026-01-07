import { useState, useEffect, useCallback, useRef } from 'react';
import { HeartBeatProcessor } from '../modules/HeartBeatProcessor';

interface HeartBeatResult {
  bpm: number;
  confidence: number;
  isPeak: boolean;
  arrhythmiaCount: number;
  signalQuality: number;
  rrData?: {
    intervals: number[];
    lastPeakTime: number | null;
  };
}

/**
 * HOOK DE PROCESAMIENTO CARDÍACO CON AUDIO REAL
 * Detecta latidos reales y reproduce sonido en cada pico
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  
  // Audio para latidos
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastBeepTimeRef = useRef<number>(0);
  const MIN_BEEP_INTERVAL = 280; // Mínimo 280ms entre beeps (max ~214 BPM)
  
  // Control de estado
  const sessionIdRef = useRef<string>("");
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  
  // Detección de picos real
  const signalBufferRef = useRef<number[]>([]);
  const lastPeakTimeRef = useRef<number>(0);
  const REFRACTORY_PERIOD = 300; // 300ms después de un pico, no detectar otro

  // Inicialización única
  useEffect(() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `heartbeat_${t}_${p}`;

    console.log(`💓 HeartBeatProcessor con AUDIO - ${sessionIdRef.current}`);
    
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';
    
    // Crear AudioContext para sonidos de latido
    const initAudio = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
      } catch (e) {
        console.warn("AudioContext no disponible:", e);
      }
    };
    
    // Inicializar audio en primer click/touch
    const handleInteraction = () => {
      initAudio();
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
    };
    
    document.addEventListener('click', handleInteraction, { once: true });
    document.addEventListener('touchstart', handleInteraction, { once: true });
    
    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('touchstart', handleInteraction);
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      processorRef.current = null;
      processingStateRef.current = 'IDLE';
    };
  }, []);

  /**
   * Reproduce un sonido de latido "lub-dub"
   */
  const playHeartbeatSound = useCallback(() => {
    const now = Date.now();
    
    // Evitar beeps muy seguidos
    if (now - lastBeepTimeRef.current < MIN_BEEP_INTERVAL) {
      return;
    }
    
    lastBeepTimeRef.current = now;
    
    if (!audioContextRef.current) {
      // Intentar crear contexto
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return;
      }
    }
    
    try {
      const ctx = audioContextRef.current;
      
      // Reanudar contexto si está suspendido
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      
      // ===== SONIDO "LUB" (primer sonido del latido) =====
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(65, ctx.currentTime);
      osc1.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.08);
      
      gain1.gain.setValueAtTime(0, ctx.currentTime);
      gain1.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.015);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.12);
      
      // ===== SONIDO "DUB" (segundo sonido, más suave) =====
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(50, ctx.currentTime + 0.12);
      osc2.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.18);
      
      gain2.gain.setValueAtTime(0, ctx.currentTime + 0.12);
      gain2.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.13);
      gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      
      osc2.start(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.22);
      
      console.log("💗 BEEP - Latido detectado");
      
    } catch (e) {
      // Silenciar errores de audio
    }
  }, []);

  /**
   * Detecta si hay un pico real en la señal
   */
  const detectRealPeak = useCallback((value: number, timestamp: number): boolean => {
    signalBufferRef.current.push(value);
    if (signalBufferRef.current.length > 20) {
      signalBufferRef.current.shift();
    }
    
    // Necesitamos al menos 5 muestras
    if (signalBufferRef.current.length < 5) return false;
    
    // Período refractario
    if (timestamp - lastPeakTimeRef.current < REFRACTORY_PERIOD) {
      return false;
    }
    
    const buffer = signalBufferRef.current;
    const len = buffer.length;
    
    // Calcular umbral adaptativo
    const mean = buffer.reduce((a, b) => a + b, 0) / len;
    const max = Math.max(...buffer);
    const min = Math.min(...buffer);
    const amplitude = max - min;
    
    // Si no hay amplitud, no hay señal
    if (amplitude < 0.5) return false;
    
    const threshold = mean + amplitude * 0.35;
    
    // Verificar pico: valor anterior era máximo local
    const current = buffer[len - 1];
    const prev1 = buffer[len - 2];
    const prev2 = buffer[len - 3] || prev1;
    
    // El punto anterior debe ser mayor que sus vecinos (pico)
    const isPeak = prev1 > prev2 && 
                   prev1 > current && 
                   prev1 > threshold;
    
    if (isPeak) {
      lastPeakTimeRef.current = timestamp;
      return true;
    }
    
    return false;
  }, []);

  // Procesamiento de señal
  const processSignal = useCallback((value: number, fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    const currentTime = timestamp || Date.now();
    
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    // Sin dedo = sin procesamiento
    if (!fingerDetected || value === 0) {
      setCurrentBPM(0);
      setConfidence(0);
      setSignalQuality(0);
      signalBufferRef.current = [];
      return {
        bpm: 0,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }

    // Procesar señal para obtener BPM
    const bpm = processorRef.current.processSignal(value, currentTime);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    
    // Detectar pico REAL en la señal
    const isPeak = detectRealPeak(value, currentTime);
    
    if (isPeak && bpm > 0) {
      // ¡REPRODUCIR SONIDO DE LATIDO!
      playHeartbeatSound();
    }
    
    // Calcular calidad
    const buffer = signalBufferRef.current;
    let quality = 0;
    if (buffer.length >= 10) {
      const mean = buffer.reduce((a, b) => a + b, 0) / buffer.length;
      const variance = buffer.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / buffer.length;
      const amplitude = Math.max(...buffer) - Math.min(...buffer);
      if (variance >= 0.3 && amplitude > 0.5) {
        const snr = 10 * Math.log10(amplitude / Math.sqrt(variance + 0.001));
        quality = Math.max(0, Math.min(100, snr * 12));
      }
    }
    
    setSignalQuality(quality);
    
    // Calcular confianza basada en calidad y estabilidad
    const newConfidence = quality > 40 ? Math.min(1, quality / 80) : quality / 100;
    
    // Actualizar estado
    if (bpm > 0 && bpm >= 40 && bpm <= 200) {
      setCurrentBPM(bpm);
      setConfidence(newConfidence);
    }

    return {
      bpm: currentBPM > 0 ? currentBPM : bpm,
      confidence: newConfidence,
      isPeak,
      arrhythmiaCount: 0,
      signalQuality: quality,
      rrData: { 
        intervals: rrIntervals, 
        lastPeakTime: rrIntervals.length > 0 ? lastPeakTime : null 
      }
    };
  }, [currentBPM, detectRealPeak, playHeartbeatSound]);

  // Reset
  const reset = useCallback(() => {
    if (processingStateRef.current === 'RESETTING') return;
    
    processingStateRef.current = 'RESETTING';
    
    if (processorRef.current) {
      processorRef.current.reset();
    }
    
    setCurrentBPM(0);
    setConfidence(0);
    setSignalQuality(0);
    signalBufferRef.current = [];
    lastPeakTimeRef.current = 0;
    
    processingStateRef.current = 'ACTIVE';
  }, []);

  // Estado de arritmia (para compatibilidad)
  const setArrhythmiaState = useCallback((isArrhythmiaDetected: boolean) => {
    // La arritmia se detecta en VitalSignsProcessor
  }, []);

  return {
    currentBPM,
    confidence,
    signalQuality,
    processSignal,
    reset,
    setArrhythmiaState,
    playHeartbeatSound,
    debugInfo: {
      sessionId: sessionIdRef.current,
      processingState: processingStateRef.current
    }
  };
};
