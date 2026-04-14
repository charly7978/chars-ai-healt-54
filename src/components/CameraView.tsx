import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import {
  CameraControlEngine,
  type EffectiveCameraSettings,
  type CameraCapabilitiesSnapshot,
} from "@/modules/signal-processing/CameraControlEngine";
import { buildProgressiveConstraints, type NegotiatedConstraints } from "@/modules/camera/ConstraintNegotiator";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getDiagnostics: () => CameraDiagnostics;
  getCameraControl: () => CameraControlEngine;
}

export interface CameraDiagnostics {
  deviceLabel: string;
  hasTorch: boolean;
  torchActive: boolean;
  realFrameRate: number;
  resolution: { width: number; height: number };
  exposureLocked: boolean;
  wbLocked: boolean;
  focusLocked: boolean;
  isoValue: number;
  supportedConstraints: string[];
  effectiveSettings: EffectiveCameraSettings | null;
  capabilities: CameraCapabilitiesSnapshot | null;
  /** Fases de constraints que se aplicaron correctamente (torch, fps, AE, etc.) */
  phasesApplied: string[];
  /** Métricas de negociación de constraints adaptativa */
  negotiationMetrics?: {
    phaseAttempted: string;
    phaseSucceeded: string;
    attempts: number;
    finalResolution: { width: number; height: number } | null;
    finalFramerate: number | null;
    negotiationTimeMs: number;
  };
  /** Capabilities del dispositivo detectadas */
  deviceCapabilities?: {
    maxWidth: number;
    maxHeight: number;
    maxFramerate: number;
    supportsExposureMode: boolean;
    supportsWhiteBalanceMode: boolean;
    supportsFocusMode: boolean;
  };
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CAMERA PPG V2 — PHASED CONSTRAINT APPLICATION
 * 
 * Phase 1: Find best back camera with torch
 * Phase 2: Open stream with stable base constraints
 * Phase 3: Activate torch
 * Phase 4: Lock fine controls (exposure, WB, focus, ISO) with graceful degradation
 * Phase 5: Export diagnostics for processor
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
  onStreamReady,
  isMonitoring,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Evita reiniciar la cámara cuando el padre re-crea el callback (p. ej. al cambiar processFrame). */
  const onStreamReadyRef = useRef(onStreamReady);
  onStreamReadyRef.current = onStreamReady;
  const isStartingRef = useRef(false);
  const diagnosticsRef = useRef<CameraDiagnostics>({
    deviceLabel: '',
    hasTorch: false,
    torchActive: false,
    realFrameRate: 30,
    resolution: { width: 0, height: 0 },
    exposureLocked: false,
    wbLocked: false,
    focusLocked: false,
    isoValue: 0,
    supportedConstraints: [],
    effectiveSettings: null,
    capabilities: null,
    phasesApplied: [],
  });

  const cameraEngineRef = useRef<CameraControlEngine | null>(null);
  if (!cameraEngineRef.current) {
    cameraEngineRef.current = new CameraControlEngine();
  }

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getDiagnostics: () => ({ ...diagnosticsRef.current }),
    getCameraControl: () => cameraEngineRef.current!,
  }), []);

  useEffect(() => {
    let mounted = true;

    const stopCamera = async () => {
      cameraEngineRef.current?.attachTrack(null);
      if (streamRef.current) {
        for (const track of streamRef.current.getVideoTracks()) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
      isStartingRef.current = false;
    };

    /**
     * Adquisición de video con negociación adaptativa multi-fase (Etapa 1).
     * Usa ConstraintNegotiator para detectar capabilities y negociar progresivamente.
     */
    const acquireVideoStream = async (): Promise<MediaStream> => {
      const tryVideo = (video: MediaTrackConstraints | boolean) =>
        navigator.mediaDevices.getUserMedia({ audio: false, video: video as MediaTrackConstraints });

      let devices: MediaDeviceInfo[] = [];
      try {
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch {
        /* continuar con fallback genérico */
      }
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      console.log('📷 Dispositivos video:', videoInputs.length, videoInputs.map((d) => d.label || d.deviceId));

      // ═══ V3: Flujo robusto de adquisición de cámara ═══
      // Prioridad: facingMode:'environment' (trasera) → deviceId específico → fallback genérico
      // NO usar deviceId vacío (enumerateDevices sin permisos devuelve "")
      
      const firstDevice = videoInputs.length > 0 ? videoInputs[0]! : null;
      const hasValidDeviceId = firstDevice?.deviceId != null && firstDevice.deviceId.length > 4;
      if (firstDevice?.label) {
        diagnosticsRef.current.deviceLabel = firstDevice.label;
      }

      // Intento 1: facingMode environment (cámara trasera) — funciona sin deviceId
      try {
        console.log('📷 Intentando cámara trasera (facingMode: environment)...');
        return await tryVideo({
          facingMode: { ideal: 'environment' },
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, min: 15, max: 60 },
        });
      } catch (e1) {
        console.warn('📷 facingMode environment falló:', e1);
      }

      // Intento 2: deviceId específico si está disponible y no es vacío
      if (hasValidDeviceId) {
        try {
          console.log('📷 Intentando deviceId específico:', firstDevice!.deviceId.slice(0, 8) + '...');
          return await tryVideo({
            deviceId: { exact: firstDevice!.deviceId },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, min: 15, max: 30 },
          });
        } catch (e2) {
          console.warn('📷 deviceId específico falló:', e2);
        }
      }

      // Intento 3: constraints mínimos
      try {
        console.log('📷 Intentando constraints mínimos...');
        return await tryVideo({
          width: { ideal: 320 },
          height: { ideal: 240 },
          frameRate: { ideal: 24 },
        });
      } catch (e3) {
        console.warn('📷 Constraints mínimos fallaron:', e3);
      }

      // Intento 4: sin constraints (acepta cualquier cámara)
      console.log('📷 Último intento: sin constraints...');
      return await tryVideo(true);
    };

    const startCamera = async () => {
      // Si el track sigue vivo (re-ejecución del efecto sin cleanup real, o reconexión del <video>), no reiniciar getUserMedia.
      const existing = streamRef.current;
      const existingTrack = existing?.getVideoTracks?.()[0];
      if (existing && existingTrack && existingTrack.readyState === 'live' && mounted) {
        const video = videoRef.current;
        if (video) {
          if (video.srcObject !== existing) {
            video.srcObject = existing;
            try {
              await new Promise<void>((resolve) => {
                const v = video;
                const done = async () => {
                  v.removeEventListener('loadedmetadata', done);
                  try { await v.play(); } catch {}
                  resolve();
                };
                v.addEventListener('loadedmetadata', done);
                if (v.readyState >= 1) void done();
              });
            } catch {}
          } else {
            try { await video.play(); } catch {}
          }
        }
        onStreamReadyRef.current?.(existing);
        return;
      }

      if (isStartingRef.current) return;
      isStartingRef.current = true;
      await stopCamera();
      if (!mounted) { isStartingRef.current = false; return; }

      try {
        const stream = await acquireVideoStream();

        if (!mounted) { stream.getTracks().forEach(t => t.stop()); isStartingRef.current = false; return; }
        streamRef.current = stream;

        // Connect video — si metadata ya cargó, onloadedmetadata no dispara: hay que reproducir igual.
        if (videoRef.current) {
          const video = videoRef.current;
          video.srcObject = stream;
          const playSafe = async () => {
            try { await video.play(); } catch {}
          };
          if (video.readyState >= 1) {
            await playSafe();
          } else {
            await new Promise<void>((resolve) => {
              const onMeta = () => {
                video.removeEventListener('loadedmetadata', onMeta);
                void playSafe().then(() => resolve());
              };
              video.addEventListener('loadedmetadata', onMeta);
            });
          }
        }

        const track = stream.getVideoTracks()[0];
        if (!track) { isStartingRef.current = false; return; }

        if (!diagnosticsRef.current.deviceLabel && track.label) {
          diagnosticsRef.current.deviceLabel = track.label;
        }

        // Record supported constraints
        const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
        diagnosticsRef.current.supportedConstraints = Object.keys(supported).filter(k => (supported as any)[k]);

        // Record real settings
        const settings = track.getSettings() as any;
        diagnosticsRef.current.resolution = {
          width: settings.width || 0,
          height: settings.height || 0
        };
        diagnosticsRef.current.realFrameRate = settings.frameRate || 30;

        const engine = cameraEngineRef.current!;
        engine.attachTrack(track);
        await new Promise((r) => setTimeout(r, 400));
        const phases = await engine.applyIdealConstraints();
        diagnosticsRef.current.phasesApplied = phases;

        const capSnap = engine.getCapabilities();
        diagnosticsRef.current.capabilities = capSnap;
        diagnosticsRef.current.hasTorch = capSnap?.torch ?? false;

        const eff = engine.getEffectiveSettings();
        diagnosticsRef.current.effectiveSettings = eff;
        if (eff) {
          diagnosticsRef.current.resolution = { width: eff.width, height: eff.height };
          diagnosticsRef.current.realFrameRate = eff.frameRate;
          diagnosticsRef.current.torchActive = eff.torch;
          diagnosticsRef.current.isoValue = eff.iso;
          diagnosticsRef.current.exposureLocked = eff.exposureMode === 'manual';
          diagnosticsRef.current.wbLocked = eff.whiteBalanceMode === 'manual';
          diagnosticsRef.current.focusLocked = eff.focusMode === 'manual';
        }

        console.log(
          '📹 CameraControlEngine ready:',
          eff?.width,
          'x',
          eff?.height,
          '@',
          eff?.frameRate,
          'torch=',
          eff?.torch,
          'ec=',
          eff?.exposureCompensation
        );

        onStreamReadyRef.current?.(stream);
        isStartingRef.current = false;
      } catch (err) {
        console.error('❌ Camera error:', err);
        isStartingRef.current = false;
      }
    };

    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      mounted = false;
      stopCamera();
    };
  }, [isMonitoring]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 1,
        pointerEvents: "none",
      }}
    />
  );
});

CameraView.displayName = 'CameraView';
export default CameraView;
