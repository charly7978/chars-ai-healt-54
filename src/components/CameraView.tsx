import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

type CameraDiagnosticCaps = MediaTrackCapabilities & {
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  zoom?: { min?: number; max?: number } | number;
  exposureCompensation?: { min?: number; max?: number; step?: number };
};

/**
 * CÁMARA PPG OPTIMIZADA
 *
 * Objetivos:
 * 1. Priorizar cámara trasera principal (evitar selfie / macro / depth)
 * 2. Activar torch de forma robusta cuando el dispositivo lo soporte
 * 3. Reducir hunting de auto-focus / auto-exposure que arruina la señal PPG
 * 4. Exponer el video element para el pipeline de captura
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
  onStreamReady,
  isMonitoring,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current
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

    const getTrackLabel = (track: MediaStreamTrack | undefined) => {
      return track?.label?.toLowerCase() ?? '';
    };

    const isProbablyFrontCamera = (track: MediaStreamTrack | undefined) => {
      const label = getTrackLabel(track);
      return /front|frontal|user|selfie/.test(label);
    };

    const selectBestBackCamera = async (): Promise<string | null> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        if (!videoDevices.length) return null;

        const ranked = videoDevices
          .map(device => ({
            device,
            score: scoreBackCameraLabel(device.label || ''),
          }))
          .sort((a, b) => b.score - a.score);

        for (const entry of ranked) {
          if (entry.score < 0) continue;

          try {
            const probeStream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                deviceId: { exact: entry.device.deviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
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

    const applyPPGTrackTuning = async (track: MediaStreamTrack) => {
      const caps = getTrackCapabilities(track);
      if (!caps) return false;

      const advanced: any = {};

      if (Array.isArray(caps.focusMode)) {
        if (caps.focusMode.includes('manual')) advanced.focusMode = 'manual';
        else if (caps.focusMode.includes('single-shot')) advanced.focusMode = 'single-shot';
        else if (caps.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
      }

      if (Array.isArray(caps.exposureMode)) {
        if (caps.exposureMode.includes('manual')) advanced.exposureMode = 'manual';
        else if (caps.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
      }

      if (Array.isArray(caps.whiteBalanceMode)) {
        if (caps.whiteBalanceMode.includes('manual')) advanced.whiteBalanceMode = 'manual';
        else if (caps.whiteBalanceMode.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
      }

      if (typeof caps.zoom === 'object' && caps.zoom && 'min' in caps.zoom && 'max' in caps.zoom) {
        advanced.zoom = Math.max(caps.zoom.min ?? 1, Math.min(1, caps.zoom.max ?? 1));
      }

      if (caps.exposureCompensation && typeof caps.exposureCompensation === 'object') {
        const ec = caps.exposureCompensation;
        const lo = ec.min ?? -1;
        const hi = ec.max ?? 1;
        if (hi > lo) {
          advanced.exposureCompensation = lo + (hi - lo) * 0.58;
        }
      }

      const hasAdvancedParams = Object.keys(advanced).length > 0;
      if (!hasAdvancedParams) return false;

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
      width: { ideal: 1280, min: 640 },
      height: { ideal: 720, min: 480 },
      frameRate: { ideal: 30, min: 24, max: 30 },
      aspectRatio: { ideal: 16 / 9 },
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

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;

      await stopCamera();
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

      try {
        // 1) Abrir rápidamente cámara trasera ideal para destrabar permisos y labels
        let stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: buildPreferredConstraints(null),
        });

        let track = stream.getVideoTracks()[0];
        const initialLabel = getTrackLabel(track);

        // 2) Si por heurística parece frontal, re-seleccionar cámara trasera principal ya con labels visibles
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

        // Pequeño warm-up para estabilizar AE/AF antes de torch
        await new Promise(resolve => setTimeout(resolve, 450));

        await applyPPGTrackTuning(track);
        const torchActivated = await enableTorchRobustly(track);

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
        });

        onStreamReady?.(stream);
      } catch (primaryError) {
        console.error('❌ Error abriendo cámara con perfil PPG:', primaryError);

        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: 'environment',
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30 },
            }
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
          await enableTorchRobustly(track);
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
