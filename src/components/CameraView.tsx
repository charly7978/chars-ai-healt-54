import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from "react";
import { CameraConstraintReport, type ConstraintReport } from "../modules/signal-processing/CameraConstraintReport";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getDiagnostics: () => CameraDiagnostics;
  getConstraintReport: () => ConstraintReport;
  isWarmedUp: () => boolean;
}

export interface CameraDiagnostics {
  deviceLabel: string;
  deviceId: string;
  hasTorch: boolean;
  torchRequested: boolean;
  torchActive: boolean;
  torchEffective: boolean;
  realFrameRate: number;
  resolution: { width: number; height: number };
  resolutionMatch: boolean;
  exposureLocked: boolean;
  wbLocked: boolean;
  focusLocked: boolean;
  isoValue: number;
  supportedConstraints: string[];
  warmUpStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
  warmUpProgress: number;
  stabilizationScore: number;
  overallQuality: 'EXCELLENT' | 'GOOD' | 'ACCEPTABLE' | 'POOR' | 'CRITICAL';
  constraintSummary: string;
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onWarmUpComplete?: () => void;
  isMonitoring: boolean;
}

/**
 * CAMERA PPG V3 — ADVANCED CONSTRAINT APPLICATION WITH WARM-UP
 * 
 * Phase 1: Find best back camera with torch (enumerateDevices + capability check)
 * Phase 2: Open stream with stable base constraints
 * Phase 3: Warm-up phase (0.8-1.2s) with torch activation
 * Phase 4: Lock fine controls (exposure, WB, focus, ISO) with verification
 * Phase 5: Verify effective settings vs requested constraints
 * Phase 6: Export diagnostics + constraint report + timing metrics
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
  onStreamReady,
  onWarmUpComplete,
  isMonitoring,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const [warmUpStatus, setWarmUpStatus] = useState<'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED'>('NOT_STARTED');
  const [warmUpProgress, setWarmUpProgress] = useState(0);
  
  const constraintReportRef = useRef<CameraConstraintReport>(new CameraConstraintReport());
  
  const diagnosticsRef = useRef<CameraDiagnostics>({
    deviceLabel: '',
    deviceId: '',
    hasTorch: false,
    torchRequested: false,
    torchActive: false,
    torchEffective: false,
    realFrameRate: 30,
    resolution: { width: 0, height: 0 },
    resolutionMatch: false,
    exposureLocked: false,
    wbLocked: false,
  focusLocked: false,
    isoValue: 0,
    supportedConstraints: [],
    warmUpStatus: 'NOT_STARTED',
    warmUpProgress: 0,
    stabilizationScore: 0,
    overallQuality: 'POOR',
    constraintSummary: '',
  });
  
  const warmUpStartTimeRef = useRef<number>(0);
  const luminanceHistoryRef = useRef<number[]>([]);
  const clipHistoryRef = useRef<{ high: number; low: number }[]>([]);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getDiagnostics: () => ({ ...diagnosticsRef.current, warmUpStatus, warmUpProgress }),
    getConstraintReport: () => constraintReportRef.current.getReport(),
    isWarmedUp: () => warmUpStatus === 'COMPLETE',
  }), [warmUpStatus, warmUpProgress]);

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
      setWarmUpStatus('NOT_STARTED');
      setWarmUpProgress(0);
      constraintReportRef.current.reset();
      luminanceHistoryRef.current = [];
      clipHistoryRef.current = [];
    };

    // PHASE 1: Find main back camera with torch - enhanced with capability verification
    const findMainBackCamera = async (): Promise<string | null> => {
      try {
        // Request minimal access first to get labels
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        tempStream.getTracks().forEach(t => t.stop());
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('📷 Cameras found:', videoDevices.length);
        
        const cameraCandidates: { deviceId: string; label: string; hasTorch: boolean; resolution?: { width: number; height: number } }[] = [];

        // Try each back camera to find one with torch
        for (const device of videoDevices) {
          const label = device.label.toLowerCase();
          const isBack = label.includes('back') || label.includes('rear') || label.includes('environment') ||
            label.includes('trasera') || label.includes('camera 0') || label.includes('camera0') ||
            videoDevices.length === 1;
          
          if (isBack) {
            try {
              const ts = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: device.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
              });
              const track = ts.getVideoTracks()[0];
              const caps = track.getCapabilities?.() as any;
              const settings = track.getSettings?.() as any;
              const hasTorch = caps?.torch === true;
              
              cameraCandidates.push({
                deviceId: device.deviceId,
                label: device.label || 'Unknown',
                hasTorch,
                resolution: settings ? { width: settings.width, height: settings.height } : undefined
              });
              
              ts.getTracks().forEach(t => t.stop());
            } catch (e) {
              console.warn('Failed to test camera:', device.label, e);
            }
          }
        }

        // Sort candidates: torch first, then resolution
        cameraCandidates.sort((a, b) => {
          if (a.hasTorch && !b.hasTorch) return -1;
          if (!a.hasTorch && b.hasTorch) return 1;
          const resA = (a.resolution?.width || 0) * (a.resolution?.height || 0);
          const resB = (b.resolution?.width || 0) * (b.resolution?.height || 0);
          return resB - resA;
        });

        if (cameraCandidates.length > 0) {
          const best = cameraCandidates[0];
          console.log('✅ Best camera selected:', best.label, '| Torch:', best.hasTorch, '| Res:', best.resolution);
          diagnosticsRef.current.deviceLabel = best.label;
          diagnosticsRef.current.deviceId = best.deviceId;
          diagnosticsRef.current.hasTorch = best.hasTorch;
          constraintReportRef.current.setDeviceInfo(best.deviceId, best.label);
          return best.deviceId;
        }
        
        console.warn('⚠️ No suitable camera found');
        return null;
      } catch (e) {
        console.error('❌ Camera enumeration failed:', e);
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
        const supportedList = Object.keys(supported).filter(k => (supported as any)[k]);
        diagnosticsRef.current.supportedConstraints = supportedList;

        // Record real settings BEFORE applying advanced constraints
        const initialSettings = track.getSettings() as any;
        diagnosticsRef.current.resolution = {
          width: initialSettings.width || 0,
          height: initialSettings.height || 0
        };
        diagnosticsRef.current.realFrameRate = initialSettings.frameRate || 30;
        
        // PHASE 3: Warm-up with torch activation
        setWarmUpStatus('IN_PROGRESS');
        setWarmUpProgress(0);
        warmUpStartTimeRef.current = performance.now();
        luminanceHistoryRef.current = [];
        clipHistoryRef.current = [];
        
        const caps = track.getCapabilities?.() as any;
        constraintReportRef.current.setTorchInfo(caps?.torch === true, true, false);
        
        // Activate torch with retries
        let torchOk = false;
        if (caps?.torch) {
          for (let attempt = 0; attempt < 5 && !torchOk; attempt++) {
            try {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              // Verify torch is actually on
              const newSettings = track.getSettings() as any;
              torchOk = (newSettings as any).torch === true;
              if (torchOk) {
                diagnosticsRef.current.torchActive = true;
                diagnosticsRef.current.torchEffective = true;
                constraintReportRef.current.setTorchInfo(true, true, true);
                console.log('🔦 Torch ON (verified)');
              }
            } catch (e) {
              console.warn('Torch attempt', attempt, 'failed:', e);
              await new Promise(r => setTimeout(r, 200));
            }
          }
          if (!torchOk) {
            console.warn('⚠️ Torch failed after 5 attempts');
            constraintReportRef.current.addFailedConstraint('torch');
          }
        } else {
          constraintReportRef.current.addIgnoredConstraint('torch');
        }

        // PHASE 4: Warm-up monitoring (0.8-1.2s)
        const warmUpDuration = 1000; // 1 segundo
        const warmUpInterval = 100; // 100ms
        let warmUpElapsed = 0;
        
        const completeWarmUp = async (track: MediaStreamTrack, caps: any) => {
          // Calcular score de estabilización
          const lumHistory = luminanceHistoryRef.current;
          const clipHistory = clipHistoryRef.current;
          
          let stabilizationScore = 0;
          if (lumHistory.length >= 5) {
            const recentLum = lumHistory.slice(-5);
            const lumStd = Math.sqrt(recentLum.reduce((sum, l) => sum + (l - recentLum.reduce((a, b) => a + b, 0) / recentLum.length) ** 2, 0) / recentLum.length);
            const lumMean = recentLum.reduce((a, b) => a + b, 0) / recentLum.length;
            
            // Verificar incremento de luminancia (torch effect)
            const lumIncrease = lumHistory.length >= 2 ? (lumHistory[lumHistory.length - 1] - lumHistory[0]) / (lumHistory[0] + 1) : 0;
            
            // Clipping controlado
            const avgClipHigh = clipHistory.reduce((sum, c) => sum + c.high, 0) / clipHistory.length;
            const avgClipLow = clipHistory.reduce((sum, c) => sum + c.low, 0) / clipHistory.length;
            
            const lumStability = Math.max(0, 1 - lumStd / (lumMean + 1));
            const torchEffect = Math.min(1, Math.max(0, lumIncrease * 5));
            const clipQuality = Math.max(0, 1 - (avgClipHigh + avgClipLow) * 10);
            
            stabilizationScore = lumStability * 0.4 + torchEffect * 0.3 + clipQuality * 0.3;
          }
          
          diagnosticsRef.current.stabilizationScore = stabilizationScore;
          
          if (stabilizationScore < 0.3) {
            console.warn('⚠️ Warm-up stabilization score low:', stabilizationScore.toFixed(2));
            setWarmUpStatus('FAILED');
          } else {
            console.log('✅ Warm-up complete, stabilization score:', stabilizationScore.toFixed(2));
            setWarmUpStatus('COMPLETE');
            onWarmUpComplete?.();
          }
          
          // PHASE 5: Fine lock — apply each independently with verification
          await new Promise(r => setTimeout(r, 200));
          
          const tryConstraint = async (name: string, value: any): Promise<{ success: boolean; effective?: any }> => {
            try {
              await track.applyConstraints({ advanced: [{ [name]: value } as any] });
              const settings = track.getSettings() as any;
              const effective = (settings as any)[name];
              return { success: true, effective };
            } catch (e) {
              return { success: false };
            }
          };

          // Frame rate lock
          const frResult = await tryConstraint('frameRate', 30);
          if (!frResult.success) constraintReportRef.current.addFailedConstraint('frameRate');

          // Exposure
          if (caps?.exposureMode?.includes('manual')) {
            const expResult = await tryConstraint('exposureMode', 'manual');
            diagnosticsRef.current.exposureLocked = expResult.success;
            if (expResult.success) {
              constraintReportRef.current.setLocks(true, diagnosticsRef.current.wbLocked, diagnosticsRef.current.focusLocked);
            } else {
              constraintReportRef.current.addFailedConstraint('exposureMode');
            }
          } else if (caps?.exposureMode?.includes('continuous')) {
            await tryConstraint('exposureMode', 'continuous');
            constraintReportRef.current.addIgnoredConstraint('exposureMode');
          } else {
            constraintReportRef.current.addIgnoredConstraint('exposureMode');
          }

          if (caps?.exposureCompensation) {
            const min = caps.exposureCompensation.min ?? -2;
            const max = caps.exposureCompensation.max ?? 2;
            const target = Math.max(min, Math.min(max, -0.35));
            await tryConstraint('exposureCompensation', target);
          }

          // White balance
          if (caps?.whiteBalanceMode?.includes('manual')) {
            const wbResult = await tryConstraint('whiteBalanceMode', 'manual');
            diagnosticsRef.current.wbLocked = wbResult.success;
            if (wbResult.success) {
              constraintReportRef.current.setLocks(diagnosticsRef.current.exposureLocked, true, diagnosticsRef.current.focusLocked);
            } else {
              constraintReportRef.current.addFailedConstraint('whiteBalanceMode');
            }
          } else if (caps?.whiteBalanceMode?.includes('continuous')) {
            await tryConstraint('whiteBalanceMode', 'continuous');
            constraintReportRef.current.addIgnoredConstraint('whiteBalanceMode');
          } else {
            constraintReportRef.current.addIgnoredConstraint('whiteBalanceMode');
          }

          // ISO
          if (caps?.iso) {
            const minISO = caps.iso.min ?? 50;
            const maxISO = caps.iso.max ?? 400;
            const targetISO = Math.max(minISO, Math.min(maxISO, 140));
            const isoResult = await tryConstraint('iso', targetISO);
            if (isoResult.success) {
              diagnosticsRef.current.isoValue = targetISO;
            } else {
              constraintReportRef.current.addFailedConstraint('iso');
            }
          } else {
            constraintReportRef.current.addIgnoredConstraint('iso');
          }

          // Focus
          if (caps?.focusMode?.includes('manual')) {
            const focusResult = await tryConstraint('focusMode', 'manual');
            diagnosticsRef.current.focusLocked = focusResult.success;
            if (focusResult.success) {
              constraintReportRef.current.setLocks(diagnosticsRef.current.exposureLocked, diagnosticsRef.current.wbLocked, true);
            } else {
              constraintReportRef.current.addFailedConstraint('focusMode');
            }
          } else if (caps?.focusMode?.includes('continuous')) {
            await tryConstraint('focusMode', 'continuous');
            constraintReportRef.current.addIgnoredConstraint('focusMode');
          } else {
            constraintReportRef.current.addIgnoredConstraint('focusMode');
          }

          // PHASE 6: Verify effective settings and generate report
          const finalSettings = track.getSettings() as any;
          constraintReportRef.current.setEffectiveSettings(finalSettings);
          
          diagnosticsRef.current.resolution = {
            width: finalSettings.width || 0,
            height: finalSettings.height || 0
          };
          diagnosticsRef.current.realFrameRate = finalSettings.frameRate || 30;
          diagnosticsRef.current.resolutionMatch = constraintReportRef.current.getReport().resolutionMatch;
          
          const report = constraintReportRef.current.getReport();
          diagnosticsRef.current.overallQuality = report.overallQuality;
          diagnosticsRef.current.constraintSummary = report.summary;
          
          console.log('📹 Camera ready:', finalSettings.width, 'x', finalSettings.height,
            '@', finalSettings.frameRate, 'fps',
            '| Torch:', diagnosticsRef.current.torchEffective,
            '| Exp:', diagnosticsRef.current.exposureLocked,
            '| WB:', diagnosticsRef.current.wbLocked,
            '| Focus:', diagnosticsRef.current.focusLocked,
            '| ISO:', diagnosticsRef.current.isoValue,
            '| Quality:', report.overallQuality,
            '| Summary:', report.summary);

          onStreamReady?.(stream);
          isStartingRef.current = false;
        };
        
        const warmUpMonitor = setInterval(async () => {
          warmUpElapsed += warmUpInterval;
          const progress = Math.min(100, (warmUpElapsed / warmUpDuration) * 100);
          setWarmUpProgress(progress);
          
          // Capturar frame para análisis de estabilización
          if (videoRef.current && videoRef.current.readyState >= 2) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(videoRef.current, 0, 0, 64, 64);
              const imageData = ctx.getImageData(0, 0, 64, 64);
              const data = imageData.data;
              
              // Calcular luminancia promedio
              let totalLum = 0;
              let clipHigh = 0;
              let clipLow = 0;
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i + 1], b = data[i + 2];
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                totalLum += lum;
                if (r > 250 || g > 250 || b > 250) clipHigh++;
                if (r < 5 && g < 5 && b < 5) clipLow++;
              }
              const avgLum = totalLum / (data.length / 4);
              luminanceHistoryRef.current.push(avgLum);
              clipHistoryRef.current.push({ high: clipHigh / (data.length / 4), low: clipLow / (data.length / 4) });
            }
          }
          
          if (warmUpElapsed >= warmUpDuration) {
            clearInterval(warmUpMonitor);
            await completeWarmUp(track, caps);
          }
        }, warmUpInterval);

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
  }, [isMonitoring, onStreamReady, onWarmUpComplete]);

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
