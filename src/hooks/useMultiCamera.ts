import { useState, useEffect, useRef, useCallback } from 'react';
import { MultiCameraManager } from '../modules/camera/MultiCameraManager';
import { MultiSignalProcessor } from '../modules/camera/MultiSignalProcessor';

interface MultiCameraState {
  isActive: boolean;
  activeCameras: number;
  averageQuality: number;
  isInitializing: boolean;
  error: string | null;
}

interface CombinedSignal {
  timestamp: number;
  redValue: number;
  greenValue: number;
  irValue: number;
  combinedQuality: number;
  activeCameras: number;
}

/**
 * Hook personalizado para gestionar múltiples cámaras en Android
 * Proporciona captura simultánea de señales PPG para máxima precisión
 */
export const useMultiCamera = () => {
  const [state, setState] = useState<MultiCameraState>({
    isActive: false,
    activeCameras: 0,
    averageQuality: 0,
    isInitializing: false,
    error: null
  });

  const multiCameraManager = useRef<MultiCameraManager>(new MultiCameraManager());
  const multiSignalProcessor = useRef<MultiSignalProcessor>(new MultiSignalProcessor());
  const onSignalCallback = useRef<((signal: CombinedSignal) => void) | null>(null);

  /**
   * Detecta si el dispositivo es Android y soporta múltiples cámaras
   */
  const isAndroidDevice = useCallback((): boolean => {
    const userAgent = navigator.userAgent || '';
    return /android/i.test(userAgent);
  }, []);

  /**
   * Inicializa el sistema de múltiples cámaras
   */
  const initializeMultiCamera = useCallback(async (): Promise<boolean> => {
    if (!isAndroidDevice()) {
      console.log('Dispositivo no Android - modo multicámara no disponible');
      return false;
    }

    setState(prev => ({ ...prev, isInitializing: true, error: null }));

    try {
      console.log('Inicializando sistema de múltiples cámaras...');
      
      const success = await multiCameraManager.current.initializeMultipleCameras();
      
      if (success) {
        const cameraCount = multiCameraManager.current.getActiveCameraCount();
        
        // Configurar procesador de señales
        multiSignalProcessor.current.setSignalCallback((combinedSignal) => {
          if (onSignalCallback.current) {
            onSignalCallback.current(combinedSignal);
          }
          
          // Actualizar estado con calidad promedio
          setState(prev => ({
            ...prev,
            averageQuality: combinedSignal.combinedQuality,
            activeCameras: combinedSignal.activeCameras
          }));
        });

        setState(prev => ({
          ...prev,
          isActive: true,
          activeCameras: cameraCount,
          isInitializing: false
        }));

        console.log(`Sistema multicámara inicializado con ${cameraCount} cámaras`);
        return true;
      } else {
        setState(prev => ({
          ...prev,
          isInitializing: false,
          error: 'No se pudieron inicializar las cámaras traseras'
        }));
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error desconocido';
      setState(prev => ({
        ...prev,
        isInitializing: false,
        error: errorMessage
      }));
      console.error('Error inicializando multicámara:', error);
      return false;
    }
  }, [isAndroidDevice]);

  /**
   * Inicia la captura de señales PPG de múltiples cámaras
   */
  const startCapture = useCallback(async (onSignal: (signal: CombinedSignal) => void): Promise<void> => {
    if (!state.isActive) {
      throw new Error('Sistema multicámara no inicializado');
    }

    onSignalCallback.current = onSignal;

    try {
      await multiCameraManager.current.startMultiCameraCapture((signals) => {
        multiSignalProcessor.current.processMultiCameraSignals(signals);
      });

      console.log('Captura multicámara iniciada');
    } catch (error) {
      console.error('Error iniciando captura multicámara:', error);
      throw error;
    }
  }, [state.isActive]);

  /**
   * Detiene la captura de múltiples cámaras
   */
  const stopCapture = useCallback(async (): Promise<void> => {
    try {
      await multiCameraManager.current.stopMultiCameraCapture();
      onSignalCallback.current = null;
      
      setState(prev => ({
        ...prev,
        isActive: false,
        activeCameras: 0,
        averageQuality: 0
      }));

      console.log('Captura multicámara detenida');
    } catch (error) {
      console.error('Error deteniendo captura multicámara:', error);
      throw error;
    }
  }, []);

  /**
   * Obtiene estadísticas detalladas de las cámaras
   */
  const getCameraStats = useCallback(() => {
    if (!state.isActive) return [];
    return multiCameraManager.current.getCameraStats();
  }, [state.isActive]);

  /**
   * Obtiene estadísticas del procesador de señales
   */
  const getProcessorStats = useCallback(() => {
    return multiSignalProcessor.current.getProcessorStats();
  }, []);

  /**
   * Limpia el historial de señales
   */
  const clearHistory = useCallback(() => {
    multiSignalProcessor.current.clearHistory();
  }, []);

  /**
   * Verifica si el dispositivo soporta múltiples cámaras
   */
  const checkMultiCameraSupport = useCallback(async (): Promise<boolean> => {
    if (!isAndroidDevice()) return false;

    try {
      const backCameras = await multiCameraManager.current.detectBackCameras();
      return backCameras.length > 1;
    } catch (error) {
      console.error('Error verificando soporte multicámara:', error);
      return false;
    }
  }, [isAndroidDevice]);

  // Cleanup al desmontar el componente
  useEffect(() => {
    return () => {
      if (state.isActive) {
        stopCapture().catch(console.error);
      }
    };
  }, [state.isActive, stopCapture]);

  return {
    // Estado
    isActive: state.isActive,
    activeCameras: state.activeCameras,
    averageQuality: state.averageQuality,
    isInitializing: state.isInitializing,
    error: state.error,
    isAndroidDevice: isAndroidDevice(),

    // Métodos
    initializeMultiCamera,
    startCapture,
    stopCapture,
    getCameraStats,
    getProcessorStats,
    clearHistory,
    checkMultiCameraSupport
  };
};