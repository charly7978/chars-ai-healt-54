import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { parseArrhythmiaStatus, getArrhythmiaText, getArrhythmiaColor } from '@/utils/arrhythmiaUtils';

interface VitalSignProps {
  label: string;
  value: string | number;
  unit?: string;
  highlighted?: boolean;
  calibrationProgress?: number;
  normalRange?: { min: number; max: number };
  median?: number;
  average?: number;
}

const VitalSign = ({ 
  label, 
  value, 
  unit, 
  highlighted = false,
  calibrationProgress,
  normalRange,
  median,
  average
}: VitalSignProps) => {
  const [showDetails, setShowDetails] = useState(false);

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
            if (!isNaN(cholesterol)) {
              if (cholesterol > 200) return 'Hipercolesterolemia';
            }
            if (!isNaN(triglycerides)) {
              if (triglycerides > 150) return 'Hipertrigliceridemia';
            }
          }
          return '';
        case 'ARRITMIAS':
          const arrhythmiaParts = value.split('|');
          if (arrhythmiaParts.length === 2) {
            const status = arrhythmiaParts[0];
            const count = arrhythmiaParts[1];
            
            if (status === "ARRITMIA DETECTADA" && parseInt(count) > 1) {
              return `Arritmias: ${count}`;
            } else if (status === "SIN ARRITMIAS") {
              return 'Normal';
            } else if (status === "CALIBRANDO...") {
              return 'Calibrando';
            }
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
      <div className="text-[11px] font-medium uppercase tracking-wider text-black/70 mb-1">
        {label}
      </div>
      
      <div className="font-bold text-xl sm:text-2xl transition-all duration-300">
        <span className="text-gradient-soft animate-value-glow">
          {isArrhytmia && typeof value === 'string' ? value.split('|')[0] : value}
        </span>
        {unit && <span className="text-xs text-white/70 ml-1">{unit}</span>}
      </div>

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
          <div className="text-xs mt-1 text-gray-800">
            {detailedInfo.interpretation}
          </div>
        </div>
      )}
    </div>
  );
};

export default VitalSign;
