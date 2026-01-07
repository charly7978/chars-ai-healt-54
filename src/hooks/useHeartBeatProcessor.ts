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
 * HOOK DE PROCESAMIENTO CARDÍACO CON AUDIO
 * Detecta latidos reales y reproduce sonido
 */
export const useHeartBeatProcessor = () => {
  const processorRef = useRef<HeartBeatProcessor | null>(null);
  const [currentBPM, setCurrentBPM] = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [signalQuality, setSignalQuality] = useState<number>(0);
  
  // Audio para latidos
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastBeepTimeRef = useRef<number>(0);
  const MIN_BEEP_INTERVAL = 250; // Mínimo 250ms entre beeps
  
  // Control de estado
  const sessionIdRef = useRef<string>("");
  const processingStateRef = useRef<'IDLE' | 'ACTIVE' | 'RESETTING'>('IDLE');
  const lastProcessTimeRef = useRef<number>(0);
  const processedSignalsRef = useRef<number>(0);
  const lastBPMRef = useRef<number>(0);
  
  // Buffer para cálculo de calidad
  const signalBufferRef = useRef<number[]>([]);

  // Inicialización única
  useEffect(() => {
    const t = Date.now().toString(36);
    const p = (performance.now() | 0).toString(36);
    sessionIdRef.current = `heartbeat_${t}_${p}`;

    console.log(`💓 CREANDO PROCESADOR CARDÍACO CON AUDIO - ${sessionIdRef.current}`);
    
    processorRef.current = new HeartBeatProcessor();
    processingStateRef.current = 'ACTIVE';
    
    // Crear AudioContext para sonidos de latido
    try {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.warn("AudioContext no disponible:", e);
    }
    
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      processorRef.current = null;
      processingStateRef.current = 'IDLE';
    };
  }, []);

  /**
   * Reproduce un sonido de latido
   */
  const playHeartbeatSound = useCallback(() => {
    const now = Date.now();
    
    // Evitar beeps muy seguidos
    if (now - lastBeepTimeRef.current < MIN_BEEP_INTERVAL) {
      return;
    }
    
    lastBeepTimeRef.current = now;
    
    if (!audioContextRef.current) return;
    
    try {
      const ctx = audioContextRef.current;
      
      // Reanudar contexto si está suspendido
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      
      // Crear oscilador para el sonido
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      // Sonido tipo "lub-dub" de corazón
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(80, ctx.currentTime); // Tono grave
      oscillator.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.1);
      
      // Envolvente de volumen
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.15);
      
    } catch (e) {
      // Silenciar errores de audio
    }
  }, []);

  // Calcular calidad de señal
  const calculateQuality = useCallback((value: number): number => {
    signalBufferRef.current.push(value);
    if (signalBufferRef.current.length > 30) {
      signalBufferRef.current.shift();
    }
    
    if (signalBufferRef.current.length < 10) return 0;
    
    const buffer = signalBufferRef.current;
    const mean = buffer.reduce((a, b) => a + b, 0) / buffer.length;
    const variance = buffer.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / buffer.length;
    const amplitude = Math.max(...buffer) - Math.min(...buffer);
    
    // Verificar que hay señal viva
    if (variance < 0.5 || amplitude < 1) return 0;
    
    // SNR aproximado
    const snr = amplitude > 0 ? 10 * Math.log10(amplitude / Math.sqrt(variance + 0.001)) : 0;
    return Math.max(0, Math.min(100, snr * 10));
  }, []);

  // Procesamiento de señal
  const processSignal = useCallback((value: number, fingerDetected: boolean = true, timestamp?: number): HeartBeatResult => {
    const currentTime = timestamp || Date.now();
    
    if (!processorRef.current || processingStateRef.current !== 'ACTIVE') {
      return {
        bpm: currentBPM,
        confidence: 0,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality: 0,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    // Control de tasa de procesamiento (60 FPS máx)
    if (currentTime - lastProcessTimeRef.current < 16) {
      return {
        bpm: currentBPM,
        confidence,
        isPeak: false,
        arrhythmiaCount: 0,
        signalQuality,
        rrData: { intervals: [], lastPeakTime: null }
      };
    }
    
    lastProcessTimeRef.current = currentTime;
    processedSignalsRef.current++;

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

    // Calcular calidad de la señal
    const quality = calculateQuality(value);
    setSignalQuality(quality);
    
    // Procesar señal para obtener BPM
    const prevBPM = lastBPMRef.current;
    const bpm = processorRef.current.processSignal(value, currentTime);
    const rrIntervals = processorRef.current.getRRIntervals();
    const lastPeakTime = processorRef.current.getLastPeakTime();
    
    // Detectar si hubo un nuevo pico (BPM cambió y es válido)
    const isPeak = bpm > 0 && bpm !== prevBPM && quality > 30;
    
    if (isPeak) {
      // ¡REPRODUCIR SONIDO DE LATIDO!
      playHeartbeatSound();
    }
    
    lastBPMRef.current = bpm;
    
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
  }, [currentBPM, confidence, signalQuality, calculateQuality, playHeartbeatSound]);

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
    lastProcessTimeRef.current = 0;
    processedSignalsRef.current = 0;
    lastBPMRef.current = 0;
    
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
    playHeartbeatSound, // Exponer para uso externo si necesario
    debugInfo: {
      sessionId: sessionIdRef.current,
      processingState: processingStateRef.current,
      processedSignals: processedSignalsRef.current
    }
  };
};
