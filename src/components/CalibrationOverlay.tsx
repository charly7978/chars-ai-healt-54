/**
 * CALIBRATION OVERLAY
 * Interfaz visual durante la calibración de 5 segundos
 */

import React from 'react';
import { CalibrationState } from '../modules/calibration/CalibrationManager';
import { CalibrationStats } from '../hooks/useCalibration';

interface CalibrationOverlayProps {
  isVisible: boolean;
  progress: number;
  state: CalibrationState;
  signalQuality: 'good' | 'medium' | 'poor' | 'none';
  realtimeStats: CalibrationStats;
  confidence?: number;
  onCancel?: () => void;
}

export const CalibrationOverlay: React.FC<CalibrationOverlayProps> = ({
  isVisible,
  progress,
  state,
  signalQuality,
  realtimeStats,
  confidence,
  onCancel
}) => {
  if (!isVisible) return null;

  const getQualityColor = () => {
    switch (signalQuality) {
      case 'good': return 'bg-green-500';
      case 'medium': return 'bg-yellow-500';
      case 'poor': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getQualityText = () => {
    switch (signalQuality) {
      case 'good': return 'Señal óptima';
      case 'medium': return 'Ajusta posición';
      case 'poor': return 'Señal débil';
      default: return 'Sin señal';
    }
  };

  const getStateIcon = () => {
    switch (state) {
      case 'COLLECTING':
        return (
          <svg className="w-16 h-16 text-blue-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        );
      case 'ANALYZING':
        return (
          <svg className="w-16 h-16 text-yellow-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'COMPLETE':
        return (
          <svg className="w-16 h-16 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'FAILED':
        return (
          <svg className="w-16 h-16 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return null;
    }
  };

  const getMessage = () => {
    switch (state) {
      case 'COLLECTING':
        return 'Mantén el dedo sobre la cámara y el flash';
      case 'ANALYZING':
        return 'Analizando características de señal...';
      case 'COMPLETE':
        return '¡Calibración exitosa!';
      case 'FAILED':
        return 'Calibración fallida. Intenta de nuevo.';
      default:
        return '';
    }
  };

  const remainingSeconds = Math.ceil((100 - progress) / 20);

  return (
    <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center p-6">
      {/* Círculo de progreso */}
      <div className="relative w-40 h-40 mb-6">
        {/* Fondo del círculo */}
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="80"
            cy="80"
            r="70"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="8"
            fill="none"
          />
          <circle
            cx="80"
            cy="80"
            r="70"
            stroke={state === 'COMPLETE' ? '#22c55e' : state === 'FAILED' ? '#ef4444' : '#3b82f6'}
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 70}`}
            strokeDashoffset={`${2 * Math.PI * 70 * (1 - progress / 100)}`}
            className="transition-all duration-300"
          />
        </svg>
        
        {/* Icono central */}
        <div className="absolute inset-0 flex items-center justify-center">
          {state === 'COLLECTING' ? (
            <span className="text-4xl font-bold text-white">{remainingSeconds}s</span>
          ) : (
            getStateIcon()
          )}
        </div>
      </div>

      {/* Mensaje principal */}
      <h2 className="text-xl font-semibold text-white text-center mb-2">
        {state === 'COLLECTING' ? 'Calibrando...' : getMessage()}
      </h2>
      
      <p className="text-gray-400 text-center text-sm mb-6">
        {state === 'COLLECTING' ? getMessage() : ''}
      </p>

      {/* Indicador de calidad de señal */}
      {state === 'COLLECTING' && (
        <div className="w-full max-w-xs mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Calidad de señal</span>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${getQualityColor()} animate-pulse`} />
              <span className={`text-sm ${
                signalQuality === 'good' ? 'text-green-400' :
                signalQuality === 'medium' ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {getQualityText()}
              </span>
            </div>
          </div>
          
          {/* Barra de progreso */}
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${getQualityColor()}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats en tiempo real durante calibración */}
      {state === 'COLLECTING' && realtimeStats.samples > 0 && (
        <div className="grid grid-cols-3 gap-4 text-center mb-6">
          <div>
            <div className="text-lg font-mono text-red-400">{Math.round(realtimeStats.avgRed)}</div>
            <div className="text-xs text-gray-500">Rojo</div>
          </div>
          <div>
            <div className="text-lg font-mono text-green-400">{Math.round(realtimeStats.avgGreen)}</div>
            <div className="text-xs text-gray-500">Verde</div>
          </div>
          <div>
            <div className="text-lg font-mono text-blue-400">{realtimeStats.rgRatio.toFixed(2)}</div>
            <div className="text-xs text-gray-500">R/G</div>
          </div>
        </div>
      )}

      {/* Confianza al completar */}
      {state === 'COMPLETE' && confidence !== undefined && (
        <div className="bg-green-900/30 border border-green-500/30 rounded-lg px-4 py-2 mb-6">
          <span className="text-green-400 font-semibold">{confidence}% confianza</span>
        </div>
      )}

      {/* Botón cancelar */}
      {(state === 'COLLECTING' || state === 'FAILED') && onCancel && (
        <button
          onClick={onCancel}
          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          {state === 'FAILED' ? 'Cerrar' : 'Cancelar'}
        </button>
      )}
    </div>
  );
};
