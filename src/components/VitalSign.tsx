import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { parseArrhythmiaStatus, getArrhythmiaText } from '@/utils/arrhythmiaUtils';

interface VitalSignProps {
  label: string;
  value: string | number;
  unit?: string;
  highlighted?: boolean;
  calibrationProgress?: number;
  normalRange?: { min: number; max: number };
  median?: number;
  average?: number;
  confidenceLevel?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT';
  featureQuality?: number;
  /** Phase 21 — short label rendered as the tab on the card */
  shortLabel?: string;
  /** Phase 21 — 'cardiac' | 'spo2' | 'nibp' | 'metabolic' | 'neuro' | 'hardware' */
  category?: 'cardiac' | 'spo2' | 'nibp' | 'metabolic' | 'neuro' | 'hardware' | 'arrhythmia';
}

/**
 * VitalSign card — Phase 21 redesign
 *
 * Inspired by Philips IntelliVue MX / Mindray T8 patient monitors:
 *  - Square-ish compact card (works in 6-col grid on phones)
 *  - Color-coded category stripe along the top edge
 *  - Mono tabular-nums value, big and centered
 *  - Tiny unit label at the bottom-right
 *  - Subtle 1 px border, near-black background, no glow
 */

const CATEGORY_COLORS: Record<string, { stripe: string; value: string; label: string }> = {
  cardiac:    { stripe: '#22c55e', value: '#22c55e', label: '#a7f3d0' }, // emerald
  spo2:       { stripe: '#22d3ee', value: '#22d3ee', label: '#a5f3fc' }, // cyan
  nibp:       { stripe: '#f87171', value: '#fca5a5', label: '#fecaca' }, // red
  arrhythmia: { stripe: '#facc15', value: '#facc15', label: '#fef08a' }, // amber
  metabolic:  { stripe: '#a78bfa', value: '#c4b5fd', label: '#ddd6fe' }, // violet
  neuro:      { stripe: '#60a5fa', value: '#93c5fd', label: '#bfdbfe' }, // blue
  hardware:   { stripe: '#94a3b8', value: '#cbd5e1', label: '#e2e8f0' }, // slate
};

const CATEGORY_BY_LABEL: Record<string, VitalSignProps['category']> = {
  'FRECUENCIA CARDÍACA': 'cardiac',
  'SPO2': 'spo2',
  'PRESIÓN ARTERIAL': 'nibp',
  'GLUCOSA (EST.)': 'metabolic',
  'COLEST./TRIGL. (EST.)': 'metabolic',
  'ARRITMIAS': 'arrhythmia',
  'RESPIRACIÓN': 'cardiac',
  'HRV (RMSSD)': 'neuro',
  'ESTRÉS': 'neuro',
  'LF/HF': 'neuro',
  'HEMOGLOBINA (EST.)': 'metabolic',
  'DFA α1': 'neuro',
};

const SHORT_BY_LABEL: Record<string, string> = {
  'FRECUENCIA CARDÍACA': 'HR',
  'SPO2': 'SpO₂',
  'PRESIÓN ARTERIAL': 'NIBP',
  'GLUCOSA (EST.)': 'GLU',
  'COLEST./TRIGL. (EST.)': 'LIPID',
  'ARRITMIAS': 'RHYTHM',
  'RESPIRACIÓN': 'RESP',
  'HRV (RMSSD)': 'HRV',
  'ESTRÉS': 'STRESS',
  'LF/HF': 'LF/HF',
  'HEMOGLOBINA (EST.)': 'Hb',
  'DFA α1': 'DFAα1',
};

const VitalSign = ({
  label,
  value,
  unit,
  highlighted = false,
  calibrationProgress,
  confidenceLevel,
  featureQuality,
  shortLabel,
  category,
}: VitalSignProps) => {
  const [showDetails, setShowDetails] = useState(false);

  const cat = category ?? CATEGORY_BY_LABEL[label] ?? 'hardware';
  const colors = CATEGORY_COLORS[cat];
  const sLabel = shortLabel ?? SHORT_BY_LABEL[label] ?? label;
  const isArrhytmia = label === 'ARRITMIAS';
  const isPlaceholder = typeof value === 'string' && (value === '--' || value === '--/--');

  // For arrhythmia status string, render the parsed text instead of the raw "LABEL|count"
  const displayValue = isArrhytmia && typeof value === 'string'
    ? getArrhythmiaText(parseArrhythmiaStatus(value))
    : value;

  // Risk classification (kept minimal — only HR / NIBP / SpO2)
  let riskLabel = '';
  let riskClass = 'text-white/60';
  if (label === 'FRECUENCIA CARDÍACA' && typeof value === 'number') {
    if (value > 100) { riskLabel = 'TAQUI'; riskClass = 'text-amber-300'; }
    else if (value < 60 && value > 0) { riskLabel = 'BRADI'; riskClass = 'text-amber-300'; }
    else if (value > 0) { riskLabel = 'NORMAL'; riskClass = 'text-emerald-300'; }
  } else if (label === 'SPO2' && typeof value === 'number') {
    if (value < 90 && value > 0) { riskLabel = 'HIPOXEMIA'; riskClass = 'text-red-300'; }
    else if (value < 95 && value > 0) { riskLabel = 'BORDER'; riskClass = 'text-amber-300'; }
    else if (value > 0) { riskLabel = 'NORMAL'; riskClass = 'text-emerald-300'; }
  } else if (label === 'PRESIÓN ARTERIAL' && typeof value === 'string' && value.includes('/')) {
    const [s, d] = value.split('/').map(v => parseInt(v, 10));
    if (!isNaN(s) && !isNaN(d) && s > 0) {
      if (s >= 140 || d >= 90) { riskLabel = 'HIPER'; riskClass = 'text-red-300'; }
      else if (s < 90 || d < 60) { riskLabel = 'HIPO'; riskClass = 'text-amber-300'; }
      else { riskLabel = 'NORMAL'; riskClass = 'text-emerald-300'; }
    }
  }

  return (
    <div
      onClick={() => setShowDetails(!showDetails)}
      className={cn(
        'relative w-full h-full rounded-md cursor-pointer overflow-hidden select-none',
        'bg-black/85 transition-all duration-200',
        showDetails && 'ring-1 ring-white/30',
        highlighted && 'ring-1 ring-white/20',
      )}
      style={{
        border: '1px solid rgba(255,255,255,0.15)',
        minHeight: 70,
      }}
    >
      {/* Color category stripe (top edge) */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px]"
        style={{ background: colors.stripe }}
      />

      {/* Top-left: short clinical label */}
      <div className="absolute top-1 left-2 flex items-center gap-1">
        <span className="text-[10px] font-bold tracking-wide" style={{ color: colors.label }}>
          {sLabel}
        </span>
      </div>

      {/* Top-right: confidence badge for NIBP only */}
      {label === 'PRESIÓN ARTERIAL' && confidenceLevel && confidenceLevel !== 'INSUFFICIENT' && (
        <div className="absolute top-1 right-2">
          <span className={cn(
            'text-[8px] font-bold px-1 py-0.5 rounded-sm',
            confidenceLevel === 'HIGH'   ? 'bg-emerald-500/30 text-emerald-200' :
            confidenceLevel === 'MEDIUM' ? 'bg-amber-500/30 text-amber-200' :
                                           'bg-orange-500/30 text-orange-200',
          )}>
            {confidenceLevel}
          </span>
        </div>
      )}

      {/* Center: big value */}
      <div className="absolute inset-x-1 top-1/2 -translate-y-1/2 flex items-baseline justify-center gap-1 overflow-hidden">
        <span
          className="font-mono tabular-nums font-bold leading-none truncate"
          style={{
            color: isPlaceholder ? 'rgba(255,255,255,0.35)' : colors.value,
            fontSize: typeof displayValue === 'string' && displayValue.length > 8
              ? '12px'
              : (typeof displayValue === 'string' && displayValue.length > 5)
                ? '16px'
                : '26px',
            textShadow: isPlaceholder ? 'none' : `0 0 8px ${colors.stripe}40`,
          }}
        >
          {displayValue}
        </span>
        {unit && (
          <span className="text-[9px] font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {unit}
          </span>
        )}
      </div>

      {/* Bottom-right: risk classification */}
      {riskLabel && (
        <div className={cn('absolute bottom-1 right-2 text-[8px] font-bold tracking-wider', riskClass)}>
          {riskLabel}
        </div>
      )}

      {/* Bottom-left: feature quality bar (NIBP only) */}
      {label === 'PRESIÓN ARTERIAL' && featureQuality !== undefined && featureQuality > 0 && (
        <div className="absolute bottom-1 left-2 flex items-center gap-1">
          <div className="w-6 h-[3px] bg-white/15 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                featureQuality >= 75 ? 'bg-emerald-400' :
                featureQuality >= 50 ? 'bg-amber-400' :
                                       'bg-orange-400',
              )}
              style={{ width: `${featureQuality}%` }}
            />
          </div>
        </div>
      )}

      {/* Calibration progress overlay */}
      {calibrationProgress !== undefined && calibrationProgress < 100 && (
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute bottom-0 left-0 h-[2px] bg-blue-500 transition-all duration-300 ease-out"
            style={{ width: `${calibrationProgress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default VitalSign;
