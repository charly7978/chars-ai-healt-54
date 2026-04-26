/**
 * HOOK DE INTEGRACIÓN FASE 1 - ORQUESTACIÓN DE MÓDULOS
 * 
 * Responsabilidades:
 * - Orquestar CameraService
 * - Orquestar RadiometricCalibration
 * - Orquestar FingerDetection
 * - Orquestar DynamicROI
 * - Orquestar PPGExtraction
 * - Gestionar ciclo de vida
 * - Proporcionar datos a UI
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CameraService, type CameraDiagnostics, type FingerState } from '../modules/camera/CameraService';
import { RadiometricCalibration, type DeviceCalibrationProfile } from '../modules/radiometric/RadiometricCalibration';
import { FingerDetection, type FingerDetectionResult } from '../modules/detection/FingerDetection';
import { DynamicROI, type ROIBox } from '../modules/roi/DynamicROI';
import { PPGExtraction, type PPGSample } from '../modules/extraction/PPGExtraction';

export interface PPGPhase1State {
  isInitialized: boolean;
  isProcessing: boolean;
  cameraReady: boolean;
  fingerState: FingerState;
  fingerReason: string;
  contactScore: number;
  motionScore: number;
  roiBox: ROIBox | null;
  roiLocked: boolean;
  roiLockReason: string;
  ppgSample: PPGSample | null;
  diagnostics: CameraDiagnostics | null;
  calibrationStatus: {
    isDarkCalibrated: boolean;
    isWhiteCalibrated: boolean;
    darkOffsetRGB: { r: number; g: number; b: number };
    whiteRefRGB: { r: number; g: number; b: number };
  };
  backend: 'CPU' | 'Canvas2D' | 'WebGL' | 'WebGPU';
  error: string | null;
}

export interface UsePPGPhase1Options {
  videoElement: HTMLVideoElement | null;
  enableDebug?: boolean;
  onSample?: (sample: PPGSample) => void;
  onError?: (error: string) => void;
}

export const usePPGPhase1 = (options: UsePPGPhase1Options) => {
  const { videoElement, enableDebug = true, onSample, onError } = options;

  // Estado principal
  const [state, setState] = useState<PPGPhase1State>({
    isInitialized: false,
    isProcessing: false,
    cameraReady: false,
    fingerState: 'NO_FINGER',
    fingerReason: '',
    contactScore: 0,
    motionScore: 0,
    roiBox: null,
    roiLocked: false,
    roiLockReason: '',
    ppgSample: null,
    diagnostics: null,
    calibrationStatus: {
      isDarkCalibrated: false,
      isWhiteCalibrated: false,
      darkOffsetRGB: { r: 0, g: 0, b: 0 },
      whiteRefRGB: { r: 255, g: 255, b: 255 },
    },
    backend: 'CPU',
    error: null,
  });

  // Referencias a módulos
  const cameraServiceRef = useRef<CameraService | null>(null);
  const radiometricCalibrationRef = useRef<RadiometricCalibration | null>(null);
  const fingerDetectionRef = useRef<FingerDetection | null>(null);
  const dynamicROIRef = useRef<DynamicROI | null>(null);
  const ppgExtractionRef = useRef<PPGExtraction | null>(null);

  // Canvas para captura de frames
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const updateIntervalRef = useRef(100); // 10Hz UI update

  // Inicializar módulos
  useEffect(() => {
    if (!videoElement) return;

    const initialize = async () => {
      try {
        console.log('🚀 Inicializando FASE 1...');

        // Crear canvas oculto para captura
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        canvasRef.current = canvas;

        // Inicializar módulos
        cameraServiceRef.current = new CameraService();
        radiometricCalibrationRef.current = new RadiometricCalibration();
        fingerDetectionRef.current = new FingerDetection();
        ppgExtractionRef.current = new PPGExtraction(radiometricCalibrationRef.current);

        // Intentar cargar perfil de calibración existente
        const deviceKey = 'default'; // Se actualizará después de iniciar cámara
        await radiometricCalibrationRef.current.loadProfile(deviceKey);

        setState(prev => ({
          ...prev,
          isInitialized: true,
          calibrationStatus: radiometricCalibrationRef.current!.getCalibrationStatus(),
        }));

        console.log('✅ Módulos inicializados');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Error inicializando módulos';
        console.error('❌ Error inicializando:', errorMsg);
        setState(prev => ({ ...prev, error: errorMsg }));
        onError?.(errorMsg);
      }
    };

    initialize();

    return () => {
      // Cleanup
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      cameraServiceRef.current?.stop();
    };
  }, [videoElement, onError]);

  // Iniciar cámara
  const startCamera = useCallback(async () => {
    if (!videoElement || !cameraServiceRef.current) return;

    try {
      console.log('📷 Iniciando cámara...');

      const success = await cameraServiceRef.current.start(videoElement, {
        onStreamReady: async (stream) => {
          console.log('✅ Stream listo');

          // Inicializar DynamicROI con resolución real
          const track = stream.getVideoTracks()[0];
          const settings = track.getSettings() as any;
          const width = settings.width || 640;
          const height = settings.height || 480;

          dynamicROIRef.current = new DynamicROI(width, height);

          // Cargar perfil de calibración con deviceKey real
          const diagnostics = cameraServiceRef.current!.getDiagnostics();
          const deviceKey = `${diagnostics.deviceLabel}_${width}x${height}`;
          await radiometricCalibrationRef.current!.loadProfile(deviceKey);

          setState(prev => ({
            ...prev,
            cameraReady: true,
            diagnostics,
            calibrationStatus: radiometricCalibrationRef.current!.getCalibrationStatus(),
            roiBox: dynamicROIRef.current!.getCurrentROI(),
          }));

          // Iniciar procesamiento de frames
          startProcessing();
        },
        onWarmUpComplete: () => {
          console.log('🔥 Warm-up completo');
        },
        onError: (error) => {
          console.error('❌ Error cámara:', error);
          setState(prev => ({ ...prev, error }));
          onError?.(error);
        },
      });

      if (!success) {
        throw new Error('No se pudo iniciar la cámara');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Error iniciando cámara';
      console.error('❌ Error:', errorMsg);
      setState(prev => ({ ...prev, error: errorMsg }));
      onError?.(errorMsg);
    }
  }, [videoElement, onError]);

  // Procesamiento de frames
  const startProcessing = useCallback(() => {
    const processFrame = () => {
      if (!videoElement || videoElement.readyState < 2) {
        animationFrameRef.current = requestAnimationFrame(processFrame);
        return;
      }

      const now = performance.now();
      const timeSinceLastUpdate = now - lastUpdateRef.current;

      // Capturar frame
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // 1. Detección de dedo
      const fingerResult = fingerDetectionRef.current!.process(imageData);
      const motionScore = fingerDetectionRef.current!.getMotionScore();

      // 2. ROI dinámico
      const roiResult = dynamicROIRef.current!.process(imageData, fingerResult.contactScore);

      // 3. Extracción PPG
      const ppgSample = ppgExtractionRef.current!.process(
        imageData,
        roiResult.roi,
        fingerResult.contactScore,
        motionScore,
        fingerResult.state
      );

      // Actualizar estado (throttled)
      if (timeSinceLastUpdate >= updateIntervalRef.current) {
        lastUpdateRef.current = now;

        setState(prev => ({
          ...prev,
          isProcessing: true,
          fingerState: fingerResult.state,
          fingerReason: fingerResult.reason,
          contactScore: fingerResult.contactScore,
          motionScore: motionScore,
          roiBox: roiResult.roi,
          roiLocked: roiResult.isLocked,
          roiLockReason: roiResult.lockReason,
          ppgSample,
          diagnostics: cameraServiceRef.current!.getDiagnostics(),
          calibrationStatus: radiometricCalibrationRef.current!.getCalibrationStatus(),
        }));

        onSample?.(ppgSample);
      }

      animationFrameRef.current = requestAnimationFrame(processFrame);
    };

    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [videoElement, onSample]);

  // Detener procesamiento
  const stopProcessing = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    cameraServiceRef.current?.stop();
    setState(prev => ({
      ...prev,
      isProcessing: false,
      cameraReady: false,
    }));
  }, []);

  // Calibración dark
  const calibrateDark = useCallback(async () => {
    if (!videoElement || !radiometricCalibrationRef.current) return;

    console.log('🌑 Iniciando calibración dark...');

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const framesNeeded = 30;
    for (let i = 0; i < framesNeeded; i++) {
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      radiometricCalibrationRef.current.captureDarkFrame(imageData);
      await new Promise(r => setTimeout(r, 50));
    }

    radiometricCalibrationRef.current.calculateDarkOffset();

    setState(prev => ({
      ...prev,
      calibrationStatus: radiometricCalibrationRef.current!.getCalibrationStatus(),
    }));

    console.log('✅ Calibración dark completa');
  }, [videoElement]);

  // Calibración white
  const calibrateWhite = useCallback(async () => {
    if (!videoElement || !radiometricCalibrationRef.current) return;

    console.log('💡 Iniciando calibración white...');

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const framesNeeded = 60;
    for (let i = 0; i < framesNeeded; i++) {
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = radiometricCalibrationRef.current.captureWhiteFrame(imageData);
      
      if (result.saturated) {
        console.warn('⚠️ Saturación detectada en frame white');
      }
      
      await new Promise(r => setTimeout(r, 50));
    }

    radiometricCalibrationRef.current.calculateWhiteRef();

    setState(prev => ({
      ...prev,
      calibrationStatus: radiometricCalibrationRef.current!.getCalibrationStatus(),
    }));

    console.log('✅ Calibración white completa');
  }, [videoElement]);

  // Guardar perfil de calibración
  const saveCalibrationProfile = useCallback(async () => {
    if (!cameraServiceRef.current || !radiometricCalibrationRef.current) return;

    const diagnostics = cameraServiceRef.current.getDiagnostics();
    const calibrationStatus = radiometricCalibrationRef.current.getCalibrationStatus();

    if (!calibrationStatus.isDarkCalibrated || !calibrationStatus.isWhiteCalibrated) {
      console.warn('⚠️ Calibración incompleta, no se puede guardar perfil');
      return;
    }

    const profile = await radiometricCalibrationRef.current.calibrateDevice(
      diagnostics.deviceLabel,
      diagnostics.settings.width,
      diagnostics.settings.height,
      diagnostics.realFps,
      diagnostics.capabilities.hasTorch,
      diagnostics.capabilities.hasExposureMode,
      diagnostics.capabilities.hasIso,
      diagnostics.capabilities.hasWhiteBalanceMode
    );

    console.log('✅ Perfil de calibración guardado:', profile);
  }, []);

  // Resetear
  const reset = useCallback(() => {
    stopProcessing();
    fingerDetectionRef.current?.reset();
    dynamicROIRef.current?.reset(640, 480);
    ppgExtractionRef.current?.reset();
    radiometricCalibrationRef.current?.reset();

    setState({
      isInitialized: false,
      isProcessing: false,
      cameraReady: false,
      fingerState: 'NO_FINGER',
      fingerReason: '',
      contactScore: 0,
      motionScore: 0,
      roiBox: null,
      roiLocked: false,
      roiLockReason: '',
      ppgSample: null,
      diagnostics: null,
      calibrationStatus: {
        isDarkCalibrated: false,
        isWhiteCalibrated: false,
        darkOffsetRGB: { r: 0, g: 0, b: 0 },
        whiteRefRGB: { r: 255, g: 255, b: 255 },
      },
      backend: 'CPU',
      error: null,
    });
  }, [stopProcessing]);

  return {
    state,
    startCamera,
    stopProcessing,
    calibrateDark,
    calibrateWhite,
    saveCalibrationProfile,
    reset,
  };
};
