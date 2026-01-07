/**
 * @file CameraPreview.tsx
 * @description INDICADOR DE CALIDAD - VALORES REALES INSTANTÁNEOS
 * Sin suavizado, sin animaciones - muestra el valor exacto del sensor
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

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  if (!isVisible) return null;

  // Valor REAL sin modificar
  const realQuality = Math.round(signalQuality);

  // Color basado en valor real
  const getColor = () => {
    if (realQuality < 20) return "#ef4444"; // rojo
    if (realQuality < 40) return "#f97316"; // naranja
    if (realQuality < 60) return "#eab308"; // amarillo
    if (realQuality < 80) return "#3b82f6"; // azul
    return "#22c55e"; // verde
  };

  return (
    <div className="fixed bottom-24 left-3 z-30">
      {/* Contenedor compacto y elegante */}
      <div 
        className="rounded-xl overflow-hidden shadow-lg bg-black/80 border"
        style={{ 
          width: '100px', 
          borderColor: getColor(),
          borderWidth: '2px'
        }}
      >
        {/* Video pequeño */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="w-full h-16 object-cover"
        />
        
        {/* Indicador numérico REAL */}
        <div className="px-2 py-1 text-center">
          <span 
            className="text-xl font-bold font-mono"
            style={{ color: getColor() }}
          >
            {realQuality}%
          </span>
        </div>

        {/* Barra de calidad REAL instantánea */}
        <div className="h-1 bg-gray-800">
          <div 
            className="h-full"
            style={{ 
              width: `${realQuality}%`,
              backgroundColor: getColor()
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default CameraPreview;
