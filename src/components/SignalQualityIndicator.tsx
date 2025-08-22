
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
  
  // CÁLCULO DE CALIDAD COMPACTO - 100% REAL
  const qualityMetrics = useMemo(() => {
    const normalizedQuality = Math.max(0, Math.min(100, quality));
    const qualityPercent = Math.round(normalizedQuality);
    
    // Determinar estado basado en calidad real
    let status = "---";
    let color = "text-gray-400";
    let bgColor = "bg-gray-500/10";
    let borderColor = "border-gray-500/20";
    
    if (!isMonitoring) {
      status = "STOP";
      color = "text-gray-400";
      bgColor = "bg-gray-500/5";
      borderColor = "border-gray-500/10";
    } else if (!isFingerDetected) {
      status = "NO";
      color = "text-orange-400";
      bgColor = "bg-orange-500/15";
      borderColor = "border-orange-500/25";
    } else if (qualityPercent < 30) {
      status = "LOW";
      color = "text-red-400";
      bgColor = "bg-red-500/15";
      borderColor = "border-red-500/25";
    } else if (qualityPercent < 60) {
      status = "MED";
      color = "text-yellow-400";
      bgColor = "bg-yellow-500/15";
      borderColor = "border-yellow-500/25";
    } else if (qualityPercent < 80) {
      status = "GOOD";
      color = "text-blue-400";
      bgColor = "bg-blue-500/15";
      borderColor = "border-blue-500/25";
    } else {
      status = "EXC";
      color = "text-green-400";
      bgColor = "bg-green-500/15";
      borderColor = "border-green-500/25";
    }
    
    return {
      qualityPercent,
      status,
      color,
      bgColor,
      borderColor
    };
  }, [quality, isMonitoring, isFingerDetected]);

  return (
    <div className={`
      ${qualityMetrics.bgColor} 
      ${qualityMetrics.borderColor} 
      border backdrop-blur-sm rounded-lg p-2 min-w-[120px] 
      shadow-sm transition-all duration-300 
      ${className}
    `}>
      {/* TÍTULO COMPACTO */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white text-xs font-medium">
          PPG
        </h3>
        <div className={`w-2 h-2 rounded-full ${qualityMetrics.bgColor} animate-pulse`} />
      </div>

      {/* INDICADOR PRINCIPAL COMPACTO */}
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
        <div className="w-full h-1 bg-black/30 rounded-full overflow-hidden">
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

      {/* SOLO SNR - MÉTRICAS MÍNIMAS */}
      {isMonitoring && (
        <div className="space-y-1">
          <div className="flex justify-between items-center text-[10px]">
            <span className="text-white/60">SNR:</span>
            <span className="text-white font-medium">
              {snr > 0 ? snr.toFixed(1) + 'dB' : '--'}
            </span>
          </div>
        </div>
      )}

      {/* ESTADO DEL DEDO COMPACTO */}
      {isMonitoring && (
        <div className="mt-2 pt-1 border-t border-white/10">
          <div className="flex items-center justify-center">
            <div className={`flex items-center space-x-1 ${
              isFingerDetected ? 'text-green-400' : 'text-orange-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                isFingerDetected ? 'bg-green-400 animate-pulse' : 'bg-orange-400 animate-bounce'
              }`} />
              <span className="text-[10px] font-medium">
                {isFingerDetected ? 'OK' : 'NO'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignalQualityIndicator;
