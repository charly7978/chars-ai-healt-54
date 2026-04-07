/**
 * @file CameraPreview.tsx
 * @description Vista de cámara sin indicadores de calidad - ENTRADA DIRECTA
 */

import React, { useRef, useEffect } from "react";

interface CameraPreviewProps {
  stream: MediaStream | null;
  isFingerDetected: boolean;
  signalQuality: number;
  isVisible: boolean;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({
  stream,
  isVisible
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Conectar stream al video
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [stream]);

  if (!isVisible) return null;

  return (
    <div className="absolute top-14 left-3 z-40">
      {/* Contenedor con video del dedo - SIN INDICADORES DE CALIDAD */}
      <div 
        className="rounded-xl overflow-hidden shadow-lg"
        style={{ 
          backgroundColor: 'rgba(0,0,0,0.85)',
          border: '2px solid #22c55e',
          boxShadow: '0 0 15px rgba(34, 197, 94, 0.3)',
          width: '110px'
        }}
      >
        {/* Video del dedo - SIN ESPEJO - DATOS CRUDOS */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-20 object-cover"
          style={{ 
            transform: 'none',
            filter: 'none'
          }}
        />
        
        {/* Etiqueta simple */}
        <div className="px-2 py-1 text-center">
          <span className="text-xs text-emerald-400 font-semibold">
            PPG ACTIVO
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraPreview;
