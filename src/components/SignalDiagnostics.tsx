import React from 'react';

interface SignalDiagnosticsProps {
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  bpm: number;
  pulsatility?: number;
}

/**
 * Panel de diagnóstico visual para ver calidad de señal en tiempo real
 */
const SignalDiagnostics: React.FC<SignalDiagnosticsProps> = ({
  rawValue,
  filteredValue,
  quality,
  fingerDetected,
  bpm,
  pulsatility = 0
}) => {
  // Determinar estado de señal
  const getSignalStatus = () => {
    if (!fingerDetected) return { text: 'SIN DEDO', color: 'text-red-400', bg: 'bg-red-900/30' };
    if (quality < 20) return { text: 'DÉBIL', color: 'text-orange-400', bg: 'bg-orange-900/30' };
    if (quality < 50) return { text: 'MODERADA', color: 'text-yellow-400', bg: 'bg-yellow-900/30' };
    return { text: 'BUENA', color: 'text-green-400', bg: 'bg-green-900/30' };
  };

  const status = getSignalStatus();
  
  // Calcular diferencia entre raw y filtered (indica nivel de filtrado)
  const filterDiff = Math.abs(rawValue - filteredValue);
  const filterPercent = rawValue > 0 ? (filterDiff / rawValue * 100) : 0;

  return (
    <div className={`fixed bottom-20 left-2 right-2 z-40 ${status.bg} backdrop-blur-sm rounded-lg p-2 border border-white/10`}>
      {/* Header con estado */}
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-bold ${status.color}`}>
          📊 DIAGNÓSTICO: {status.text}
        </span>
        <span className="text-xs text-white/60">
          BPM: {bpm > 0 ? bpm.toFixed(0) : '--'}
        </span>
      </div>
      
      {/* Barras de señal */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        {/* Señal Cruda */}
        <div>
          <div className="flex justify-between text-white/70">
            <span>RAW</span>
            <span>{rawValue.toFixed(1)}</span>
          </div>
          <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-100"
              style={{ width: `${Math.min(100, (rawValue / 255) * 100)}%` }}
            />
          </div>
        </div>
        
        {/* Señal Filtrada */}
        <div>
          <div className="flex justify-between text-white/70">
            <span>FILTRADA</span>
            <span>{filteredValue.toFixed(1)}</span>
          </div>
          <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500 transition-all duration-100"
              style={{ width: `${Math.min(100, (filteredValue / 255) * 100)}%` }}
            />
          </div>
        </div>
        
        {/* Calidad */}
        <div>
          <div className="flex justify-between text-white/70">
            <span>CALIDAD</span>
            <span>{quality.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-100 ${
                quality >= 50 ? 'bg-green-500' : 
                quality >= 20 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, quality)}%` }}
            />
          </div>
        </div>
        
        {/* Pulsatilidad */}
        <div>
          <div className="flex justify-between text-white/70">
            <span>PULSO AC</span>
            <span>{(pulsatility * 100).toFixed(2)}%</span>
          </div>
          <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-100 ${
                pulsatility >= 0.01 ? 'bg-green-500' : 
                pulsatility >= 0.003 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, pulsatility * 1000)}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Indicadores adicionales */}
      <div className="flex justify-between mt-1 text-[9px] text-white/50">
        <span>Filtrado: {filterPercent.toFixed(1)}%</span>
        <span>Dedo: {fingerDetected ? '✓' : '✗'}</span>
      </div>
    </div>
  );
};

export default SignalDiagnostics;