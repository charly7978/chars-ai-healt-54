
import React, { useMemo } from 'react';

interface SignalQualityIndicatorProps {
  quality: number;
  isMonitoring: boolean;
  isFingerDetected: boolean;
  snr?: number;
  className?: string;
}

const SignalQualityIndicator = ({ 
  quality, 
  isMonitoring, 
  isFingerDetected,
  snr = 0,
  className = ""
}: SignalQualityIndicatorProps) => {
  
  const qualityMetrics = useMemo(() => {
    const normalizedQuality = Math.max(0, Math.min(100, quality));
    const qualityPercent = Math.round(normalizedQuality);
    
    let status = "DESCONOCIDO";
    let color = "text-gray-400";
    let bgColor = "bg-gray-500/10";
    
    if (!isMonitoring) {
      status = "INACTIVO";
      color = "text-gray-400";
      bgColor = "bg-gray-500/5";
    } else if (!isFingerDetected) {
      status = "SIN DEDO";
      color = "text-orange-400";
      bgColor = "bg-orange-500/10";
    } else if (qualityPercent < 30) {
      status = "BAJA";
      color = "text-red-400";
      bgColor = "bg-red-500/10";
    } else if (qualityPercent < 60) {
      status = "MEDIA";
      color = "text-yellow-400";
      bgColor = "bg-yellow-500/10";
    } else if (qualityPercent < 80) {
      status = "BUENA";
      color = "text-blue-400";
      bgColor = "bg-blue-500/10";
    } else {
      status = "EXCELENTE";
      color = "text-green-400";
      bgColor = "bg-green-500/10";
    }
    
    return {
      qualityPercent,
      status,
      color,
      bgColor
    };
  }, [quality, isMonitoring, isFingerDetected]);

  return (
    <div className={`
      ${qualityMetrics.bgColor} 
      backdrop-blur-md rounded-lg p-2 min-w-[120px] max-w-[140px]
      border border-white/5 shadow-sm transition-all duration-300 
      ${className}
    `}>
      {/* TÍTULO COMPACTO */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-white text-xs font-medium">Calidad</span>
        <div className={`w-2 h-2 rounded-full ${qualityMetrics.bgColor} animate-pulse`} />
      </div>

      {/* INDICADOR PRINCIPAL */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className={`text-sm font-bold ${qualityMetrics.color}`}>
            {qualityMetrics.qualityPercent}%
          </span>
          <span className={`text-[10px] ${qualityMetrics.color} font-medium`}>
            {qualityMetrics.status}
          </span>
        </div>
        
        {/* BARRA DE PROGRESO COMPACTA */}
        <div className="w-full h-1 bg-black/20 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 ${
              qualityMetrics.qualityPercent < 30 ? 'bg-gradient-to-r from-red-500 to-red-400' :
              qualityMetrics.qualityPercent < 60 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400' :
              qualityMetrics.qualityPercent < 80 ? 'bg-gradient-to-r from-blue-500 to-blue-400' :
              'bg-gradient-to-r from-green-500 to-green-400'
            }`}
            style={{ width: `${qualityMetrics.qualityPercent}%` }}
          />
        </div>
      </div>

      {/* SOLO SNR SI ESTÁ MONITOREANDO */}
      {isMonitoring && (
        <div className="text-[10px] text-center">
          <span className="text-white/70">SNR: </span>
          <span className="text-white font-medium">
            {snr > 0 ? snr.toFixed(1) + 'dB' : '--'}
          </span>
        </div>
      )}
    </div>
  );
};

export default SignalQualityIndicator;
