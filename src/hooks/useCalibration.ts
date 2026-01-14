/**
 * HOOK DE CALIBRACIÓN
 * Gestiona el estado y lógica de calibración automática
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  CalibrationManager, 
  CalibrationProfile, 
  CalibrationSample, 
  CalibrationState 
} from '../modules/calibration/CalibrationManager';

export interface CalibrationStats {
  avgRed: number;
  avgGreen: number;
  rgRatio: number;
  samples: number;
}

export const useCalibration = () => {
  const managerRef = useRef<CalibrationManager | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<CalibrationState>('IDLE');
  const [profile, setProfile] = useState<CalibrationProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStats, setRealtimeStats] = useState<CalibrationStats>({
    avgRed: 0,
    avgGreen: 0,
    rgRatio: 0,
    samples: 0
  });

  // Inicializar manager
  useEffect(() => {
    const manager = new CalibrationManager();
    
    manager.setCallbacks(
      // onProgress
      (prog, st) => {
        setProgress(prog);
        setState(st);
      },
      // onComplete
      (prof) => {
        setProfile(prof);
        setIsCalibrating(false);
        setState('COMPLETE');
        // Vibrar si está disponible
        if ('vibrate' in navigator) {
          navigator.vibrate([100, 50, 100]);
        }
      },
      // onFail
      (reason) => {
        setError(reason);
        setIsCalibrating(false);
        setState('FAILED');
      }
    );
    
    managerRef.current = manager;
    
    return () => {
      managerRef.current?.reset();
      managerRef.current = null;
    };
  }, []);

  /**
   * Iniciar calibración
   */
  const startCalibration = useCallback(() => {
    if (!managerRef.current) return;
    
    setError(null);
    setProfile(null);
    setProgress(0);
    setState('COLLECTING');
    setIsCalibrating(true);
    
    managerRef.current.start();
    console.log('[useCalibration] Calibración iniciada');
  }, []);

  /**
   * Agregar muestra durante calibración
   */
  const addSample = useCallback((sample: CalibrationSample) => {
    if (!managerRef.current || !isCalibrating) return;
    
    managerRef.current.addSample(sample);
    
    // Actualizar stats en tiempo real
    const stats = managerRef.current.getRealtimeStats();
    setRealtimeStats(stats);
  }, [isCalibrating]);

  /**
   * Cancelar calibración
   */
  const cancelCalibration = useCallback(() => {
    if (!managerRef.current) return;
    
    managerRef.current.reset();
    setIsCalibrating(false);
    setProgress(0);
    setState('IDLE');
    setError(null);
  }, []);

  /**
   * Reiniciar y recalibrar
   */
  const recalibrate = useCallback(() => {
    setProfile(null);
    startCalibration();
  }, [startCalibration]);

  /**
   * Verificar si la calibración fue exitosa
   */
  const isCalibrated = profile !== null && state === 'COMPLETE';

  /**
   * Obtener mensaje de estado
   */
  const getStatusMessage = useCallback((): string => {
    switch (state) {
      case 'IDLE':
        return 'Listo para calibrar';
      case 'COLLECTING':
        const seconds = Math.ceil((100 - progress) / 20);
        return `Calibrando... ${seconds}s`;
      case 'ANALYZING':
        return 'Analizando señal...';
      case 'COMPLETE':
        return `Calibrado (${profile?.confidence}% confianza)`;
      case 'FAILED':
        return error || 'Calibración fallida';
      default:
        return '';
    }
  }, [state, progress, profile, error]);

  /**
   * Obtener calidad de señal durante calibración
   */
  const getSignalQuality = useCallback((): 'good' | 'medium' | 'poor' | 'none' => {
    if (!isCalibrating) return 'none';
    
    const { avgRed, rgRatio } = realtimeStats;
    
    if (avgRed < 30 || rgRatio < 0.5) return 'poor';
    if (avgRed < 80 || rgRatio < 0.8 || rgRatio > 3) return 'medium';
    return 'good';
  }, [isCalibrating, realtimeStats]);

  return {
    // Estado
    isCalibrating,
    isCalibrated,
    progress,
    state,
    profile,
    error,
    realtimeStats,
    
    // Acciones
    startCalibration,
    addSample,
    cancelCalibration,
    recalibrate,
    
    // Utilidades
    getStatusMessage,
    getSignalQuality
  };
};
