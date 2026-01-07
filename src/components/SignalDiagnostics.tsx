import React, { useMemo, useRef } from 'react';

interface SignalDiagnosticsProps {
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  bpm: number;
  pulsatility?: number;
}

/**
 * Panel de diagnóstico visual para ver calidad de señal PPG
 * CRÍTICO: Muestra el componente AC que es clave para detectar latidos
 */
const SignalDiagnostics: React.FC<SignalDiagnosticsProps> = ({
  rawValue,
  filteredValue,
  quality,
  fingerDetected,
  bpm,
  pulsatility = 0
}) => {
  // Historial para calcular AC real (diferencia max-min en ventana)
  const historyRef = useRef<number[]>([]);
  
  // Calcular AC real: diferencia entre máximo y mínimo en ventana reciente
  const acValue = useMemo(() => {
    historyRef.current.push(rawValue);
    if (historyRef.current.length > 30) historyRef.current.shift();
    
    if (historyRef.current.length < 10) return 0;
    
    const recent = historyRef.current.slice(-20);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    return max - min;
  }, [rawValue]);
  
  // Determinar estado de señal basado en AC
  const getSignalStatus = () => {
    if (!fingerDetected) return { text: 'SIN DEDO', color: 'text-red-400', bg: 'bg-red-900/50' };
    if (acValue < 1) return { text: 'AC MUY BAJO', color: 'text-red-400', bg: 'bg-red-900/50' };
    if (acValue < 3) return { text: 'AC DÉBIL', color: 'text-orange-400', bg: 'bg-orange-900/50' };
    if (acValue < 8) return { text: 'MODERADA', color: 'text-yellow-400', bg: 'bg-yellow-900/50' };
    return { text: 'BUENA', color: 'text-green-400', bg: 'bg-green-900/50' };
  };

  const status = getSignalStatus();

  return (
    <div className={`fixed bottom-20 left-2 right-2 z-40 ${status.bg} backdrop-blur-sm rounded-lg p-3 border border-white/20`}>
      {/* Header con estado */}
      <div className="flex justify-between items-center mb-2">
        <span className={`text-sm font-bold ${status.color}`}>
          📊 {status.text}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/60">
            Dedo: {fingerDetected ? '✓' : '✗'}
          </span>
          <span className={`text-lg font-bold ${bpm > 0 ? 'text-green-400' : 'text-gray-500'}`}>
            {bpm > 0 ? `${bpm} BPM` : '-- BPM'}
          </span>
        </div>
      </div>
      
      {/* Métricas principales en grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {/* Señal Cruda */}
        <div>
          <div className="flex justify-between text-white/70 mb-0.5">
            <span>RAW (DC)</span>
            <span className="font-mono">{rawValue.toFixed(1)}</span>
          </div>
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-75"
              style={{ width: `${Math.min(100, (rawValue / 300) * 100)}%` }}
            />
          </div>
        </div>
        
        {/* COMPONENTE AC - LO MÁS IMPORTANTE */}
        <div>
          <div className="flex justify-between text-white/70 mb-0.5">
            <span className="font-bold text-yellow-300">⚡ AC (Pulso)</span>
            <span className="font-mono font-bold">{acValue.toFixed(2)}</span>
          </div>
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-75 ${
                acValue >= 5 ? 'bg-green-500' : 
                acValue >= 2 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, (acValue / 15) * 100)}%` }}
            />
          </div>
        </div>
        
        {/* Calidad */}
        <div>
          <div className="flex justify-between text-white/70 mb-0.5">
            <span>Calidad</span>
            <span className="font-mono">{quality.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-75 ${
                quality >= 50 ? 'bg-green-500' : 
                quality >= 20 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, quality)}%` }}
            />
          </div>
        </div>
        
        {/* Pulsatilidad del detector */}
        <div>
          <div className="flex justify-between text-white/70 mb-0.5">
            <span>Pulsatilidad</span>
            <span className="font-mono">{(pulsatility * 100).toFixed(1)}%</span>
          </div>
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-75 ${
                pulsatility >= 0.01 ? 'bg-green-500' : 
                pulsatility >= 0.003 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, pulsatility * 500)}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Indicador de diagnóstico */}
      <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-white/50">
        <div className="flex justify-between">
          <span>AC &gt; 5 = latidos detectables</span>
          <span className={acValue >= 5 ? 'text-green-400' : 'text-red-400'}>
            {acValue >= 5 ? '✓ Listo' : '✗ Ajustar dedo'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SignalDiagnostics;