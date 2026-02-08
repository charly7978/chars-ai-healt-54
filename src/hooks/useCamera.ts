/**
 * HOOK DE CÁMARA PPG - ACCESO DIRECTO DESDE GESTO DE USUARIO
 * 
 * CRÍTICO: getUserMedia DEBE ser llamado directamente desde un gesto de usuario
 * (click, tap, etc.) para cumplir con las políticas de seguridad del navegador.
 * 
 * Este hook proporciona una función `requestCamera` que debe ser invocada
 * DIRECTAMENTE desde el onClick del botón de inicio.
 * 
 * Referencias:
 * - MDN Web Docs: User Activation
 * - Chrome Blog: Permission Element Origin Trial
 * - Web.dev: Permissions Best Practices
 */

import { useState, useRef, useCallback } from 'react';

export interface CameraState {
  stream: MediaStream | null;
  videoElement: HTMLVideoElement | null;
  isActive: boolean;
  hasFlash: boolean;
  error: string | null;
}

export interface UseCameraResult {
  state: CameraState;
  requestCamera: () => Promise<MediaStream | null>;
  stopCamera: () => void;
  setVideoElement: (el: HTMLVideoElement | null) => void;
}

/**
 * Hook para acceso a cámara PPG
 * 
 * IMPORTANTE: requestCamera() debe llamarse DIRECTAMENTE desde un onClick handler
 */
export function useCamera(): UseCameraResult {
  const [state, setState] = useState<CameraState>({
    stream: null,
    videoElement: null,
    isActive: false,
    hasFlash: false,
    error: null
  });
  
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /**
   * DETENER CÁMARA
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      // Apagar flash primero
      for (const track of streamRef.current.getVideoTracks()) {
        try {
          const caps = track.getCapabilities?.() as any;
          if (caps?.torch) {
            track.applyConstraints({ advanced: [{ torch: false } as any] }).catch(() => {});
          }
        } catch {}
        track.stop();
      }
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setState(prev => ({
      ...prev,
      stream: null,
      isActive: false,
      hasFlash: false,
      error: null
    }));
    
    console.log('🛑 Cámara detenida');
  }, []);

  /**
   * ACTIVAR FLASH
   */
  const activateFlash = async (track: MediaStreamTrack): Promise<boolean> => {
    // Esperar estabilización de cámara
    await new Promise(r => setTimeout(r, 300));
    
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const caps = track.getCapabilities?.() as any;
        if (!caps?.torch) {
          console.warn('⚠️ Esta cámara no soporta torch');
          return false;
        }
        
        await track.applyConstraints({ advanced: [{ torch: true } as any] });
        
        // Verificar
        const settings = track.getSettings() as any;
        if (settings?.torch === true) {
          console.log('🔦 Flash ACTIVADO (verificado)');
          return true;
        }
        
        // Asumir que funcionó si no hay error
        console.log('🔦 Flash aplicado (intento ' + (attempt + 1) + ')');
        return true;
        
      } catch (e) {
        console.warn(`🔦 Intento ${attempt + 1} fallido:`, e);
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    console.warn('⚠️ No se pudo activar el flash');
    return false;
  };

  /**
   * SOLICITAR ACCESO A CÁMARA
   * 
   * CRÍTICO: Esta función DEBE ser llamada DIRECTAMENTE desde un evento de usuario
   * (onClick, onTouchStart, etc.) para cumplir con las políticas de seguridad.
   */
  const requestCamera = useCallback(async (): Promise<MediaStream | null> => {
    // Limpiar estado previo
    stopCamera();
    
    setState(prev => ({ ...prev, error: null }));
    
    try {
      console.log('📷 Solicitando acceso a cámara (gesto directo)...');
      
      // PASO 1: Solicitar permiso con constraints básicos primero
      // Esto debe hacerse en el contexto del gesto del usuario
      let stream: MediaStream;
      
      try {
        // Intentar cámara trasera con flash
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 30, min: 24, max: 30 }
          }
        });
        console.log('✅ Acceso a cámara concedido');
      } catch (e: any) {
        // Fallback: cualquier cámara
        console.warn('⚠️ Fallback a cámara por defecto:', e.message);
        
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true
          });
        } catch (e2: any) {
          const errorMsg = e2.name === 'NotAllowedError' 
            ? 'Permiso de cámara denegado. Por favor permite el acceso.'
            : e2.name === 'NotFoundError'
              ? 'No se encontró ninguna cámara en este dispositivo.'
              : `Error de cámara: ${e2.message}`;
          
          setState(prev => ({ ...prev, error: errorMsg }));
          console.error('❌ Error de cámara:', e2);
          return null;
        }
      }
      
      streamRef.current = stream;
      
      // PASO 2: Conectar al video element si está disponible
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {}
      }
      
      // PASO 3: Activar flash
      const track = stream.getVideoTracks()[0];
      let hasFlash = false;
      
      if (track) {
        hasFlash = await activateFlash(track);
        
        const settings = track.getSettings();
        console.log('📹 Cámara activa:', settings.width, 'x', settings.height, '@', settings.frameRate, 'fps');
      }
      
      // PASO 4: Actualizar estado
      setState({
        stream,
        videoElement: videoRef.current,
        isActive: true,
        hasFlash,
        error: null
      });
      
      return stream;
      
    } catch (err: any) {
      const errorMsg = `Error inesperado: ${err.message}`;
      setState(prev => ({ ...prev, error: errorMsg }));
      console.error('❌ Error cámara:', err);
      return null;
    }
  }, [stopCamera]);

  /**
   * ASIGNAR ELEMENTO VIDEO
   */
  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    
    // Si ya hay stream, conectarlo
    if (el && streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
    
    setState(prev => ({ ...prev, videoElement: el }));
  }, []);

  return {
    state,
    requestCamera,
    stopCamera,
    setVideoElement
  };
}
