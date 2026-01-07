import React, { useMemo, useRef, useState, useEffect } from 'react';

interface SignalDiagnosticsProps {
  rawValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  bpm: number;
  pulsatility?: number;
}

/**
 * Panel de diagnóstico visual AVANZADO para debugging de señal PPG
 * Muestra: AC real, conteo de picos, estado del procesador
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
  const peakCountRef = useRef(0);
  const lastValuesRef = useRef<number[]>([]);
  const [localPeakCount, setLocalPeakCount] = useState(0);
  
  // Calcular AC real: diferencia entre máximo y mínimo en ventana reciente
  const acValue = useMemo(() => {
    historyRef.current.push(rawValue);
    if (historyRef.current.length > 60) historyRef.current.shift();
    
    if (historyRef.current.length < 15) return 0;
    
    const recent = historyRef.current.slice(-30);
    const max = Math.max(...recent);
    const min = Math.min(...recent);
    return max - min;
  }, [rawValue]);
  
  // Detectar picos locales para debugging
  useEffect(() => {
    lastValuesRef.current.push(filteredValue);
    if (lastValuesRef.current.length > 7) lastValuesRef.current.shift();
    
    if (lastValuesRef.current.length >= 7) {
      const vals = lastValuesRef.current;
      const mid = vals[3];
      // Pico simple: el valor del medio es mayor que los adyacentes
      if (mid > vals[0] && mid > vals[1] && mid > vals[2] && 
          mid > vals[4] && mid > vals[5] && mid > vals[6]) {
        peakCountRef.current++;
        setLocalPeakCount(peakCountRef.current);
      }
    }
  }, [filteredValue]);
  
  // Determinar estado de señal basado en AC y detección
  const getSignalStatus = () => {
    if (!fingerDetected) return { text: 'SIN DEDO', color: 'text-red-400', bg: 'bg-red-900/50' };
    if (acValue < 2) return { text: 'SIN PULSO', color: 'text-red-400', bg: 'bg-red-900/50' };
    if (acValue < 5) return { text: 'AC DÉBIL', color: 'text-orange-400', bg: 'bg-orange-900/50' };
    if (acValue < 10) return { text: 'MODERADA', color: 'text-yellow-400', bg: 'bg-yellow-900/50' };
    return { text: 'BUENA', color: 'text-green-400', bg: 'bg-green-900/50' };
  };

  const status = getSignalStatus();
  
  // Calcular variación reciente (para ver si hay movimiento)
  const dcValue = historyRef.current.length > 10 
    ? historyRef.current.slice(-10).reduce((a, b) => a + b, 0) / 10 
    : rawValue;

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
            <span className="font-mono">{dcValue.toFixed(1)}</span>
          </div>
          <div className="h-2 bg-black/40 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 transition-all duration-75"
              style={{ width: `${Math.min(100, (dcValue / 300) * 100)}%` }}
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
                acValue >= 8 ? 'bg-green-500' : 
                acValue >= 3 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(100, (acValue / 20) * 100)}%` }}
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
      
      {/* Indicador de diagnóstico con conteo de picos */}
      <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-white/50">
        <div className="flex justify-between">
          <span>
            Picos locales: <span className="text-cyan-400 font-bold">{localPeakCount}</span>
            {' | '}AC &gt; 5 = detectables
          </span>
          <span className={acValue >= 5 ? 'text-green-400' : 'text-red-400'}>
            {acValue >= 5 ? '✓ Listo' : '✗ Ajustar dedo'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default SignalDiagnostics;