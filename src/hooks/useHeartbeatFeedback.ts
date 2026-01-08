import { useRef, useCallback, useEffect } from 'react';

/**
 * Hook para feedback háptico y sonoro de latidos
 * - Vibración en cada latido detectado
 * - Sonido de beep suave tipo monitor cardíaco
 */
export const useHeartbeatFeedback = () => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastFeedbackTimeRef = useRef(0);
  const feedbackCountRef = useRef(0);
  const MIN_FEEDBACK_INTERVAL = 280; // Mínimo 280ms entre feedbacks (max ~214 BPM)
  
  // Inicializar AudioContext (requiere interacción de usuario primero)
  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          audioContextRef.current = new AudioCtx();
          console.log('🔊 AudioContext inicializado');
        }
      } catch (e) {
        console.log('⚠️ AudioContext no disponible:', e);
      }
    }
    return audioContextRef.current;
  }, []);
  
  // Reproducir beep
  const playBeep = useCallback(() => {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    try {
      // Reanudar si está suspendido (política de autoplay)
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          console.log('🔊 AudioContext resumido');
        });
      }
      
      // Crear oscilador para beep
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      // Frecuencia similar a monitor cardíaco hospitalario
      oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5
      oscillator.type = 'sine';
      
      // Volumen y fade out
      gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      
      // Duración corta
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.1);
      
    } catch (e) {
      // Silenciar errores de audio
    }
  }, [initAudioContext]);
  
  // Vibración
  const vibrate = useCallback(() => {
    if ('vibrate' in navigator) {
      try {
        const result = navigator.vibrate(40); // Vibración de 40ms
        if (!result) {
          console.log('⚠️ Vibración no soportada o deshabilitada');
        }
      } catch (e) {
        console.log('⚠️ Error vibración:', e);
      }
    } else {
      console.log('⚠️ API de vibración no disponible');
    }
  }, []);
  
  // Feedback combinado con rate limiting
  const triggerHeartbeatFeedback = useCallback(() => {
    const now = Date.now();
    if (now - lastFeedbackTimeRef.current < MIN_FEEDBACK_INTERVAL) {
      return; // Evitar spam
    }
    lastFeedbackTimeRef.current = now;
    feedbackCountRef.current++;
    
    // Log cada 10 latidos
    if (feedbackCountRef.current % 10 === 1) {
      console.log(`💓 Feedback #${feedbackCountRef.current} - beep + vibración`);
    }
    
    playBeep();
    vibrate();
  }, [playBeep, vibrate]);
  
  // Pre-inicializar AudioContext en el primer touch/click
  useEffect(() => {
    const handleUserInteraction = () => {
      initAudioContext();
      // Solo necesitamos hacerlo una vez
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('click', handleUserInteraction);
    };
    
    document.addEventListener('touchstart', handleUserInteraction, { once: true });
    document.addEventListener('click', handleUserInteraction, { once: true });
    
    return () => {
      document.removeEventListener('touchstart', handleUserInteraction);
      document.removeEventListener('click', handleUserInteraction);
      
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [initAudioContext]);
  
  return {
    triggerHeartbeatFeedback,
    playBeep,
    vibrate
  };
};