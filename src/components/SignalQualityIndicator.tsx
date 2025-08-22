
import React, { useMemo } from 'react';

interface SignalQualityIndicatorProps {
  quality: number;
  isMonitoring: boolean;
  isFingerDetected: boolean;
  bpm?: number;
  snr?: number;
  activeChannels?: number;
  totalChannels?: number;
  className?: string;
}

const SignalQualityIndicator = ({ 
  quality, 
  isMonitoring, 
  isFingerDetected,
  bpm = 0,
  snr = 0,
  activeChannels = 0,
  totalChannels = 0,
  className = ""
}: SignalQualityIndicatorProps) => {
  
  // CÁLCULO DE CALIDAD MEJORADO - 100% REAL
  const qualityMetrics = useMemo(() => {
    const normalizedQuality = Math.max(0, Math.min(100, quality));
    const qualityPercent = Math.round(normalizedQuality);
    
    // Determinar estado basado en calidad real
    let status = "DESCONOCIDO";
    let color = "text-gray-400";
    let bgColor = "bg-gray-500/20";
    let borderColor = "border-gray-500/30";
    
    if (!isMonitoring) {
      status = "INACTIVO";
      color = "text-gray-400";
      bgColor = "bg-gray-500/10";
      borderColor = "border-gray-500/20";
    } else if (!isFingerDetected) {
      status = "SIN DEDO";
      color = "text-orange-400";
      bgColor = "bg-orange-500/20";
      borderColor = "border-orange-500/30";
    } else if (qualityPercent < 30) {
      status = "BAJA";
      color = "text-red-400";
      bgColor = "bg-red-500/20";
      borderColor = "border-red-500/30";
    } else if (qualityPercent < 60) {
      status = "MEDIA";
      color = "text-yellow-400";
      bgColor = "bg-yellow-500/20";
      borderColor = "border-yellow-500/30";
    } else if (qualityPercent < 80) {
      status = "BUENA";
      color = "text-blue-400";
      bgColor = "bg-blue-500/20";
      borderColor = "border-blue-500/30";
    } else {
      status = "EXCELENTE";
      color = "text-green-400";
      bgColor = "bg-green-500/20";
      borderColor = "border-green-500/30";
    }
    
    return {
      qualityPercent,
      status,
      color,
      bgColor,
      borderColor
    };
  }, [quality, isMonitoring, isFingerDetected]);

  const channelEfficiency = totalChannels > 0 ? 
    Math.round((activeChannels / totalChannels) * 100) : 0;

  return (
    <div className={`
      ${qualityMetrics.bgColor} 
      ${qualityMetrics.borderColor} 
      border backdrop-blur-md rounded-2xl p-4 min-w-[200px] 
      shadow-lg transition-all duration-300 
      ${className}
    `}>
      {/* TÍTULO */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white text-sm font-semibold">
          Calidad PPG
        </h3>
        <div className={`w-3 h-3 rounded-full ${qualityMetrics.bgColor} animate-pulse`} />
      </div>

      {/* INDICADOR PRINCIPAL DE CALIDAD */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-lg font-bold ${qualityMetrics.color}`}>
            {qualityMetrics.qualityPercent}%
          </span>
          <span className={`text-xs ${qualityMetrics.color} font-medium`}>
            {qualityMetrics.status}
          </span>
        </div>
        
        {/* BARRA DE PROGRESO DE CALIDAD */}
        <div className="w-full h-2 bg-black/30 rounded-full overflow-hidden">
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

      {/* MÉTRICAS DETALLADAS */}
      {isMonitoring && (
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-white/70">BPM:</span>
            <span className="text-white font-medium">
              {bpm > 0 ? Math.round(bpm) : '--'}
            </span>
          </div>
          
          <div className="flex justify-between items-center text-xs">
            <span className="text-white/70">SNR:</span>
            <span className="text-white font-medium">
              {snr > 0 ? snr.toFixed(1) + ' dB' : '--'}
            </span>
          </div>
          
          <div className="flex justify-between items-center text-xs">
            <span className="text-white/70">Canales:</span>
            <span className="text-white font-medium">
              {activeChannels}/{totalChannels}
            </span>
          </div>
          
          <div className="flex justify-between items-center text-xs">
            <span className="text-white/70">Eficiencia:</span>
            <span className={`font-medium ${
              channelEfficiency >= 50 ? 'text-green-400' : 'text-orange-400'
            }`}>
              {channelEfficiency}%
            </span>
          </div>
        </div>
      )}

      {/* ESTADO DEL DEDO */}
      {isMonitoring && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-center justify-center">
            <div className={`flex items-center space-x-2 ${
              isFingerDetected ? 'text-green-400' : 'text-orange-400'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isFingerDetected ? 'bg-green-400 animate-pulse' : 'bg-orange-400 animate-bounce'
              }`} />
              <span className="text-xs font-medium">
                {isFingerDetected ? 'Dedo detectado' : 'Posicione el dedo'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SignalQualityIndicator;
