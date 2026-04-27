import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { parseArrhythmiaStatus, getArrhythmiaText, getArrhythmiaColor } from '@/utils/arrhythmiaUtils';

interface VitalSignProps {
  label: string;
  value: string | number | null;
  unit?: string;
  highlighted?: boolean;
  calibrationProgress?: number;
  normalRange?: { min: number; max: number };
  median?: number;
  average?: number;
  confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  featureQuality?: number;
  isResearch?: boolean;
  isAuthorized?: boolean;
  blockedReasons?: string[];
}

const VitalSign = ({ 
  label, 
  value, 
  unit, 
  highlighted = false,
  calibrationProgress,
  normalRange,
  median,
  average,
  confidenceLevel,
  featureQuality,
  isResearch = false,
  isAuthorized = true,
  blockedReasons = []
}: VitalSignProps) => {
  const [showDetails, setShowDetails] = useState(false);

  const getRiskLabel = (label: string, value: string | number | null) => {
    // Si no está autorizado o el valor es null, no hay riesgo
    if (!isAuthorized || value === null) return '';
    
    if (typeof value === 'number' && normalRange) {
      if (value > normalRange.max) return 'Valor alto';
      if (value < normalRange.min) return 'Valor bajo';
      return '';
    }
    
    if (typeof value === 'string') {
      switch(label) {
        case 'PRESIÓN ARTERIAL': {
          const pressureParts = value.split('/');
          if (pressureParts.length === 2) {
            const systolic = parseInt(pressureParts[0], 10);
            const diastolic = parseInt(pressureParts[1], 10);
            if (!isNaN(systolic) && !isNaN(diastolic)) {
              if (systolic >= 140 || diastolic >= 90) return 'Hipertensión';
              if (systolic < 90 || diastolic < 60) return 'Hipotensión';
            }
          }
          return '';
        }
        case 'COLESTEROL/TRIGL.': {
          const lipidParts = value.split('/');
          if (lipidParts.length === 2) {
            const cholesterol = parseInt(lipidParts[0], 10);
            const triglycerides = parseInt(lipidParts[1], 10);
            if (!isNaN(cholesterol) && cholesterol > 200) return 'Hipercolesterolemia';
            if (!isNaN(triglycerides) && triglycerides > 150) return 'Hipertrigliceridemia';
          }
          return '';
        }
        case 'ARRITMIAS': {
          const status = parseArrhythmiaStatus(value);
          return getArrhythmiaText(status);
        }
        default:
          return '';
      }
    }
    
    return '';
  };

  const getRiskColor = (riskLabel: string) => {
    switch(riskLabel) {
      case 'Taquicardia':
      case 'Hipoxemia':
      case 'Hiperglucemia':
      case 'Hipertensión':
      case 'Hipercolesterolemia':
      case 'Hipertrigliceridemia':
        return 'text-[#ea384c]';
      case 'Bradicardia':
      case 'Hipoglucemia':
      case 'Hipotensión':
        return 'text-[#F97316]';
      case 'Anemia':
        return 'text-[#FEF7CD]';
      case 'Policitemia':
        return 'text-[#F2FCE2]';
      default:
        return '';
    }
  };

  const getArrhythmiaDisplay = (value: string | number) => {
    if (typeof value !== 'string') return null;
    const status = parseArrhythmiaStatus(value);
    return (
      <div className="text-sm font-medium mt-2" style={{ color: getArrhythmiaColor(status) }}>
        {getArrhythmiaText(status)}
      </div>
    );
  };

  const getDetailedInfo = (label: string, value: string | number | null) => {
    let interpretation = "";
    
    if (!isAuthorized || value === null) {
      interpretation = "MEDICIÓN BLOQUEADA - NO HAY SEÑAL BIOLÓGICA VÁLIDA";
    } else if (typeof value === 'number' && normalRange) {
      interpretation = value > normalRange.max 
        ? "Su valor está por encima del rango normal."
        : value < normalRange.min 
          ? "Su valor está por debajo del rango normal."
          : "Su valor está dentro del rango normal.";
    } else if (blockedReasons.length > 0) {
      interpretation = `Bloqueado: ${blockedReasons.join(', ')}`;
    }
    
    return { median, average, interpretation };
  };

  const riskLabel = getRiskLabel(label, value);
  const riskColor = getRiskColor(riskLabel);
  const isArrhytmia = label === 'ARRITMIAS';
  const detailedInfo = getDetailedInfo(label, value);

  const handleClick = () => {
    setShowDetails(!showDetails);
  };

  return (
    <div 
      className={cn(
        "relative flex flex-col justify-center items-center p-2 bg-transparent transition-all duration-500 text-center cursor-pointer",
        showDetails && "bg-gray-800/20 backdrop-blur-sm rounded-lg"
      )}
      onClick={handleClick}
    >
      <div className="text-[12px] font-semibold uppercase tracking-wider text-white/90 mb-1 flex items-center gap-1">
        {label}
        {isResearch && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">
            EST
          </span>
        )}
      </div>

      <div className="font-bold text-2xl sm:text-3xl leading-none transition-all duration-300">
        <span className={cn(
          "text-gradient-soft animate-value-glow",
          !isAuthorized || value === null ? "text-gray-500" : ""
        )}>
          {!isAuthorized || value === null ? (
            "--"
          ) : isArrhytmia && typeof value === 'string' ? (
            getArrhythmiaText(parseArrhythmiaStatus(value))
          ) : (
            value
          )}
        </span>
        {unit && (isAuthorized && value !== null) && (
          <span className="text-sm text-white/70 ml-1">{unit}</span>
        )}
      </div>

      {confidenceLevel && confidenceLevel !== 'INSUFFICIENT' && label === 'PRESIÓN ARTERIAL' && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
            confidenceLevel === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400' :
            confidenceLevel === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-orange-500/20 text-orange-400'
          }`}>
            {confidenceLevel}
          </span>
          {featureQuality !== undefined && featureQuality > 0 && (
            <div className="flex items-center gap-0.5">
              <div className="w-8 h-1 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-500 ${
                    featureQuality >= 75 ? 'bg-emerald-400' :
                    featureQuality >= 50 ? 'bg-yellow-400' :
                    'bg-orange-400'
                  }`}
                  style={{ width: `${featureQuality}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {!isArrhytmia && riskLabel && isAuthorized && value !== null && (
        <div className={`text-sm font-medium mt-1 ${riskColor}`}>
          {riskLabel}
        </div>
      )}
      
      {isArrhytmia && isAuthorized && value !== null && getArrhythmiaDisplay(value)}
      
      {calibrationProgress !== undefined && (
        <div className="absolute inset-0 bg-transparent overflow-hidden pointer-events-none border-0">
          <div 
            className="h-full bg-blue-500/5 transition-all duration-300 ease-out"
            style={{ width: `${calibrationProgress}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs text-white/80">
              {calibrationProgress < 100 ? `${Math.round(calibrationProgress)}%` : '✓'}
            </span>
          </div>
        </div>
      )}

      {showDetails && detailedInfo && (
        <div className="absolute inset-x-0 top-full z-50 mt-2 p-4 bg-gray-900/90 backdrop-blur-sm rounded-lg shadow-lg text-left">
          <div className="text-sm font-medium text-white mb-2">Información adicional:</div>
          {isAuthorized && value !== null ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="text-xs">
                  <span className="font-medium text-white/70">Mediana:</span> {median} {unit}
                </div>
                <div className="text-xs">
                  <span className="font-medium text-white/70">Promedio ponderado:</span> {average} {unit}
                </div>
              </div>
              <div className="text-xs mt-1 text-white/80">
                {detailedInfo.interpretation}
              </div>
            </>
          ) : (
            <div className="text-xs text-red-400">
              {detailedInfo.interpretation}
              {blockedReasons.length > 0 && (
                <div className="mt-2 text-yellow-400">
                  Razones: {blockedReasons.join(', ')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VitalSign;
