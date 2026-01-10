/**
 * @file CameraPreview.tsx
 * @description INDICADOR DE CALIDAD CON VISTA DE CÁMARA
 * Muestra el dedo en tiempo real + calidad instantánea
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
  signalQuality,
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

  // Valor REAL sin modificar
  const realQuality = Math.round(signalQuality);

  // Color basado en rangos reales
  const getColor = () => {
    if (realQuality < 20) return "#ef4444"; // rojo
    if (realQuality < 40) return "#f97316"; // naranja  
    if (realQuality < 60) return "#eab308"; // amarillo
    if (realQuality < 80) return "#22c55e"; // verde
    return "#10b981"; // verde brillante
  };

  // Etiqueta descriptiva
  const getLabel = () => {
    if (realQuality < 20) return "Muy Baja";
    if (realQuality < 40) return "Baja";
    if (realQuality < 60) return "Regular";
    if (realQuality < 80) return "Buena";
    return "Excelente";
  };

  return (
    <div className="absolute top-14 left-3 z-40">
      {/* Contenedor con video del dedo + indicador */}
      <div 
        className="rounded-xl overflow-hidden shadow-lg"
        style={{ 
          backgroundColor: 'rgba(0,0,0,0.85)',
          border: `2px solid ${getColor()}`,
          boxShadow: `0 0 15px ${getColor()}50`,
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
        
        {/* Indicador de calidad debajo del video */}
        <div className="px-2 py-1.5 flex items-center justify-between">
          {/* Punto de color */}
          <div 
            className="w-2.5 h-2.5 rounded-full animate-pulse"
            style={{ backgroundColor: getColor() }}
          />
          
          {/* Valor numérico */}
          <span 
            className="text-base font-bold font-mono"
            style={{ color: getColor() }}
          >
            {realQuality}%
          </span>
          
          {/* Etiqueta corta */}
          <span className="text-[10px] text-white/60">
            {getLabel()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraPreview;
