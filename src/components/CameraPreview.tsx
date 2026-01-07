/**
 * @file CameraPreview.tsx
 * @description INDICADOR DE CALIDAD - VALORES REALES INSTANTÁNEOS
 * Muestra el valor EXACTO del sensor sin suavizado ni animaciones
 */

import React from "react";

interface CameraPreviewProps {
  stream: MediaStream | null;
  isFingerDetected: boolean;
  signalQuality: number;
  isVisible: boolean;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({
  signalQuality,
  isVisible
}) => {
  if (!isVisible) return null;

  // Valor REAL sin modificar - exactamente lo que viene del sensor
  const realQuality = Math.round(signalQuality);

  // Color basado en rangos reales
  const getColor = () => {
    if (realQuality < 20) return "#ef4444"; // rojo
    if (realQuality < 40) return "#f97316"; // naranja  
    if (realQuality < 60) return "#eab308"; // amarillo
    if (realQuality < 80) return "#22c55e"; // verde
    return "#10b981"; // verde brillante
  };

  // Etiqueta descriptiva basada en el valor real
  const getLabel = () => {
    if (realQuality < 20) return "Muy Baja";
    if (realQuality < 40) return "Baja";
    if (realQuality < 60) return "Regular";
    if (realQuality < 80) return "Buena";
    return "Excelente";
  };

  return (
    <div className="absolute top-14 left-3 z-40">
      {/* Indicador compacto y elegante */}
      <div 
        className="rounded-lg px-3 py-2 flex items-center gap-2 backdrop-blur-sm"
        style={{ 
          backgroundColor: 'rgba(0,0,0,0.7)',
          border: `2px solid ${getColor()}`,
          boxShadow: `0 0 10px ${getColor()}40`
        }}
      >
        {/* Punto indicador de color */}
        <div 
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: getColor() }}
        />
        
        {/* Valor numérico REAL */}
        <span 
          className="text-lg font-bold font-mono"
          style={{ color: getColor() }}
        >
          {realQuality}%
        </span>
        
        {/* Etiqueta */}
        <span className="text-xs text-white/70">
          {getLabel()}
        </span>
      </div>
    </div>
  );
};

export default CameraPreview;
