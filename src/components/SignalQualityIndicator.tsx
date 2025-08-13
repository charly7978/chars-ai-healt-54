import React from 'react';
import { getQualityColor, getQualityText } from '@/utils/qualityUtils';

interface SignalQualityIndicatorProps {
  quality: number;
  isMonitoring?: boolean;
  className?: string;
}

const SignalQualityIndicator = ({ 
  quality, 
  isMonitoring = false,
  className = "" 
}: SignalQualityIndicatorProps) => {
  const displayQuality = isMonitoring ? quality : 0;

  // Determinar si mostrar advertencia para calidad insuficiente
  const showWarning = displayQuality > 0 && displayQuality < 30;

  return (
    <div className={`bg-black/30 backdrop-blur-md rounded p-2 w-full ${className}`}>
      <div className="flex items-center gap-2">
        <div 
          className="w-12 h-12 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-300"
          style={{
            borderColor: getQualityColor(displayQuality),
            backgroundColor: `${getQualityColor(displayQuality)}33`
          }}
        >
          <span className="text-sm font-bold text-white">{displayQuality}%</span>
        </div>

        <div className="flex-1">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold text-white/90">Calidad de Señal</span>
            <span 
              className="text-xs font-medium"
              style={{ color: getQualityColor(displayQuality) }}
            >
              {getQualityText(displayQuality)}
            </span>
          </div>

          <div className="w-full h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
            <div 
              className="h-full transition-all duration-300"
              style={{
                width: `${displayQuality}%`,
                backgroundColor: getQualityColor(displayQuality)
              }}
            />
          </div>
          
          {showWarning && (
            <div className="mt-1 flex items-center">
              <span className="text-[10px] text-amber-400">
                Ajuste la posición del dedo para mejorar la calidad
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SignalQualityIndicator;
