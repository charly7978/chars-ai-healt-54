import React from 'react';

interface RGBDebugIndicatorProps {
  redAC: number;
  redDC: number;
  greenAC: number;
  greenDC: number;
  isMonitoring: boolean;
}

/**
 * INDICADOR RGB DEBUG
 * Muestra valores AC/DC crudos de la cámara en tiempo real
 */
const RGBDebugIndicator: React.FC<RGBDebugIndicatorProps> = ({
  redAC,
  redDC,
  greenAC,
  greenDC,
  isMonitoring
}) => {
  if (!isMonitoring) return null;

  // Calcular Ratio R para SpO2
  const ratioR = greenDC > 0 && greenAC > 0 
    ? (redAC / redDC) / (greenAC / greenDC) 
    : 0;

  // Calcular PI por canal
  const piRed = redDC > 0 ? (redAC / redDC) * 100 : 0;
  const piGreen = greenDC > 0 ? (greenAC / greenDC) * 100 : 0;

  // Indicador visual de intensidad AC
  const getACBarWidth = (ac: number) => Math.min(100, (ac / 5) * 100);

  return (
    <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/10 text-[10px] font-mono">
      {/* Header */}
      <div className="text-gray-400 text-center mb-1 border-b border-white/10 pb-1">
        RGB AC/DC DEBUG
      </div>
      
      {/* RED Channel */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-red-400 w-8">🔴 R:</span>
        <div className="flex-1">
          <div className="flex justify-between text-red-300">
            <span>AC: {redAC.toFixed(3)}</span>
            <span>DC: {redDC.toFixed(1)}</span>
            <span>PI: {piRed.toFixed(2)}%</span>
          </div>
          {/* Barra visual AC */}
          <div className="h-1 bg-gray-800 rounded-full mt-0.5 overflow-hidden">
            <div 
              className="h-full bg-red-500 transition-all duration-200"
              style={{ width: `${getACBarWidth(redAC)}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* GREEN Channel */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-green-400 w-8">🟢 G:</span>
        <div className="flex-1">
          <div className="flex justify-between text-green-300">
            <span>AC: {greenAC.toFixed(3)}</span>
            <span>DC: {greenDC.toFixed(1)}</span>
            <span>PI: {piGreen.toFixed(2)}%</span>
          </div>
          {/* Barra visual AC */}
          <div className="h-1 bg-gray-800 rounded-full mt-0.5 overflow-hidden">
            <div 
              className="h-full bg-green-500 transition-all duration-200"
              style={{ width: `${getACBarWidth(greenAC)}%` }}
            />
          </div>
        </div>
      </div>
      
      {/* Ratio R (para SpO2) */}
      <div className="flex justify-between items-center pt-1 border-t border-white/10 mt-1">
        <span className="text-blue-300">
          Ratio R: <span className="font-bold">{ratioR.toFixed(4)}</span>
        </span>
        <span className="text-purple-300">
          SpO2≈ <span className="font-bold">{ratioR > 0 ? (110 - 25 * ratioR).toFixed(1) : '--'}%</span>
        </span>
      </div>
    </div>
  );
};

export default RGBDebugIndicator;
