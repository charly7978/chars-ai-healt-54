import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from "react";
import { CameraCapabilityManager, type CameraProfile } from "../modules/camera/CameraCapabilityManager";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getDiagnostics: () => CameraDiagnostics;
  getCameraProfile: () => CameraProfile | null;
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
  warmupComplete: boolean;
  frameRateStable: boolean;
  frameRateChanges: number;
  torchOffEvents: number;
  appliedConstraints: string[];
  failedConstraints: string[];
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CAMERA PPG V3 — CAMERA CAPABILITY MANAGER INTEGRATION
 * 
 * Phase 1: Find best back camera with torch
 * Phase 2: Open stream with stable base constraints
 * Phase 3: WARMUP (1.5-2.0s) - allow camera to stabilize
 * Phase 4: Activate torch with CameraCapabilityManager
 * Phase 5: Apply optimal constraints in sequence via CameraCapabilityManager
 * Phase 6: Monitor frame rate and torch stability
 * Phase 7: Export diagnostics and camera profile for processor
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
  onStreamReady,
  isMonitoring,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const cameraManagerRef = useRef<CameraCapabilityManager>(new CameraCapabilityManager());
  const monitoringIntervalRef = useRef<number | null>(null);
  const [warmupComplete, setWarmupComplete] = useState(false);
  
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
    warmupComplete: false,
    frameRateStable: true,
    frameRateChanges: 0,
    torchOffEvents: 0,
    appliedConstraints: [],
    failedConstraints: [],
  });

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getDiagnostics: () => ({ ...diagnosticsRef.current }),
    getCameraProfile: () => cameraManagerRef.current.getProfile(),
  }), []);

  useEffect(() => {
    let mounted = true;

    const stopCamera = async () => {
      // Clear monitoring interval
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current);
        monitoringIntervalRef.current = null;
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
      
      // Clear camera manager and warmup state
      cameraManagerRef.current.clear();
      setWarmupComplete(false);
      diagnosticsRef.current.warmupComplete = false;
      
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

      // Reset camera manager and warmup state
      cameraManagerRef.current.clear();
      setWarmupComplete(false);

      try {
        // PHASE 1: Find best back camera with torch
        const cameraId = await findMainBackCamera();

        // PHASE 2: Open stream with stable base constraints
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

        // PHASE 3: WARMUP (1.5-2.0s) - allow camera to stabilize
        console.log('🌡️ Camera warmup started (1.8s)...');
        await new Promise(r => setTimeout(r, 1800));
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); isStartingRef.current = false; return; }
        setWarmupComplete(true);
        diagnosticsRef.current.warmupComplete = true;
        console.log('✅ Camera warmup complete');

        // PHASE 4: Build initial camera profile
        const deviceId = cameraId || track.getSettings()?.deviceId || 'unknown';
        cameraManagerRef.current.buildProfile(track, deviceId);
        const profile = cameraManagerRef.current.getProfile();
        
        if (profile) {
          diagnosticsRef.current.deviceLabel = diagnosticsRef.current.deviceLabel || deviceId;
          diagnosticsRef.current.hasTorch = profile.capabilities.torch || false;
          diagnosticsRef.current.resolution = { width: profile.width, height: profile.height };
          diagnosticsRef.current.realFrameRate = profile.frameRate;
          diagnosticsRef.current.isoValue = profile.iso;
        }

        // PHASE 5: Apply optimal constraints via CameraCapabilityManager
        console.log('🔧 Applying optimal camera constraints...');
        await cameraManagerRef.current.applyOptimalConstraints(track);
        
        // Re-read profile after constraint application
        cameraManagerRef.current.buildProfile(track, deviceId);
        const updatedProfile = cameraManagerRef.current.getProfile();
        const managerDiagnostics = cameraManagerRef.current.getDiagnostics();
        
        if (updatedProfile) {
          diagnosticsRef.current.torchActive = updatedProfile.torchActive;
          diagnosticsRef.current.exposureLocked = managerDiagnostics.exposureLocked;
          diagnosticsRef.current.wbLocked = managerDiagnostics.wbLocked;
          diagnosticsRef.current.focusLocked = managerDiagnostics.focusLocked;
          diagnosticsRef.current.isoValue = updatedProfile.iso;
          diagnosticsRef.current.realFrameRate = updatedProfile.frameRate;
          diagnosticsRef.current.appliedConstraints = managerDiagnostics.appliedConstraints;
          diagnosticsRef.current.failedConstraints = managerDiagnostics.failedConstraints;
        }

        // Log final settings
        const finalSettings = cameraManagerRef.current.getSettings(track);
        console.log('📹 Camera ready:', finalSettings.width, 'x', finalSettings.height,
          '@', finalSettings.frameRate, 'fps',
          '| Torch:', diagnosticsRef.current.torchActive,
          '| Exp:', diagnosticsRef.current.exposureLocked,
          '| WB:', diagnosticsRef.current.wbLocked,
          '| ISO:', diagnosticsRef.current.isoValue,
          '| Applied:', diagnosticsRef.current.appliedConstraints.join(','),
          '| Failed:', diagnosticsRef.current.failedConstraints.join(','));

        // PHASE 6: Start monitoring frame rate and torch stability
        monitoringIntervalRef.current = window.setInterval(() => {
          if (!streamRef.current) return;
          const currentTrack = streamRef.current.getVideoTracks()[0];
          if (currentTrack) {
            cameraManagerRef.current.monitorFrameRate();
            cameraManagerRef.current.monitorTorch();
            
            const updatedProfile = cameraManagerRef.current.getProfile();
            const updatedDiagnostics = cameraManagerRef.current.getDiagnostics();
            
            if (updatedProfile) {
              diagnosticsRef.current.realFrameRate = updatedProfile.frameRate;
              diagnosticsRef.current.torchActive = updatedProfile.torchActive;
            }
            
            diagnosticsRef.current.frameRateStable = updatedDiagnostics.frameRateStable;
            diagnosticsRef.current.frameRateChanges = updatedDiagnostics.frameRateChanges;
            diagnosticsRef.current.torchOffEvents = updatedDiagnostics.torchOffEvents;
            
            // Log significant changes
            if (updatedDiagnostics.frameRateChanges > 3) {
              console.warn('⚠️ Frame rate unstable, changes:', updatedDiagnostics.frameRateChanges);
            }
            if (updatedDiagnostics.torchOffEvents > 0) {
              console.warn('⚠️ Torch turned off unexpectedly, events:', updatedDiagnostics.torchOffEvents);
            }
          }
        }, 2000);

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
