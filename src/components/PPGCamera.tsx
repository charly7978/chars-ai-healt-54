/**
 * COMPONENTE DE CÁMARA PPG
 * 
 * Renderiza el elemento video para la captura PPG.
 * La inicialización de la cámara se hace externamente via useCamera hook
 * para garantizar que getUserMedia se llame desde el gesto del usuario.
 */

import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

export interface PPGCameraHandle {
  getVideoElement: () => HTMLVideoElement | null;
}

interface PPGCameraProps {
  stream: MediaStream | null;
  onVideoReady?: (video: HTMLVideoElement) => void;
}

const PPGCamera = forwardRef<PPGCameraHandle, PPGCameraProps>(({
  stream,
  onVideoReady
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasNotifiedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current
  }), []);

  // Conectar stream al video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (stream) {
      video.srcObject = stream;
      hasNotifiedRef.current = false;
      
      const handleLoadedMetadata = async () => {
        try {
          await video.play();
        } catch {}
        
        // Notificar cuando el video está listo
        if (!hasNotifiedRef.current && video.videoWidth > 0) {
          hasNotifiedRef.current = true;
          console.log('📹 Video PPG listo:', video.videoWidth, 'x', video.videoHeight);
          onVideoReady?.(video);
        }
      };
      
      video.onloadedmetadata = handleLoadedMetadata;
      
      // Si ya tiene metadata, notificar
      if (video.readyState >= 2 && video.videoWidth > 0 && !hasNotifiedRef.current) {
        hasNotifiedRef.current = true;
        onVideoReady?.(video);
      }
    } else {
      video.srcObject = null;
      hasNotifiedRef.current = false;
    }
    
    return () => {
      if (video) {
        video.onloadedmetadata = null;
      }
    };
  }, [stream, onVideoReady]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: stream ? 1 : 0,
        pointerEvents: 'none'
      }}
    />
  );
});

PPGCamera.displayName = 'PPGCamera';

export default PPGCamera;
