
import React from 'react';
import { getQualityColor, getQualityText } from '@/utils/qualityUtils';

interface SignalQualityIndicatorProps {
  quality: number;
  isMonitoring?: boolean;
  isFingerDetected?: boolean;
  bpm?: number | null;
  snr?: number;
  activeChannels?: number;
  totalChannels?: number;
  className?: string;
}

const SignalQualityIndicator = ({ 
  quality, 
  isMonitoring = false,
  isFingerDetected = false,
  bpm = null,
  snr = 0,
  activeChannels = 0,
  totalChannels = 0,
  className = "" 
}: SignalQualityIndicatorProps) => {
  const displayQuality = isMonitoring ? quality : 0;
  const showWarning = displayQuality > 0 && displayQuality < 30;

  // CÁLCULO DE CALIDAD REAL EN PORCENTAJE
  const qualityPercentage = Math.min(100, Math.max(0, displayQuality));
  
  return (
    <div className={`bg-black/85 backdrop-blur-md rounded-xl p-3 border border-white/10 min-w-[140px] ${className}`}>
      <div className="text-center">
        <div className="text-white/60 text-xs font-medium mb-2 uppercase tracking-wider">
          Calidad PPG
        </div>
        
        {/* Indicador circular principal */}
        <div className="relative w-12 h-12 mx-auto mb-2">
          <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 48 48">
            <circle 
              cx="24" cy="24" r="20" 
              fill="none" 
              stroke="rgba(255,255,255,0.08)" 
              strokeWidth="3"
            />
            <circle 
              cx="24" cy="24" r="20" 
              fill="none" 
              stroke="url(#qualityGradient)" 
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(qualityPercentage / 100) * 125.6} 125.6`}
              className="transition-all duration-500 ease-out"
              style={{
                filter: isFingerDetected ? 
                  'drop-shadow(0 0 4px currentColor)' : 'none'
              }}
            />
            <defs>
              <linearGradient id="qualityGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={getQualityColor(qualityPercentage, isFingerDetected)} />
                <stop offset="100%" stopColor={getQualityColor(qualityPercentage, isFingerDetected)} />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-sm font-bold`} style={{ color: getQualityColor(qualityPercentage, isFingerDetected) }}>
              {qualityPercentage}%
            </span>
          </div>
        </div>
        
        {/* Estado textual */}
        <div className={`text-xs font-medium mb-2`} style={{ color: getQualityColor(qualityPercentage, isFingerDetected) }}>
          {getQualityText(qualityPercentage, isFingerDetected)}
        </div>
        
        {/* Métricas detalladas */}
        <div className="space-y-1 text-xs text-white/50">
          <div className="flex justify-between">
            <span>BPM:</span>
            <span className="text-white/70 font-medium">{bpm || '--'}</span>
          </div>
          <div className="flex justify-between">
            <span>Canales:</span>
            <span className="text-white/70">{activeChannels}/{totalChannels}</span>
          </div>
          <div className="flex justify-between">
            <span>SNR:</span>
            <span className="text-white/70">{snr.toFixed(1)}</span>
          </div>
        </div>
        
        {/* Indicador de estado */}
        <div className="mt-2 pt-2 border-t border-white/10">
          <div className="flex items-center justify-center space-x-1">
            <div className={`w-2 h-2 rounded-full ${
              isFingerDetected ? 
              'bg-green-400 animate-pulse' : 
              'bg-gray-500'
            }`}></div>
            <span className="text-xs text-white/60">
              {isFingerDetected ? 'Detectado' : 'Buscando...'}
            </span>
          </div>
        </div>
        
        {showWarning && (
          <div className="mt-2 text-[10px] text-amber-400">
            Ajuste la posición del dedo
          </div>
        )}
      </div>
    </div>
  );
};

export default SignalQualityIndicator;
