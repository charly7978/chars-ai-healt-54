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
  const vibrationSupportedRef = useRef<boolean | null>(null);
  const MIN_FEEDBACK_INTERVAL = 300;
  
  // Verificar soporte de vibración al montar
  useEffect(() => {
    const checkVibration = () => {
      if ('vibrate' in navigator) {
        try {
          // Test de vibración mínima
          const result = navigator.vibrate(1);
          vibrationSupportedRef.current = result;
          console.log(`📳 Vibración: ${result ? 'SOPORTADA' : 'NO soportada/deshabilitada'}`);
        } catch (e) {
          vibrationSupportedRef.current = false;
          console.log('📳 Vibración: error al probar', e);
        }
      } else {
        vibrationSupportedRef.current = false;
        console.log('📳 API de vibración NO disponible en este navegador');
      }
    };
    
    // Verificar después de un pequeño delay
    setTimeout(checkVibration, 500);
  }, []);
  
  // Inicializar AudioContext
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
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.08);
      
    } catch (e) {
      // Silenciar
    }
  }, [initAudioContext]);
  
  // Vibración
  const vibrate = useCallback(() => {
    // Si ya sabemos que no está soportada, no intentar
    if (vibrationSupportedRef.current === false) {
      return;
    }
    
    try {
      if ('vibrate' in navigator) {
        navigator.vibrate(50);
      }
    } catch (e) {
      // Silenciar
    }
  }, []);
  
  // Test de vibración (para debugging)
  const testVibration = useCallback(() => {
    console.log('🧪 Probando vibración...');
    if ('vibrate' in navigator) {
      try {
        const result = navigator.vibrate([100, 50, 100, 50, 100]);
        console.log(`🧪 Resultado vibración test: ${result}`);
        return result;
      } catch (e) {
        console.log('🧪 Error en test vibración:', e);
        return false;
      }
    } else {
      console.log('🧪 API vibrate no existe en navigator');
      return false;
    }
  }, []);
  
  // Feedback combinado
  const triggerHeartbeatFeedback = useCallback(() => {
    const now = Date.now();
    if (now - lastFeedbackTimeRef.current < MIN_FEEDBACK_INTERVAL) {
      return;
    }
    lastFeedbackTimeRef.current = now;
    feedbackCountRef.current++;
    
    // Log cada 5 latidos
    if (feedbackCountRef.current % 5 === 1) {
      console.log(`💓 Feedback #${feedbackCountRef.current}`);
    }
    
    playBeep();
    vibrate();
  }, [playBeep, vibrate]);
  
  // Pre-inicializar en interacción
  useEffect(() => {
    const handleUserInteraction = () => {
      initAudioContext();
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
    vibrate,
    testVibration
  };
};
