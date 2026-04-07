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
        console.warn('⚠️ No se pudieron aplicar constraints avanzadas:', error);
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
      } catch {
        return undefined;
      }
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
          } catch (error) {
            console.warn('⚠️ Error probando cámara candidata:', error);
          }
        }

        const fallback = ranked.find(entry => entry.score >= 0)?.device.deviceId ?? null;
        if (fallback) {
          console.log('ℹ️ Usando fallback de cámara trasera');
        }
        return fallback;
      } catch (error) {
        console.warn('No se pudo enumerar dispositivos:', error);
        return null;
      }
    };

    const applyPPGTrackTuning = async (track: MediaStreamTrack, stage: 'preTorch' | 'postTorch' = 'preTorch') => {
      const caps = getTrackCapabilities(track);
      if (!caps) return false;

      const advanced: Record<string, any> = {};
      const exposureRatio = stage === 'postTorch' ? 0.95 : 0.78;
      const brightnessRatio = stage === 'postTorch' ? 0.88 : 0.68;

      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('single-shot')) advanced.focusMode = 'single-shot';
        else if (caps.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
      }

      if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
        advanced.exposureMode = 'continuous';
      }

      if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
        advanced.whiteBalanceMode = 'continuous';
      }

      if (typeof caps.zoom === 'object' && caps.zoom && 'min' in caps.zoom && 'max' in caps.zoom) {
        advanced.zoom = caps.zoom.min ?? 1;
      }

      const exposureCompensation = getRangeTarget(caps.exposureCompensation, exposureRatio);
      if (typeof exposureCompensation === 'number' && Number.isFinite(exposureCompensation)) {
        advanced.exposureCompensation = exposureCompensation;
      }

      const brightness = getRangeTarget(caps.brightness, brightnessRatio);
      if (typeof brightness === 'number' && Number.isFinite(brightness)) {
        advanced.brightness = brightness;
      }

      const iso = getRangeTarget(caps.iso, stage === 'postTorch' ? 0.74 : 0.58);
      if (typeof iso === 'number' && Number.isFinite(iso)) {
        advanced.iso = iso;
      }

      const contrast = getRangeTarget(caps.contrast, 0.58);
      if (typeof contrast === 'number' && Number.isFinite(contrast)) {
        advanced.contrast = contrast;
      }

      const saturation = getRangeTarget(caps.saturation, 0.62);
      if (typeof saturation === 'number' && Number.isFinite(saturation)) {
        advanced.saturation = saturation;
      }

      const sharpness = getRangeTarget(caps.sharpness, 0.45);
      if (typeof sharpness === 'number' && Number.isFinite(sharpness)) {
        advanced.sharpness = sharpness;
      }

      if (!Object.keys(advanced).length) return false;
      return safeApplyConstraints(track, { advanced: [advanced] });
    };

    const enableTorchRobustly = async (track: MediaStreamTrack) => {
      const caps = getTrackCapabilities(track);
      if (!caps?.torch) {
        console.warn('⚠️ Esta cámara no expone soporte torch');
        return false;
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await track.applyConstraints({ advanced: [{ torch: true } as any] });
          await new Promise(resolve => setTimeout(resolve, 220));

          const settings = track.getSettings?.() as any;
          const torchState = settings?.torch;
          if (torchState === true || torchState === undefined) {
            console.log('🔦 Flash activado');
            return true;
          }
        } catch (error) {
          console.warn(`🔦 Intento ${attempt + 1} de torch fallido:`, error);
        }
        await new Promise(resolve => setTimeout(resolve, 180));
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
          try {
            await video.play();
          } catch (error) {
            console.warn('⚠️ video.play() falló en primer intento:', error);
          }
          resolve();
        };

        if (video.readyState >= 2) {
          finish();
          return;
        }

        video.onloadedmetadata = () => {
          finish();
        };
      });
    };

    const prepareTrackForPPG = async (track: MediaStreamTrack) => {
      await applyPPGTrackTuning(track, 'preTorch');
      const torchActivated = await enableTorchRobustly(track);
      await new Promise(resolve => setTimeout(resolve, torchActivated ? 350 : 180));
      await applyPPGTrackTuning(track, torchActivated ? 'postTorch' : 'preTorch');
      if (!torchActivated) {
        await enableTorchRobustly(track);
      }
      return torchActivated;
    };

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;

      await stopCamera();
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

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

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          isStartingRef.current = false;
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await ensureVideoPlaying();
        }

        await new Promise(resolve => setTimeout(resolve, 320));
        const torchActivated = await prepareTrackForPPG(track);

        const settings = track.getSettings?.() as any;
        const caps = getTrackCapabilities(track);
        console.log('📹 Cámara lista:', {
          width: videoRef.current?.videoWidth,
          height: videoRef.current?.videoHeight,
          label: track.label,
          torchCapable: !!caps?.torch,
          torchActivated,
          facingMode: settings?.facingMode,
          frameRate: settings?.frameRate,
          exposureCompensation: settings?.exposureCompensation,
          brightness: settings?.brightness,
          iso: settings?.iso,
        });

        onStreamReady?.(stream);
      } catch (primaryError) {
        console.error('❌ Error abriendo cámara con perfil PPG:', primaryError);

        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: buildPreferredConstraints(null),
          });

          if (!mounted) {
            fallbackStream.getTracks().forEach(t => t.stop());
            return;
          }

          streamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await ensureVideoPlaying();
          }

          const track = fallbackStream.getVideoTracks()[0];
          await prepareTrackForPPG(track);
          onStreamReady?.(fallbackStream);
        } catch (fallbackError) {
          console.error('❌ Error cámara fallback:', fallbackError);
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