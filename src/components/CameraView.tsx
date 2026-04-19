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
  // Phase 13 — runtime drift monitoring
  exposureDriftScore: number;     // 0..1
  exposureDriftWarning: boolean;  // true when EMA drift > 0.20
  initialIso?: number;
  initialExposureCompensation?: number;
  initialWhiteBalanceMode?: string;
  driftSamples?: number;
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
    exposureDriftScore: 0,
    exposureDriftWarning: false,
    driftSamples: 0,
  });
  const driftMonitorRef = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getDiagnostics: () => ({ ...diagnosticsRef.current }),
  }), []);

  useEffect(() => {
    let mounted = true;

    const stopCamera = async () => {
      // Phase 13 — clear drift monitor
      if (driftMonitorRef.current !== null) {
        clearInterval(driftMonitorRef.current);
        driftMonitorRef.current = null;
      }
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

    // PHASE 1: Find main back camera with torch
    const findMainBackCamera = async (): Promise<string | null> => {
      try {
        // Request minimal access first to get labels
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        tempStream.getTracks().forEach(t => t.stop());
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('📷 Cameras:', videoDevices.map(d => d.label || d.deviceId));

        // Try each back camera to find one with torch
        for (const device of videoDevices) {
          const label = device.label.toLowerCase();
          if (label.includes('back') || label.includes('rear') || label.includes('environment') ||
            label.includes('trasera') || label.includes('camera 0') || label.includes('camera0') ||
            videoDevices.length === 1) {
            try {
              const ts = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: device.deviceId } }
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

        // Fallback: any camera with torch
        for (const device of videoDevices) {
          try {
            const ts = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: device.deviceId } }
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
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      await stopCamera();
      if (!mounted) { isStartingRef.current = false; return; }

      try {
        // PHASE 1
        const cameraId = await findMainBackCamera();

        // PHASE 2: Open stream with stable base
        const baseConstraints: MediaTrackConstraints = cameraId
          ? {
              deviceId: { exact: cameraId },
              width: { ideal: 640, max: 960 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: 30, min: 24, max: 30 }
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 640, max: 960 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: 30, min: 24, max: 30 }
            };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: baseConstraints });
        } catch {
          console.warn('Fallback to simple constraints');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } }
          });
        }

        if (!mounted) { stream.getTracks().forEach(t => t.stop()); isStartingRef.current = false; return; }
        streamRef.current = stream;

        // Connect video
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise<void>((resolve) => {
            const video = videoRef.current!;
            video.onloadedmetadata = async () => {
              try { await video.play(); } catch {}
              resolve();
            };
          });
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

        // PHASE 2.5 (Phase 13) — capture a few "dark" frames BEFORE torch ON
        // and forward them to RadiometricProcessor.bootstrapDarkFrame via a
        // global event. Best-effort; failure does not stall the pipeline.
        try {
          await new Promise(r => setTimeout(r, 200));
          const v = videoRef.current;
          if (v && v.videoWidth > 0) {
            const c = document.createElement('canvas');
            c.width = 64; c.height = 48;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              for (let i = 0; i < 5; i++) {
                ctx.drawImage(v, 0, 0, c.width, c.height);
                const img = ctx.getImageData(0, 0, c.width, c.height);
                window.dispatchEvent(new CustomEvent('cppg:dark-frame', { detail: img }));
                await new Promise(r => setTimeout(r, 80));
              }
              console.log('🌑 5 dark frames captured for radiometric bootstrap');
            }
          }
        } catch { /* */ }

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
        diagnosticsRef.current.initialIso = finalSettings.iso ?? diagnosticsRef.current.isoValue;
        diagnosticsRef.current.initialExposureCompensation = finalSettings.exposureCompensation;
        diagnosticsRef.current.initialWhiteBalanceMode = finalSettings.whiteBalanceMode;
        console.log('📹 Camera ready:', finalSettings.width, 'x', finalSettings.height,
          '@', finalSettings.frameRate, 'fps',
          '| Torch:', diagnosticsRef.current.torchActive,
          '| Exp:', diagnosticsRef.current.exposureLocked,
          '| WB:', diagnosticsRef.current.wbLocked,
          '| ISO:', diagnosticsRef.current.isoValue);

        // Phase 13 — runtime drift monitor: every 5 s compare current
        // settings against initial; populate exposureDriftScore (EMA 0..1).
        // If drift > 0.20 over multiple checks, attempt to re-lock.
        const initial = {
          iso: diagnosticsRef.current.initialIso,
          ec: diagnosticsRef.current.initialExposureCompensation,
          wb: diagnosticsRef.current.initialWhiteBalanceMode,
        };
        let driftEMA = 0;
        let driftHits = 0;
        if (driftMonitorRef.current !== null) clearInterval(driftMonitorRef.current);
        driftMonitorRef.current = window.setInterval(async () => {
          try {
            const s = track.getSettings() as any;
            let drift = 0;
            let n = 0;
            if (initial.iso && s.iso) {
              drift += Math.abs(s.iso - initial.iso) / Math.max(1, initial.iso);
              n++;
            }
            if (initial.ec !== undefined && s.exposureCompensation !== undefined) {
              drift += Math.abs((s.exposureCompensation - initial.ec)) / 4; // ±2 stops range
              n++;
            }
            if (initial.wb && s.whiteBalanceMode && initial.wb !== s.whiteBalanceMode) {
              drift += 0.5; n++;
            }
            const norm = n > 0 ? Math.min(1, drift / n) : 0;
            driftEMA = driftEMA * 0.7 + norm * 0.3;
            diagnosticsRef.current.exposureDriftScore = driftEMA;
            diagnosticsRef.current.driftSamples = (diagnosticsRef.current.driftSamples ?? 0) + 1;
            const warn = driftEMA > 0.20;
            diagnosticsRef.current.exposureDriftWarning = warn;
            // Dispatch event so the PPG processor can penalize SQI in real time
            window.dispatchEvent(new CustomEvent('cppg:camera-drift', {
              detail: { score: driftEMA, warning: warn },
            }));

            if (warn) {
              driftHits++;
              if (driftHits >= 2) {
                // Re-apply lock attempt (cheap; failures ignored)
                if (initial.iso && initial.iso > 0) {
                  await track.applyConstraints({ advanced: [{ iso: initial.iso } as any] }).catch(() => {});
                }
                if (initial.ec !== undefined) {
                  await track.applyConstraints({ advanced: [{ exposureCompensation: initial.ec } as any] }).catch(() => {});
                }
                if (initial.wb === 'manual') {
                  await track.applyConstraints({ advanced: [{ whiteBalanceMode: 'manual' } as any] }).catch(() => {});
                }
                driftHits = 0;
              }
            } else {
              driftHits = 0;
            }
          } catch { /* */ }
        }, 5000);

        onStreamReady?.(stream);
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
  }, [isMonitoring, onStreamReady]);

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
