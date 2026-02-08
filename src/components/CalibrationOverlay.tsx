import React from 'react';
import { Progress } from './ui/progress';

/**
 * OVERLAY DE CALIBRACIÓN
 * 
 * Pantalla que se muestra durante la calibración ZLO:
 * 1. Instrucciones de posicionamiento
 * 2. Barra de progreso
 * 3. Feedback de calidad
 */

interface CalibrationOverlayProps {
  isCalibrating: boolean;
  progress: number;
  fingerDetected: boolean;
  onSkip?: () => void;
}

const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  isCalibrating,
  progress,
  fingerDetected,
  onSkip
}) => {
  if (!isCalibrating) {
    return null;
  }
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6">
      <div className="max-w-sm w-full">
        {/* Icono animado */}
        <div className="text-center mb-6">
          <div className={`text-6xl ${fingerDetected ? 'animate-pulse' : 'animate-bounce'}`}>
            {fingerDetected ? '👆' : '📱'}
          </div>
        </div>
        
        {/* Título */}
        <h2 className="text-xl font-bold text-center text-white mb-4">
          {fingerDetected ? 'Calibrando...' : 'Coloque su dedo'}
        </h2>
        
        {/* Instrucciones */}
        <div className="space-y-3 mb-6">
          <div className={`flex items-center gap-3 ${fingerDetected ? 'opacity-50' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
              ${fingerDetected ? 'bg-emerald-500 text-white' : 'bg-white/20 text-white'}`}>
              {fingerDetected ? '✓' : '1'}
            </div>
            <span className="text-sm text-white/80">
              Coloque el dedo sobre la cámara trasera
            </span>
          </div>
          
          <div className={`flex items-center gap-3 ${!fingerDetected ? 'opacity-50' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
              ${progress > 30 ? 'bg-emerald-500 text-white' : 'bg-white/20 text-white'}`}>
              {progress > 30 ? '✓' : '2'}
            </div>
            <span className="text-sm text-white/80">
              Cubra completamente el flash LED
            </span>
          </div>
          
          <div className={`flex items-center gap-3 ${progress < 60 ? 'opacity-50' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
              ${progress >= 100 ? 'bg-emerald-500 text-white' : 'bg-white/20 text-white'}`}>
              {progress >= 100 ? '✓' : '3'}
            </div>
            <span className="text-sm text-white/80">
              Mantenga presión constante
            </span>
          </div>
        </div>
        
        {/* Barra de progreso */}
        <div className="mb-4">
          <Progress value={progress} className="h-3" />
          <p className="text-xs text-white/60 text-center mt-2">
            Calibración: {progress.toFixed(0)}%
          </p>
        </div>
        
        {/* Mensaje de estado */}
        <div className={`text-center py-3 rounded-lg mb-4 ${
          fingerDetected 
            ? 'bg-emerald-500/20 border border-emerald-500/50' 
            : 'bg-yellow-500/20 border border-yellow-500/50'
        }`}>
          <p className={`text-sm font-medium ${
            fingerDetected ? 'text-emerald-400' : 'text-yellow-400'
          }`}>
            {fingerDetected 
              ? '✓ Dedo detectado - Mantenga posición' 
              : '⚠ Posicione su dedo sobre la cámara'}
          </p>
        </div>
        
        {/* Botón de saltar */}
        {onSkip && (
          <button
            onClick={onSkip}
            className="w-full py-2 text-sm text-white/60 hover:text-white transition-colors"
          >
            Saltar calibración
          </button>
        )}
      </div>
    </div>
  );
};

export default CalibrationOverlay;
