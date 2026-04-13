import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getDiagnostics: () => CameraDiagnostics;
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
  });

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getDiagnostics: () => ({ ...diagnosticsRef.current }),
  }), []);

  useEffect(() => {
    let mounted = true;

    const stopCamera = async () => {
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

    /** Permiso + etiquetas: en PC no hay cámara "environment"; hay que probar varias restricciones. */
    const openTempStreamForPermission = async (): Promise<boolean> => {
      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: 'environment' } },
        { video: { facingMode: 'user' } },
        { video: { width: { ideal: 640 }, height: { ideal: 480 } } },
        { video: true },
      ];
      for (const c of attempts) {
        try {
          const s = await navigator.mediaDevices.getUserMedia(c);
          s.getTracks().forEach(t => t.stop());
          return true;
        } catch {
          /* siguiente intento */
        }
      }
      return false;
    };

    // PHASE 1: Elegir mejor cámara trasera (móvil) o la única disponible (PC)
    const findMainBackCamera = async (): Promise<string | null> => {
      const ok = await openTempStreamForPermission();
      if (!ok) {
        console.warn('📷 Sin permiso de cámara o getUserMedia rechazado');
        return null;
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('📷 Cameras:', videoDevices.map(d => d.label || d.deviceId));

        if (videoDevices.length === 0) return null;

        // Una sola cámara (webcam PC): usar su deviceId
        if (videoDevices.length === 1) {
          const d = videoDevices[0]!;
          diagnosticsRef.current.deviceLabel = d.label || 'Cámara';
          return d.deviceId;
        }

        // Móvil / varias cámaras: buscar trasera con linterna
        for (const device of videoDevices) {
          const label = device.label.toLowerCase();
          if (label.includes('back') || label.includes('rear') || label.includes('environment') ||
            label.includes('trasera') || label.includes('camera 0') || label.includes('camera0')) {
            try {
              const ts = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { ideal: device.deviceId } }
              });
              const track = ts.getVideoTracks()[0];
              const caps = track.getCapabilities?.() as any;
              const hasTorch = caps?.torch === true;
              ts.getTracks().forEach(t => t.stop());
              if (hasTorch) {
                console.log('✅ Main camera found:', device.label);
                diagnosticsRef.current.deviceLabel = device.label;
                return device.deviceId;
              }
            } catch {}
          }
        }

        for (const device of videoDevices) {
          try {
            const ts = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { ideal: device.deviceId } }
            });
            const track = ts.getVideoTracks()[0];
            const caps = track.getCapabilities?.() as any;
            ts.getTracks().forEach(t => t.stop());
            if (caps?.torch === true) {
              diagnosticsRef.current.deviceLabel = device.label;
              return device.deviceId;
            }
          } catch {}
        }
        return null;
      } catch {
        return null;
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
        // PHASE 1
        const cameraId = await findMainBackCamera();

        // PHASE 2: `ideal` en deviceId evita OverconstrainedError; sin facingMode si no hay cameraId (PC).
        const baseConstraints: MediaTrackConstraints = cameraId
          ? {
              deviceId: { ideal: cameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 }
            }
          : {
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 }
            };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: baseConstraints });
        } catch {
          console.warn('Fallback cámara 480p / 30fps');
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: cameraId
                ? { deviceId: { ideal: cameraId }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
                : { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }
            });
          } catch {
            console.warn('Fallback video: true');
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: cameraId ? { deviceId: { ideal: cameraId } } : true
            });
          }
        }

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

        // PHASE 3: Activate torch
        await new Promise(r => setTimeout(r, 400));
        const caps = track.getCapabilities?.() as any;
        diagnosticsRef.current.hasTorch = caps?.torch === true;

        if (caps?.torch) {
          let torchOk = false;
          for (let attempt = 0; attempt < 5 && !torchOk; attempt++) {
            try {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              torchOk = true;
              diagnosticsRef.current.torchActive = true;
              console.log('🔦 Torch ON');
            } catch {
              await new Promise(r => setTimeout(r, 250));
            }
          }
          if (!torchOk) console.warn('⚠️ Torch failed after 5 attempts');
        }

        // PHASE 4: Fine lock — apply each independently, log what succeeds
        await new Promise(r => setTimeout(r, 300));
        
        const tryConstraint = async (name: string, value: any): Promise<boolean> => {
          try {
            await track.applyConstraints({ advanced: [{ [name]: value } as any] });
            return true;
          } catch {
            return false;
          }
        };

        // Frame rate lock
        await tryConstraint('frameRate', 30);

        // Exposure
        if (caps?.exposureMode?.includes('manual')) {
          diagnosticsRef.current.exposureLocked = await tryConstraint('exposureMode', 'manual');
        } else if (caps?.exposureMode?.includes('continuous')) {
          await tryConstraint('exposureMode', 'continuous');
        }

        if (caps?.exposureCompensation) {
          const min = caps.exposureCompensation.min ?? -2;
          const max = caps.exposureCompensation.max ?? 2;
          const target = Math.max(min, Math.min(max, -0.35));
          await tryConstraint('exposureCompensation', target);
        }

        // White balance
        if (caps?.whiteBalanceMode?.includes('manual')) {
          diagnosticsRef.current.wbLocked = await tryConstraint('whiteBalanceMode', 'manual');
        }

        // ISO
        if (caps?.iso) {
          const minISO = caps.iso.min ?? 50;
          const maxISO = caps.iso.max ?? 400;
          const targetISO = Math.max(minISO, Math.min(maxISO, 140));
          if (await tryConstraint('iso', targetISO)) {
            diagnosticsRef.current.isoValue = targetISO;
          }
        }

        // Focus
        if (caps?.focusMode?.includes('manual')) {
          diagnosticsRef.current.focusLocked = await tryConstraint('focusMode', 'manual');
        } else if (caps?.focusMode?.includes('continuous')) {
          await tryConstraint('focusMode', 'continuous');
        }

        // Log final settings
        const finalSettings = track.getSettings() as any;
        console.log('📹 Camera ready:', finalSettings.width, 'x', finalSettings.height,
          '@', finalSettings.frameRate, 'fps',
          '| Torch:', diagnosticsRef.current.torchActive,
          '| Exp:', diagnosticsRef.current.exposureLocked,
          '| WB:', diagnosticsRef.current.wbLocked,
          '| ISO:', diagnosticsRef.current.isoValue);

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
