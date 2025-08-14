import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { parseArrhythmiaStatus, getArrhythmiaText, getArrhythmiaColor } from '@/utils/arrhythmiaUtils';
import styles from './VitalSign.module.css';

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
      <div className={`text-sm font-medium mt-2 ${status?.status === 'DETECTED' ? 'text-red-500' : status?.status === 'CALIBRATING' ? 'text-blue-500' : 'text-green-500'}`}>
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
        styles.vitalSignContainer,
        highlighted && styles.vitalSignHighlighted,
        showDetails && styles.showDetails
      )}
      onClick={handleClick}
    >
      <div className={styles.vitalSignLabel}>
        <span>{label}</span>
        {showDetails && <span className={styles.infoIcon}>ⓘ</span>}
      </div>
      
      <div className={styles.vitalSignValueContainer}>
        <span className={styles.vitalSignValue}>
          {isArrhytmia && typeof value === 'string' ? value.split('|')[0] : value}
        </span>
        {unit && <span className={styles.vitalSignUnit}>{unit}</span>}
      </div>

      {!isArrhytmia && riskLabel && (
        <div className={`${styles.riskLabel} ${riskColor}`}>
          {riskLabel}
        </div>
      )}
      
      {isArrhytmia && getArrhythmiaDisplay(value)}
      
      {calibrationProgress !== undefined && (
        <div className={styles.calibrationIndicator}>
          <div 
            className={styles.calibrationProgress}
            style={{ '--progress': `${calibrationProgress}%` } as React.CSSProperties}
          />
          <div className={styles.calibrationText}>
            {calibrationProgress < 100 ? `${Math.round(calibrationProgress)}%` : '✓'}
          </div>
        </div>
      )}

      {showDetails && detailedInfo && (
        <div className={styles.detailsPanel}>
          <div className={styles.detailsTitle}>Información adicional:</div>
          <div className={styles.detailsGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Mediana:</span> {median} {unit}
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>Promedio ponderado:</span> {average} {unit}
            </div>
          </div>
          <div className={styles.interpretation}>
            {detailedInfo.interpretation}
          </div>
        </div>
      )}
    </div>
  );
};

export default VitalSign;
