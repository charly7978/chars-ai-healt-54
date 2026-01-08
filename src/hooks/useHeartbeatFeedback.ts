import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook para feedback háptico y sonoro de latidos
 * - Vibración corta en cada latido detectado
 * - Sonido de beep suave
 */
export const useHeartbeatFeedback = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastBeepTimeRef = useRef(0);
  const MIN_BEEP_INTERVAL = 250; // Mínimo 250ms entre beeps (max 240 BPM)
  
  // Inicializar AudioContext al primer uso
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.log('AudioContext no disponible');
      }
    }
    return audioContextRef.current;
  }, []);
  
  // Reproducir beep
  const playBeep = useCallback(() => {
    const now = Date.now();
    if (now - lastBeepTimeRef.current < MIN_BEEP_INTERVAL) return;
    lastBeepTimeRef.current = now;
    
    const ctx = getAudioContext();
    if (!ctx) return;
    
    try {
      // Reanudar si está suspendido
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      
      // Crear oscilador para beep
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      // Frecuencia agradable (similar a monitor cardíaco)
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
      oscillator.type = 'sine';
      
      // Volumen suave con fade out
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      
      // Duración corta
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.08);
      
    } catch (e) {
      // Silenciar errores de audio
    }
  }, [getAudioContext]);
  
  // Vibración
  const vibrate = useCallback(() => {
    if (navigator.vibrate) {
      navigator.vibrate(30); // Vibración corta de 30ms
    }
  }, []);
  
  // Feedback combinado
  const triggerHeartbeatFeedback = useCallback(() => {
    playBeep();
    vibrate();
  }, [playBeep, vibrate]);
  
  // Cleanup
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, []);
  
  return {
    triggerHeartbeatFeedback,
    playBeep,
    vibrate
  };
};