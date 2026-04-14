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

      // Usar negociación adaptativa multi-fase si hay dispositivos
      if (videoInputs.length >= 1) {
        const d = videoInputs[0]!;
        diagnosticsRef.current.deviceLabel = d.label || 'Cámara';
        
        try {
          console.log('📷 Iniciando negociación adaptativa multi-fase...');
          const negotiated: NegotiatedConstraints = await buildProgressiveConstraints(d.deviceId);
          
          console.log('📷 Negociación completada:', {
            phaseSucceeded: negotiated.metrics?.phaseSucceeded,
            attempts: negotiated.metrics?.attempts,
            finalResolution: negotiated.metrics?.finalResolution,
            finalFramerate: negotiated.metrics?.finalFramerate,
            negotiationTimeMs: negotiated.metrics?.negotiationTimeMs,
            phases: negotiated.phases,
          });
          
          // Actualizar diagnósticos con métricas de negociación
          diagnosticsRef.current.negotiationMetrics = negotiated.metrics;
          diagnosticsRef.current.deviceCapabilities = negotiated.capabilities;
          diagnosticsRef.current.phasesApplied = negotiated.phases;
          
          return await tryVideo(negotiated.video);
        } catch (error) {
          console.warn('📷 Negociación adaptativa falló, usando fallback:', error);
          // Fallback a constraints manuales si la negociación falla
          try {
            return await tryVideo({
              deviceId: { ideal: d.deviceId },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30, min: 15, max: 30 },
            });
          } catch {
            return await tryVideo({ deviceId: { ideal: d.deviceId } });
          }
        }
      }

      if (videoInputs.length === 0) {
        try {
          return await tryVideo({
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, min: 15, max: 30 },
          });
        } catch {
          return await tryVideo(true);
        }
      }

      // Varias cámaras (móvil): una sola petición orientada a trasera; sin bucles que abran/cierren cada una.
      try {
        return await tryVideo({
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 60, min: 15, max: 60 },
        });
      } catch {
        try {
          return await tryVideo({
            facingMode: { ideal: 'user' },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 60, min: 15, max: 60 },
          });
        } catch {
          const first = videoInputs[0];
          if (first?.deviceId) {
            try {
              return await tryVideo({
                deviceId: { ideal: first.deviceId },
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 60, min: 15, max: 60 },
              });
            } catch {
              return await tryVideo({ deviceId: { ideal: first.deviceId } });
            }
          }
          return await tryVideo(true);
        }
      }
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
