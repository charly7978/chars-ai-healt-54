import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

type RangeCapability = { min?: number; max?: number; step?: number } | number | undefined;

type CameraDiagnosticCaps = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  zoom?: { min?: number; max?: number } | number;
  exposureCompensation?: { min?: number; max?: number; step?: number };
  brightness?: { min?: number; max?: number; step?: number };
  contrast?: { min?: number; max?: number; step?: number };
  saturation?: { min?: number; max?: number; step?: number };
  sharpness?: { min?: number; max?: number; step?: number };
  colorTemperature?: { min?: number; max?: number; step?: number };
  iso?: { min?: number; max?: number; step?: number };
};

/**
 * CAMERA VIEW — PPG-OPTIMIZED
 * 
 * CRITICAL: For contact PPG (finger + flash), the flash provides ABUNDANT light
 * through tissue. We must NOT boost exposure/ISO or the sensor saturates,
 * destroying the pulsatile AC component we need.
 * 
 * Best practices (Xuan et al. 2023, PMC10705321):
 * - Lock exposure to MODERATE values (avoid auto-gain that chases saturation)
 * - Lock white balance (prevent color shifts during measurement)
 * - Lock focus (prevent hunting)
 * - ISO should be LOW to avoid amplifying shot noise
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({ onStreamReady, isMonitoring }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
  }), []);

  useEffect(() => {
    let mounted = true;

    const safeApplyConstraints = async (track: MediaStreamTrack, constraints: MediaTrackConstraints) => {
      try {
        await track.applyConstraints(constraints);
        return true;
      } catch (error) {
        console.warn('⚠️ Constraints avanzadas no soportadas:', error);
        return false;
      }
    };

    const stopCamera = async () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getVideoTracks()) {
          try {
            const caps = track.getCapabilities?.() as CameraDiagnosticCaps | undefined;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.pause?.();
        videoRef.current.srcObject = null;
      }
      isStartingRef.current = false;
    };

    const scoreBackCameraLabel = (label: string): number => {
      const normalized = label.toLowerCase();
      let score = 0;
      if (/back|rear|environment|trasera|posterior/.test(normalized)) score += 50;
      if (/main|wide|primary|camera 0|camera0|back camera/.test(normalized)) score += 20;
      if (/ultra|macro|depth|tele|front|frontal|selfie|iris/.test(normalized)) score -= 35;
      if (/external|usb|virtual/.test(normalized)) score -= 25;
      return score;
    };

    const getTrackCapabilities = (track: MediaStreamTrack | undefined) => {
      try {
        return (track?.getCapabilities?.() as CameraDiagnosticCaps | undefined) ?? undefined;
      } catch { return undefined; }
    };

    const getTrackLabel = (track: MediaStreamTrack | undefined) => track?.label?.toLowerCase() ?? '';

    const isProbablyFrontCamera = (track: MediaStreamTrack | undefined) => {
      const label = getTrackLabel(track);
      return /front|frontal|user|selfie/.test(label);
    };

    const getRangeTarget = (capability: RangeCapability, ratio: number) => {
      if (typeof capability === 'number') return capability;
      if (!capability || typeof capability !== 'object') return undefined;
      const lo = capability.min ?? 0;
      const hi = capability.max ?? lo;
      return lo + (hi - lo) * ratio;
    };

    const selectBestBackCamera = async (): Promise<string | null> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        if (!videoDevices.length) return null;

        const ranked = videoDevices
          .map(device => ({ device, score: scoreBackCameraLabel(device.label || '') }))
          .sort((a, b) => b.score - a.score);

        for (const entry of ranked) {
          if (entry.score < 0) continue;
          try {
            const probeStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: entry.device.deviceId },
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30, max: 30 },
              }
            });
            const track = probeStream.getVideoTracks()[0];
            const caps = getTrackCapabilities(track);
            const labelScore = scoreBackCameraLabel(`${entry.device.label} ${track?.label || ''}`);
            const torchBonus = caps?.torch ? 25 : 0;
            const frontPenalty = isProbablyFrontCamera(track) ? -100 : 0;
            probeStream.getTracks().forEach(t => t.stop());
            if (labelScore + torchBonus + frontPenalty >= 20) {
              console.log('✅ Cámara trasera seleccionada:', entry.device.label || entry.device.deviceId);
              return entry.device.deviceId;
            }
          } catch {}
        }

        return ranked.find(entry => entry.score >= 0)?.device.deviceId ?? null;
      } catch {
        return null;
      }
    };

    /**
     * PPG-OPTIMAL CAMERA TUNING
     * 
     * Key principle: When flash illuminates through finger tissue,
     * the sensor receives ABUNDANT light (red channel often > 200).
     * We need LOW exposure and LOW ISO to avoid saturation.
     * 
     * Saturation = 0 pulsatile signal = 0 heartbeats detected.
     */
    const applyPPGTrackTuning = async (track: MediaStreamTrack, hasTorch: boolean) => {
      const caps = getTrackCapabilities(track);
      if (!caps) return false;

      const advanced: Record<string, any> = {};

      // Lock focus — prevent hunting during measurement
      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('manual')) advanced.focusMode = 'manual';
        else if (caps.focusMode.includes('single-shot')) advanced.focusMode = 'single-shot';
      }

      // Lock white balance — prevent color channel shifts
      if (Array.isArray(caps.whiteBalanceMode)) {
        if (caps.whiteBalanceMode.includes('manual')) advanced.whiteBalanceMode = 'manual';
        else if (caps.whiteBalanceMode.includes('single-shot')) advanced.whiteBalanceMode = 'single-shot';
      }

      // Exposure: use CONTINUOUS mode — let the camera auto-adjust
      // BUT set exposure compensation to NEGATIVE/LOW to prevent saturation
      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        advanced.exposureMode = 'continuous';
      }

      // Zoom to minimum
      if (typeof caps.zoom === 'object' && caps.zoom && 'min' in caps.zoom) {
        advanced.zoom = caps.zoom.min ?? 1;
      }

      // CRITICAL: Exposure compensation LOW — flash through finger is very bright
      // Use 15-25% of range (NOT 95% which causes complete saturation)
      if (hasTorch) {
        const expComp = getRangeTarget(caps.exposureCompensation, 0.20);
        if (typeof expComp === 'number' && Number.isFinite(expComp)) {
          advanced.exposureCompensation = expComp;
        }

        // ISO LOW — flash provides plenty of photons, high ISO just adds noise
        const iso = getRangeTarget(caps.iso, 0.15);
        if (typeof iso === 'number' && Number.isFinite(iso)) {
          advanced.iso = iso;
        }

        // Brightness LOW-MODERATE
        const brightness = getRangeTarget(caps.brightness, 0.30);
        if (typeof brightness === 'number' && Number.isFinite(brightness)) {
          advanced.brightness = brightness;
        }
      } else {
        // Without torch, use moderate settings
        const expComp = getRangeTarget(caps.exposureCompensation, 0.50);
        if (typeof expComp === 'number' && Number.isFinite(expComp)) {
          advanced.exposureCompensation = expComp;
        }
        const iso = getRangeTarget(caps.iso, 0.40);
        if (typeof iso === 'number' && Number.isFinite(iso)) {
          advanced.iso = iso;
        }
      }

      // Contrast and saturation: moderate
      const contrast = getRangeTarget(caps.contrast, 0.50);
      if (typeof contrast === 'number' && Number.isFinite(contrast)) {
        advanced.contrast = contrast;
      }

      const saturation = getRangeTarget(caps.saturation, 0.50);
      if (typeof saturation === 'number' && Number.isFinite(saturation)) {
        advanced.saturation = saturation;
      }

      if (!Object.keys(advanced).length) return false;
      return safeApplyConstraints(track, { advanced: [advanced] });
    };

    const enableTorchRobustly = async (track: MediaStreamTrack) => {
      const caps = getTrackCapabilities(track);
      if (!caps?.torch) {
        console.warn('⚠️ Esta cámara no soporta torch');
        return false;
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await track.applyConstraints({ advanced: [{ torch: true } as any] });
          await new Promise(resolve => setTimeout(resolve, 250));

          const settings = track.getSettings?.() as any;
          if (settings?.torch === true || settings?.torch === undefined) {
            console.log('🔦 Flash activado (intento', attempt + 1, ')');
            return true;
          }
        } catch (error) {
          console.warn(`🔦 Intento ${attempt + 1} fallido:`, error);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return false;
    };

    const buildPreferredConstraints = (deviceId?: string | null): MediaTrackConstraints => ({
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 640, min: 480 },
      height: { ideal: 480, min: 360 },
      frameRate: { ideal: 30, min: 24, max: 30 },
      aspectRatio: { ideal: 4 / 3 },
    });

    const ensureVideoPlaying = async () => {
      if (!videoRef.current) return;
      const video = videoRef.current;
      await new Promise<void>((resolve) => {
        const finish = async () => {
          try { await video.play(); } catch {}
          resolve();
        };
        if (video.readyState >= 2) { finish(); return; }
        video.onloadedmetadata = () => finish();
      });
    };

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      await stopCamera();
      if (!mounted) { isStartingRef.current = false; return; }

      try {
        let stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildPreferredConstraints(null),
        });

        let track = stream.getVideoTracks()[0];
        const initialLabel = getTrackLabel(track);

        if (isProbablyFrontCamera(track) || /macro|depth|tele/.test(initialLabel)) {
          const betterDeviceId = await selectBestBackCamera();
          if (betterDeviceId) {
            stream.getTracks().forEach(t => t.stop());
            stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: buildPreferredConstraints(betterDeviceId),
            });
            track = stream.getVideoTracks()[0];
          }
        }

        if (!mounted) { stream.getTracks().forEach(t => t.stop()); isStartingRef.current = false; return; }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await ensureVideoPlaying();
        }

        // Wait for camera to stabilize before configuring
        await new Promise(resolve => setTimeout(resolve, 400));

        // Step 1: Enable torch FIRST
        const torchActivated = await enableTorchRobustly(track);
        
        // Step 2: Wait for auto-exposure to settle after torch
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 3: NOW apply PPG tuning with LOW exposure (after torch is on)
        await applyPPGTrackTuning(track, torchActivated);

        const settings = track.getSettings?.() as any;
        const caps = getTrackCapabilities(track);
        console.log('📹 Cámara lista para PPG:', {
          label: track.label,
          resolution: `${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`,
          torchActive: torchActivated,
          facingMode: settings?.facingMode,
          frameRate: settings?.frameRate,
          exposureComp: settings?.exposureCompensation,
          iso: settings?.iso,
          brightness: settings?.brightness,
        });

        onStreamReady?.(stream);
      } catch (error) {
        console.error('❌ Error abriendo cámara:', error);
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: buildPreferredConstraints(null),
          });
          if (!mounted) { fallback.getTracks().forEach(t => t.stop()); return; }
          streamRef.current = fallback;
          if (videoRef.current) {
            videoRef.current.srcObject = fallback;
            await ensureVideoPlaying();
          }
          const track = fallback.getVideoTracks()[0];
          const torchOn = await enableTorchRobustly(track);
          await new Promise(resolve => setTimeout(resolve, 500));
          await applyPPGTrackTuning(track, torchOn);
          onStreamReady?.(fallback);
        } catch (e2) {
          console.error('❌ Cámara fallback falló:', e2);
        }
      } finally {
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
