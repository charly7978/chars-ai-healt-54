import React from 'react';
import type { ConfidenceLevel } from '../modules/ppg-core';

/**
 * INDICADOR DE CONFIANZA DE MEDICIÓN
 * 
 * Muestra el nivel de confianza basado en SQI global:
 * - HIGH (verde): SQI > 70%
 * - MEDIUM (amarillo): SQI 50-70%
 * - LOW (naranja): SQI 30-50%
 * - INVALID (rojo): SQI < 30%
 */

interface MeasurementConfidenceIndicatorProps {
  confidence: ConfidenceLevel;
  signalQuality: number;
  perfusionIndex: number;
  isMonitoring: boolean;
}

const MeasurementConfidenceIndicator: React.FC<MeasurementConfidenceIndicatorProps> = ({
  confidence,
  signalQuality,
  perfusionIndex,
  isMonitoring
}) => {
  if (!isMonitoring) {
    return null;
  }
  
  const getConfig = () => {
    switch (confidence) {
      case 'HIGH':
        return {
          color: 'bg-emerald-500',
          textColor: 'text-emerald-400',
          borderColor: 'border-emerald-500/50',
          label: 'ALTA',
          icon: '✓',
          message: 'Señal óptima'
        };
      case 'MEDIUM':
        return {
          color: 'bg-yellow-500',
          textColor: 'text-yellow-400',
          borderColor: 'border-yellow-500/50',
          label: 'MEDIA',
          icon: '◐',
          message: 'Señal aceptable'
        };
      case 'LOW':
        return {
          color: 'bg-orange-500',
          textColor: 'text-orange-400',
          borderColor: 'border-orange-500/50',
          label: 'BAJA',
          icon: '⚠',
          message: 'Mejore posición'
        };
      case 'INVALID':
      default:
        return {
          color: 'bg-red-500',
          textColor: 'text-red-400',
          borderColor: 'border-red-500/50',
          label: 'SIN SEÑAL',
          icon: '✗',
          message: 'Reposicione dedo'
        };
    }
  };
  
  const config = getConfig();
  
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border ${config.borderColor}`}>
      {/* Indicador visual */}
      <div className={`w-3 h-3 rounded-full ${config.color} ${confidence !== 'INVALID' ? 'animate-pulse' : ''}`} />
      
      {/* Texto */}
      <div className="flex flex-col">
        <span className={`text-xs font-bold ${config.textColor}`}>
          {config.icon} {config.label}
        </span>
        <span className="text-[9px] text-white/70">
          SQI: {signalQuality.toFixed(0)}% | PI: {perfusionIndex.toFixed(1)}%
        </span>
      </div>
    </div>
  );
};

export default MeasurementConfidenceIndicator;
