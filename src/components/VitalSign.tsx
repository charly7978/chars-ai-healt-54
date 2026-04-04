import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { parseArrhythmiaStatus, getArrhythmiaText, getArrhythmiaColor } from '@/utils/arrhythmiaUtils';
import { ConfidenceLevel, getUncertainty, UNCERTAINTY_ESTIMATES } from '@/types/measurement';

interface VitalSignProps {
  label: string;
  value: string | number;
  unit?: string;
  highlighted?: boolean;
  calibrationProgress?: number;
  normalRange?: { min: number; max: number };
  median?: number;
  average?: number;
  confidenceLevel?: ConfidenceLevel;
  featureQuality?: number;
  /** Metric key for uncertainty calculation */
  metricKey?: keyof typeof UNCERTAINTY_ESTIMATES;
  /** Whether this metric is experimental (not clinically validated) */
  experimental?: boolean;
  /** Whether calibration is required and active */
  isCalibrated?: boolean;
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
  metricKey,
  experimental = false,
  isCalibrated,
}: VitalSignProps) => {
  const [showDetails, setShowDetails] = useState(false);

  // Calculate uncertainty band
  const uncertainty = metricKey && confidenceLevel 
    ? getUncertainty(metricKey, confidenceLevel) 
    : null;

  const getRiskLabel = (label: string, value: string | number) => {
    if (typeof value === 'number' && normalRange) {
      if (value > normalRange.max) return 'Valor alto';
      if (value < normalRange.min) return 'Valor bajo';
      return '';
    }
    
    if (typeof value === 'string') {
      switch(label) {
        case 'PRESIÓN ARTERIAL':
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
        case 'COLESTEROL/TRIGL.':
          const lipidParts = value.split('/');
          if (lipidParts.length === 2) {
            const cholesterol = parseInt(lipidParts[0], 10);
            const triglycerides = parseInt(lipidParts[1], 10);
            if (!isNaN(cholesterol) && cholesterol > 200) return 'Hipercolesterolemia';
            if (!isNaN(triglycerides) && triglycerides > 150) return 'Hipertrigliceridemia';
          }
          return '';
        case 'ARRITMIAS':
          const arrhythmiaParts = value.split('|');
          if (arrhythmiaParts.length === 2) {
            const status = arrhythmiaParts[0];
            const count = arrhythmiaParts[1];
            if (status === "ARRITMIA DETECTADA" && parseInt(count) > 1) return `Arritmias: ${count}`;
            if (status === "SIN ARRITMIAS") return 'Normal';
            if (status === "CALIBRANDO...") return 'Calibrando';
          }
          return '';
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

  const getDetailedInfo = (label: string, value: string | number) => {
    let interpretation = "";
    if (typeof value === 'number' && normalRange) {
      interpretation = value > normalRange.max 
        ? "Su valor está por encima del rango normal."
        : value < normalRange.min 
          ? "Su valor está por debajo del rango normal."
          : "Su valor está dentro del rango normal.";
    }
    return { median, average, interpretation };
  };

  const riskLabel = getRiskLabel(label, value);
  const riskColor = getRiskColor(riskLabel);
  const isArrhytmia = label === 'ARRITMIAS';
  const detailedInfo = getDetailedInfo(label, value);

  const handleClick = () => setShowDetails(!showDetails);

  const hasValue = value !== '--' && value !== '--/--' && value !== 0;

  return (
    <div 
      className={cn(
        "relative flex flex-col justify-center items-center p-2 bg-transparent transition-all duration-500 text-center cursor-pointer",
        showDetails && "bg-gray-800/20 backdrop-blur-sm rounded-lg"
      )}
      onClick={handleClick}
    >
      {/* Label + badges */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-black/70">
          {label}
        </span>
        {experimental && (
          <span className="text-[7px] font-bold px-1 py-px rounded bg-amber-500/20 text-amber-400 tracking-wider">
            EST
          </span>
        )}
        {isCalibrated === false && hasValue && !experimental && label === 'PRESIÓN ARTERIAL' && (
          <span className="text-[7px] font-bold px-1 py-px rounded bg-red-500/20 text-red-400 tracking-wider">
            SIN CAL
          </span>
        )}
      </div>
      
      {/* Value + uncertainty */}
      <div className="font-bold text-xl sm:text-2xl transition-all duration-300">
        <span className="text-gradient-soft animate-value-glow">
          {isArrhytmia && typeof value === 'string' ? value.split('|')[0] : value}
        </span>
        {unit && <span className="text-xs text-white/70 ml-1">{unit}</span>}
      </div>

      {/* Uncertainty band ± */}
      {uncertainty && hasValue && typeof value === 'number' && value > 0 && (
        <div className="text-[9px] text-slate-400 mt-0.5">
          ±{uncertainty} {unit}
        </div>
      )}

      {/* Confidence indicator for BP */}
      {confidenceLevel && confidenceLevel !== 'INSUFFICIENT' && confidenceLevel !== 'INVALID' && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
            confidenceLevel === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400' :
            confidenceLevel === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-orange-500/20 text-orange-400'
          }`}>
            {confidenceLevel}
          </span>
          {featureQuality !== undefined && featureQuality > 0 && (
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
          )}
        </div>
      )}

      {!isArrhytmia && riskLabel && (
        <div className={`text-sm font-medium mt-1 ${riskColor}`}>
          {riskLabel}
        </div>
      )}
      
      {isArrhytmia && getArrhythmiaDisplay(value)}
      
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
        <div className="absolute inset-x-0 top-full z-50 mt-2 p-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg text-left">
          <div className="text-sm font-medium text-gray-900 mb-2">Información adicional:</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <div className="text-xs">
              <span className="font-medium">Mediana:</span> {median} {unit}
            </div>
            <div className="text-xs">
              <span className="font-medium">Promedio ponderado:</span> {average} {unit}
            </div>
          </div>
          {uncertainty && (
            <div className="text-xs text-gray-600 mb-1">
              <span className="font-medium">Incertidumbre:</span> ±{uncertainty} {unit}
            </div>
          )}
          {experimental && (
            <div className="text-xs text-amber-600 mb-1 font-medium">
              ⚠️ Estimación experimental — no sustituye análisis de laboratorio
            </div>
          )}
          <div className="text-xs mt-1 text-gray-800">
            {detailedInfo.interpretation}
          </div>
        </div>
      )}
    </div>
  );
};

export default VitalSign;
