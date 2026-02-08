/**
 * INDICADOR DE CONFIANZA DE MEDICIÓN
 * 
 * Muestra visualmente el nivel de confianza de las mediciones
 * basado en Signal Quality Index (SQI) y Perfusion Index (PI)
 * 
 * Niveles:
 * - HIGH (verde): SQI > 80%, PI > 2%, R consistente
 * - MEDIUM (amarillo): SQI 50-80%, PI 0.5-2%
 * - LOW (naranja): SQI 30-50%, PI < 0.5%
 * - INVALID (rojo): SQI < 30%, sin datos válidos
 */

import React from 'react';

export interface ConfidenceLevel {
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
  sqi: number;
  pi: number;
  message: string;
}

interface MeasurementConfidenceIndicatorProps {
  confidence: ConfidenceLevel;
  compact?: boolean;
}

const confidenceConfig = {
  HIGH: {
    color: 'bg-green-500',
    textColor: 'text-green-500',
    borderColor: 'border-green-500',
    icon: '✓',
    label: 'Alta',
    bgLight: 'bg-green-500/10'
  },
  MEDIUM: {
    color: 'bg-yellow-500',
    textColor: 'text-yellow-500',
    borderColor: 'border-yellow-500',
    icon: '~',
    label: 'Media',
    bgLight: 'bg-yellow-500/10'
  },
  LOW: {
    color: 'bg-orange-500',
    textColor: 'text-orange-500',
    borderColor: 'border-orange-500',
    icon: '!',
    label: 'Baja',
    bgLight: 'bg-orange-500/10'
  },
  INVALID: {
    color: 'bg-red-500',
    textColor: 'text-red-500',
    borderColor: 'border-red-500',
    icon: '✗',
    label: 'Inválida',
    bgLight: 'bg-red-500/10'
  }
};

export const MeasurementConfidenceIndicator: React.FC<MeasurementConfidenceIndicatorProps> = ({
  confidence,
  compact = false
}) => {
  const config = confidenceConfig[confidence.level];
  
  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${config.bgLight}`}>
        <span className={`w-2 h-2 rounded-full ${config.color}`} />
        <span className={`text-xs font-medium ${config.textColor}`}>
          {config.label}
        </span>
      </div>
    );
  }
  
  return (
    <div className={`flex flex-col gap-1 p-3 rounded-lg border ${config.borderColor} ${config.bgLight}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${config.color} flex items-center justify-center text-white text-xs font-bold`}>
            {config.icon}
          </span>
          <span className={`text-sm font-semibold ${config.textColor}`}>
            Confianza: {config.label}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          SQI: {confidence.sqi.toFixed(0)}%
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="w-full h-1.5 bg-background rounded-full overflow-hidden">
        <div 
          className={`h-full ${config.color} transition-all duration-300`}
          style={{ width: `${Math.min(100, confidence.sqi)}%` }}
        />
      </div>
      
      {/* Details */}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>PI: {confidence.pi.toFixed(2)}%</span>
        <span>{confidence.message}</span>
      </div>
    </div>
  );
};

/**
 * Hook para calcular nivel de confianza
 */
export function useConfidenceLevel(
  sqi: number,
  pi: number,
  isFingerDetected: boolean
): ConfidenceLevel {
  if (!isFingerDetected || sqi < 15) {
    return {
      level: 'INVALID',
      sqi,
      pi,
      message: 'Coloque el dedo correctamente'
    };
  }
  
  if (sqi >= 60 && pi >= 1.5) {
    return {
      level: 'HIGH',
      sqi,
      pi,
      message: 'Señal óptima'
    };
  }
  
  if (sqi >= 35 && pi >= 0.5) {
    return {
      level: 'MEDIUM',
      sqi,
      pi,
      message: 'Señal aceptable'
    };
  }
  
  if (sqi >= 15 || pi >= 0.2) {
    return {
      level: 'LOW',
      sqi,
      pi,
      message: 'Mejore posición del dedo'
    };
  }
  
  return {
    level: 'INVALID',
    sqi,
    pi,
    message: 'Sin señal válida'
  };
}

export default MeasurementConfidenceIndicator;
