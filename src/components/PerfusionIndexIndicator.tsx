import React from 'react';

interface PerfusionIndexIndicatorProps {
  perfusionIndex: number;
  isMonitoring: boolean;
}

/**
 * INDICADOR DE PERFUSION INDEX (PI)
 * 
 * PI = (AC/DC) * 100 del canal verde
 * 
 * Rangos típicos:
 * - < 0.2%: Señal muy débil (sin dedo o mal contacto)
 * - 0.2 - 0.5%: Señal débil
 * - 0.5 - 2%: Señal normal
 * - 2 - 10%: Señal fuerte (buen contacto)
 * - > 10%: Señal excelente
 */
const PerfusionIndexIndicator: React.FC<PerfusionIndexIndicatorProps> = ({
  perfusionIndex,
  isMonitoring
}) => {
  // Determinar nivel de calidad basado en PI
  const getQualityInfo = (pi: number) => {
    if (pi < 0.1) return { level: 0, label: 'SIN SEÑAL', color: 'bg-gray-500', textColor: 'text-gray-400' };
    if (pi < 0.3) return { level: 1, label: 'MUY DÉBIL', color: 'bg-red-500', textColor: 'text-red-400' };
    if (pi < 0.6) return { level: 2, label: 'DÉBIL', color: 'bg-orange-500', textColor: 'text-orange-400' };
    if (pi < 1.5) return { level: 3, label: 'NORMAL', color: 'bg-yellow-500', textColor: 'text-yellow-400' };
    if (pi < 4) return { level: 4, label: 'BUENA', color: 'bg-green-500', textColor: 'text-green-400' };
    return { level: 5, label: 'EXCELENTE', color: 'bg-emerald-400', textColor: 'text-emerald-300' };
  };

  const quality = getQualityInfo(perfusionIndex);
  const displayPI = perfusionIndex > 0 ? perfusionIndex.toFixed(2) : '--';

  if (!isMonitoring) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10">
      {/* Icono de dedo */}
      <div className={`relative ${quality.level >= 3 ? 'animate-pulse' : ''}`}>
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 24 24" 
          fill="currentColor" 
          className={`w-5 h-5 ${quality.textColor}`}
        >
          <path d="M12 2c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2s-2-.9-2-2V4c0-1.1.9-2 2-2zm-4 8c0-1.1-.9-2-2-2s-2 .9-2 2v2c0 4.4 3.6 8 8 8s8-3.6 8-8v-2c0-1.1-.9-2-2-2s-2 .9-2 2v2c0 2.2-1.8 4-4 4s-4-1.8-4-4v-2z"/>
        </svg>
        {quality.level >= 3 && (
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 rounded-full animate-ping" />
        )}
      </div>

      {/* Barras de señal */}
      <div className="flex gap-0.5 items-end h-4">
        {[1, 2, 3, 4, 5].map((bar) => (
          <div
            key={bar}
            className={`w-1.5 rounded-sm transition-all duration-300 ${
              bar <= quality.level ? quality.color : 'bg-gray-700'
            }`}
            style={{ 
              height: `${bar * 3 + 4}px`,
              opacity: bar <= quality.level ? 1 : 0.3
            }}
          />
        ))}
      </div>

      {/* Valor numérico */}
      <div className="flex flex-col items-start">
        <span className={`text-xs font-mono font-bold ${quality.textColor}`}>
          PI: {displayPI}%
        </span>
        <span className={`text-[10px] ${quality.textColor} opacity-80`}>
          {quality.label}
        </span>
      </div>
    </div>
  );
};

export default PerfusionIndexIndicator;
