/**
 * MEASUREMENT STATUS COMPONENT
 * 
 * Muestra el estado principal de medición con mensajes claros
 * sobre por qué la medición está bloqueada o el progreso actual.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { SignalQualityState } from '../modules/gates/SignalQualityHardGate';
import type { VitalSignsAuthorization } from '../modules/gates/VitalSignsAuthorizationGate';

interface MeasurementStatusProps {
  signalQualityState: SignalQualityState;
  authorization: VitalSignsAuthorization;
  className?: string;
}

export const MeasurementStatus: React.FC<MeasurementStatusProps> = ({
  signalQualityState,
  authorization,
  className
}) => {
  const getMainStatus = () => {
    if (!authorization.authorized) {
      return {
        status: 'MEDICIÓN BLOQUEADA',
        message: getBlockedMessage(),
        color: 'text-red-400',
        bgColor: 'bg-red-500/10',
        borderColor: 'border-red-500/30'
      };
    }

    switch (signalQualityState) {
      case 'NO_TARGET':
        return {
          status: 'SIN SEÑAL BIOLÓGICA',
          message: 'Acercar dedo a la cámara con flash activado',
          color: 'text-gray-400',
          bgColor: 'bg-gray-500/10',
          borderColor: 'border-gray-500/30'
        };
      
      case 'NON_BIOLOGICAL_OBJECT':
        return {
          status: 'OBJETO NO BIOLÓGICO',
          message: 'Detectado objeto no compatible con tejido humano',
          color: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/30'
        };
      
      case 'POSSIBLE_FINGER_NO_PULSE':
        return {
          status: 'BUSCANDO PULSO ÓPTICO',
          message: 'Dedo detectado, verificando señal pulsátil...',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30'
        };
      
      case 'CONTACT_UNSTABLE':
        return {
          status: 'CONTACTO INESTABLE',
          message: 'Mantener dedo estable sobre la cámara',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30'
        };
      
      case 'LOW_PERFUSION':
        return {
          status: 'BAJA PERFUSIÓN',
          message: 'Presionar ligeramente o mejorar iluminación',
          color: 'text-yellow-400',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30'
        };
      
      case 'MOTION_ARTIFACT':
        return {
          status: 'MOVIMIENTO DETECTADO',
          message: 'Mantener dedo completamente quieto',
          color: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/30'
        };
      
      case 'SATURATED':
        return {
          status: 'SEÑAL SATURADA',
          message: 'Reducir presión o iluminación',
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30'
        };
      
      case 'SIGNAL_TOO_NOISY':
        return {
          status: 'SEÑAL RUIDOSA',
          message: 'Asegurar contacto firme y estable',
          color: 'text-orange-400',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/30'
        };
      
      case 'CALIBRATING':
        return {
          status: 'CALIBRANDO',
          message: 'Optimizando parámetros de medición...',
          color: 'text-blue-400',
          bgColor: 'bg-blue-500/10',
          borderColor: 'border-blue-500/30'
        };
      
      case 'PULSE_CANDIDATE':
        return {
          status: 'PULSO DETECTADO',
          message: 'Verificando calidad y estabilidad...',
          color: 'text-cyan-400',
          bgColor: 'bg-cyan-500/10',
          borderColor: 'border-cyan-500/30'
        };
      
      case 'LIVE_PULSE_CONFIRMED':
        return {
          status: 'PULSO VIVO CONFIRMADO',
          message: 'Estabilizando para medición precisa...',
          color: 'text-green-400',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/30'
        };
      
      case 'MEASUREMENT_READY':
        return {
          status: 'MEDICIÓN LISTA',
          message: 'Signos vitales autorizados y válidos',
          color: 'text-emerald-400',
          bgColor: 'bg-emerald-500/10',
          borderColor: 'border-emerald-500/30'
        };
      
      case 'MEASUREMENT_BLOCKED':
        return {
          status: 'MEDICIÓN BLOQUEADA',
          message: getBlockedMessage(),
          color: 'text-red-400',
          bgColor: 'bg-red-500/10',
          borderColor: 'border-red-500/30'
        };
      
      default:
        return {
          status: 'INICIANDO',
          message: 'Preparando sistema de medición...',
          color: 'text-gray-400',
          bgColor: 'bg-gray-500/10',
          borderColor: 'border-gray-500/30'
        };
    }
  };

  const getBlockedMessage = () => {
    if (authorization.reasons.length > 0) {
      return authorization.reasons[0]; // Mostrar la razón principal
    }
    return 'NO HAY SEÑAL BIOLÓGICA VÁLIDA';
  };

  const getProgressIndicator = () => {
    switch (signalQualityState) {
      case 'CALIBRATING':
      case 'PULSE_CANDIDATE':
      case 'LIVE_PULSE_CONFIRMED':
        return (
          <div className="flex items-center gap-2 mt-2">
            <div className="w-2 h-2 bg-current rounded-full animate-pulse" />
            <span className="text-xs opacity-75">Procesando...</span>
          </div>
        );
      
      case 'MEASUREMENT_READY':
        return (
          <div className="flex items-center gap-2 mt-2">
            <div className="w-2 h-2 bg-emerald-400 rounded-full" />
            <span className="text-xs opacity-75">Autorizado</span>
          </div>
        );
      
      default:
        return null;
    }
  };

  const getAuthorizationLevel = () => {
    switch (authorization.authorizationLevel) {
      case 'NONE':
        return null;
      case 'PULSE_ONLY':
        return (
          <div className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">
            Solo Frecuencia Cardíaca
          </div>
        );
      case 'LIMITED':
        return (
          <div className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded border border-yellow-500/30">
            Métricas Limitadas
          </div>
        );
      case 'FULL':
        return (
          <div className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/30">
            Métricas Completas
          </div>
        );
    }
  };

  const mainStatus = getMainStatus();

  return (
    <div className={cn(
      "relative p-4 rounded-lg border transition-all duration-300",
      mainStatus.bgColor,
      mainStatus.borderColor,
      className
    )}>
      {/* Estado principal */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className={cn(
            "text-lg font-bold mb-1",
            mainStatus.color
          )}>
            {mainStatus.status}
          </h3>
          <p className="text-sm text-white/70">
            {mainStatus.message}
          </p>
        </div>
        
        {/* Nivel de autorización */}
        {getAuthorizationLevel()}
      </div>

      {/* Indicador de progreso */}
      {getProgressIndicator()}

      {/* Detalles técnicos (solo si está bloqueado) */}
      {!authorization.authorized && authorization.reasons.length > 1 && (
        <details className="mt-3">
          <summary className="text-xs text-white/50 cursor-pointer hover:text-white/70">
            Ver razones técnicas
          </summary>
          <ul className="mt-2 text-xs text-white/40 space-y-1">
            {authorization.reasons.slice(1).map((reason, index) => (
              <li key={index} className="flex items-start gap-1">
                <span className="text-red-400 mt-0.5">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Evidencia de calidad */}
      {authorization.authorized && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-white/50">Confianza:</span>
              <span className="ml-1 text-white">
                {(authorization.evidence.overallConfidence * 100).toFixed(1)}%
              </span>
            </div>
            <div>
              <span className="text-white/50">SQI:</span>
              <span className="ml-1 text-white">
                {authorization.evidence.overallConfidence > 0.8 ? 
                  '≥0.85' : 
                  (authorization.evidence.overallConfidence * 0.85).toFixed(3)
                }
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeasurementStatus;
