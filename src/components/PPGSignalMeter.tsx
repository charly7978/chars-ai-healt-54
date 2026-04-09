import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart, Activity } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
  isMonitoring?: boolean;
  
  arrhythmiaStatus?: string;
  rawArrhythmiaData?: {
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  } | null;
  preserveResults?: boolean;
  diagnosticMessage?: string;
  isPeak?: boolean;
  bpm?: number;
  spo2?: number;
  rrIntervals?: number[];
}

const CONFIG = {
  CANVAS_WIDTH: 1400,
  CANVAS_HEIGHT: 2400,
  WINDOW_MS: 3200,
  TARGET_FPS: 30,
  BUFFER_SIZE: 500,
  PLOT_AREA: {
    LEFT: 80,
    RIGHT: 80,
    TOP: 110,
    BOTTOM: 60
  },
  COLORS: {
    BG: '#000000',
    GRID_MAJOR: 'rgba(0, 255, 100, 0.18)',
    GRID_MINOR: 'rgba(0, 255, 100, 0.06)',
    BASELINE: 'rgba(0, 255, 100, 0.3)',
    SIGNAL_NORMAL: '#00ff64',
    SIGNAL_GLOW: 'rgba(0, 255, 100, 0.7)',
    SIGNAL_ARRHYTHMIA: '#ff2d2d',
    ARRHYTHMIA_GLOW: 'rgba(255, 45, 45, 0.8)',
    PEAK_NORMAL: '#00ccff',
    PEAK_ARRHYTHMIA: '#ff2d2d',
    VALLEY_COLOR: '#4a6a8a',
    TEXT_PRIMARY: '#00ff64',
    TEXT_SECONDARY: '#7a9ab0',
    TEXT_WARNING: '#ffaa00',
    TEXT_DANGER: '#ff3333',
    SCALE_TEXT: '#4a6a8a',
    SIGNAL_FILL_NORMAL: 'rgba(0, 255, 100, 0.04)',
    SIGNAL_FILL_ARR: 'rgba(255, 45, 45, 0.06)',
    SYSTOLIC_MARKER: '#00ccff',
    DIASTOLIC_MARKER: '#818cf8',
    DICHROTIC_NOTCH: '#a78bfa',
    IBI_TEXT: '#00e5ff',
    SWEEP_LINE: 'rgba(0, 255, 100, 0.9)',
    PHOSPHOR_DECAY: 'rgba(0, 255, 100, 0.15)',
  }
};

const PPGSignalMeter = ({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
  isMonitoring = false,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  diagnosticMessage,
  isPeak = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = []
}: PPGSignalMeterProps) => {
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  
  const beatArrhythmiaRef = useRef(false);
  const lastArrhythmiaCountRef = useRef(0);
  const beatHistoryRef = useRef<{ isArrhythmia: boolean; time: number }[]>([]);
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  
  // Track consecutive IBI for display
  const ibiDisplayRef = useRef<number>(0);
  const hrvDisplayRef = useRef<{ sdnn: number; rmssd: number }>({ sdnn: 0, rmssd: 0 });

  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData };
    
    // Compute HRV metrics from RR intervals
    if (rrIntervals && rrIntervals.length >= 2) {
      const last = rrIntervals[rrIntervals.length - 1];
      ibiDisplayRef.current = Math.round(last);
      
      // SDNN
      const mean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
      const variance = rrIntervals.reduce((sum, rr) => sum + (rr - mean) ** 2, 0) / rrIntervals.length;
      hrvDisplayRef.current.sdnn = Math.round(Math.sqrt(variance));
      
      // RMSSD
      let sumSqDiffs = 0;
      for (let i = 1; i < rrIntervals.length; i++) {
        sumSqDiffs += (rrIntervals[i] - rrIntervals[i - 1]) ** 2;
      }
      hrvDisplayRef.current.rmssd = Math.round(Math.sqrt(sumSqDiffs / (rrIntervals.length - 1)));
    }
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData]);

  useEffect(() => {
    if (isPeak && isFingerDetected) {
      const now = Date.now();
      if (now - lastPeakTimeRef.current > 250) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        setTimeout(() => setShowPulse(false), 120);
      }
    }
  }, [isPeak, isFingerDetected]);

  useEffect(() => {
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(CONFIG.BUFFER_SIZE);
    }
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    if (preserveResults && !isFingerDetected) {
      dataBufferRef.current?.clear();
    }
  }, [preserveResults, isFingerDetected]);

  const getPlotArea = useCallback(() => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, PLOT_AREA } = CONFIG;
    return {
      x: PLOT_AREA.LEFT,
      y: PLOT_AREA.TOP,
      width: W - PLOT_AREA.LEFT - PLOT_AREA.RIGHT,
      height: H - PLOT_AREA.TOP - PLOT_AREA.BOTTOM,
      centerY: PLOT_AREA.TOP + (H - PLOT_AREA.TOP - PLOT_AREA.BOTTOM) / 2
    };
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    const plot = getPlotArea();
    
    // Pure black background like real monitor
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    // Subtle scanline effect
    for (let y = 0; y < H; y += 4) {
      ctx.fillStyle = 'rgba(0, 20, 0, 0.15)';
      ctx.fillRect(0, y, W, 1);
    }
    
    // Minor grid - very subtle
    ctx.strokeStyle = COLORS.GRID_MINOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = plot.x; x <= plot.x + plot.width; x += 20) {
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
    for (let y = plot.y; y <= plot.y + plot.height; y += 20) {
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
    
    // Major grid
    ctx.strokeStyle = COLORS.GRID_MAJOR;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = plot.x; x <= plot.x + plot.width; x += 100) {
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
    for (let y = plot.y; y <= plot.y + plot.height; y += 100) {
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
    
    // Baseline - solid thin
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Plot border
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  }, [getPlotArea]);

  const drawAmplitudeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS } = CONFIG;
    const plot = getPlotArea();
    const stats = amplitudeStatsRef.current;
    
    ctx.font = '11px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'right';
    
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = plot.y + (i / steps) * plot.height;
      const val = stats.max - (i / steps) * stats.range;
      ctx.fillText(val.toFixed(0), plot.x - 8, y + 4);
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x - 5, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
    }
    
    ctx.save();
    ctx.translate(15, plot.centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillText('AMPLITUD (μV)', 0, 0);
    ctx.restore();
  }, [getPlotArea]);

  const drawTimeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS, WINDOW_MS } = CONFIG;
    const plot = getPlotArea();
    
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'center';
    
    const seconds = WINDOW_MS / 1000;
    for (let s = 0; s <= seconds; s++) {
      const x = plot.x + plot.width - (s / seconds) * plot.width;
      ctx.fillText(`${s}s`, x, plot.y + plot.height + 20);
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.height);
      ctx.lineTo(x, plot.y + plot.height + 5);
      ctx.stroke();
    }
    
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.TEXT_PRIMARY;
    ctx.fillText('25mm/s', plot.x + plot.width, plot.y + plot.height + 40);
  }, [getPlotArea]);

  const drawVitalInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality, rrIntervals, rawArrhythmiaData } = propsRef.current;
    
    const panelH = 100;
    const panelW = 180;
    const panelY = 2;
    const fontSize = {
      label: 'bold 16px "SF Mono", Consolas, monospace',
      value: 'bold 56px "SF Mono", Consolas, monospace',
      unit: '18px "SF Mono", Consolas, monospace',
      class: '12px "SF Mono", Consolas, monospace',
      small: '11px "SF Mono", Consolas, monospace',
    };
    
    // === BPM PANEL (top-left) ===
    ctx.fillStyle = 'rgba(0, 30, 15, 0.9)';
    ctx.fillRect(3, panelY, panelW, panelH);
    ctx.strokeStyle = COLORS.TEXT_PRIMARY;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(3, panelY, panelW, panelH);
    
    ctx.font = fontSize.label;
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('♥ FRECUENCIA', 10, panelY + 18);
    
    ctx.font = fontSize.value;
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
    ctx.shadowColor = bpm > 0 ? '#00ff64' : 'transparent';
    ctx.shadowBlur = bpm > 0 ? 12 : 0;
    ctx.fillText(bpm > 0 ? bpm.toString() : '--', 10, panelY + 70);
    ctx.shadowBlur = 0;
    
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('BPM', panelW - 40, panelY + 66);
    
    if (bpm > 0) {
      ctx.font = fontSize.class;
      let hrLabel = '';
      let hrColor = COLORS.TEXT_PRIMARY;
      if (bpm < 60) { hrLabel = 'BRADICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      else if (bpm <= 100) { hrLabel = 'NORMAL'; hrColor = COLORS.TEXT_PRIMARY; }
      else { hrLabel = 'TAQUICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      ctx.fillStyle = hrColor;
      ctx.fillText(hrLabel, 10, panelY + 86);
    }
    
    // === SpO2 PANEL (top-right) ===
    ctx.fillStyle = 'rgba(0, 15, 30, 0.9)';
    ctx.fillRect(W - panelW - 3, panelY, panelW, panelH);
    const spo2Border = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.strokeStyle = spo2Border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(W - panelW - 3, panelY, panelW, panelH);
    
    ctx.font = fontSize.label;
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('O₂ SATURACIÓN', W - panelW + 4, panelY + 18);
    
    ctx.font = fontSize.value;
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
    ctx.fillStyle = spo2Color;
    ctx.shadowColor = spo2 > 0 ? spo2Color : 'transparent';
    ctx.shadowBlur = spo2 > 0 ? 12 : 0;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - panelW + 4, panelY + 70);
    ctx.shadowBlur = 0;
    
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('%', W - 20, panelY + 66);
    
    if (spo2 > 0) {
      ctx.font = fontSize.class;
      let spLabel = '';
      let spColor = COLORS.TEXT_PRIMARY;
      if (spo2 >= 95) { spLabel = 'NORMAL'; spColor = COLORS.TEXT_PRIMARY; }
      else if (spo2 >= 90) { spLabel = 'HIPOXEMIA LEVE'; spColor = COLORS.TEXT_WARNING; }
      else { spLabel = 'HIPOXEMIA'; spColor = COLORS.TEXT_DANGER; }
      ctx.fillStyle = spColor;
      ctx.fillText(spLabel, W - panelW + 4, panelY + 86);
    }
    
    // === CENTER TOP: Quality + IBI + HRV ===
    const centerX = W / 2;
    const centerW = 260;
    ctx.fillStyle = 'rgba(20, 20, 30, 0.9)';
    ctx.fillRect(centerX - centerW / 2, panelY, centerW, panelH);
    ctx.strokeStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(centerX - centerW / 2, panelY, centerW, panelH);
    
    ctx.font = '12px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('CALIDAD SEÑAL', centerX, panelY + 18);
    
    const barWidth = 220;
    const barHeight = 10;
    const barX = centerX - barWidth / 2;
    const barY = panelY + 24;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    const qGrad = ctx.createLinearGradient(barX, 0, barX + (quality / 100) * barWidth, 0);
    if (quality > 60) { qGrad.addColorStop(0, '#166534'); qGrad.addColorStop(1, '#22c55e'); }
    else if (quality > 30) { qGrad.addColorStop(0, '#854d0e'); qGrad.addColorStop(1, '#f59e0b'); }
    else { qGrad.addColorStop(0, '#991b1b'); qGrad.addColorStop(1, '#ef4444'); }
    ctx.fillStyle = qGrad;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    
    ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillText(`${quality.toFixed(0)}%`, centerX, panelY + 52);
    
    // IBI & HRV row
    const ibi = ibiDisplayRef.current;
    const hrv = hrvDisplayRef.current;
    ctx.font = fontSize.small;
    ctx.textAlign = 'left';
    
    ctx.fillStyle = COLORS.IBI_TEXT;
    ctx.fillText(`IBI: ${ibi > 0 ? ibi + 'ms' : '--'}`, centerX - centerW / 2 + 8, panelY + 68);
    
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText(`SDNN: ${hrv.sdnn > 0 ? hrv.sdnn + 'ms' : '--'}`, centerX - centerW / 2 + 8, panelY + 84);
    
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText(`RMSSD: ${hrv.rmssd > 0 ? hrv.rmssd + 'ms' : '--'}`, centerX + 20, panelY + 84);
    
    if (rrIntervals && rrIntervals.length > 0) {
      const lastRR = rrIntervals[rrIntervals.length - 1];
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.textAlign = 'right';
      ctx.fillText(`RR: ${lastRR.toFixed(0)}ms`, centerX + centerW / 2 - 8, panelY + 68);
    }
    
    // === ARRHYTHMIA ALERT ===
    if (arrhythmiaStatus?.includes('ARRITMIA')) {
      const parts = arrhythmiaStatus.split('|');
      const count = parts.length > 1 ? parseInt(parts[1]) : 0;
      
      const pulse = (Math.sin(now / 100) + 1) / 2;
      ctx.fillStyle = `rgba(239, 68, 68, ${0.3 + pulse * 0.4})`;
      ctx.fillRect(W - panelW - 3, panelY + panelH + 4, panelW, 30);
      ctx.strokeStyle = COLORS.TEXT_DANGER;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - panelW - 3, panelY + panelH + 4, panelW, 30);
      
      ctx.font = 'bold 14px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_DANGER;
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ARRITMIA x${count}`, W - panelW / 2 - 3, panelY + panelH + 22);
      
      if (rawArrhythmiaData && rawArrhythmiaData.rmssd > 0) {
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.fillText(`RMSSD: ${rawArrhythmiaData.rmssd.toFixed(0)}ms`, W - panelW / 2 - 3, panelY + panelH + 42);
      }
    }
  }, []);

  // Main render loop
  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    
    const frameTime = 1500 / CONFIG.TARGET_FPS;
    let lastRenderTime = 0;
    
    const render = () => {
      if (!isRunningRef.current) return;
      
      const canvas = canvasRef.current;
      const buffer = dataBufferRef.current;
      if (!canvas || !buffer) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      const now = Date.now();
      if (now - lastRenderTime < frameTime) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = now;
      
      const { value: signalValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, isPeak: peak } = propsRef.current;
      const plot = getPlotArea();
      const { WINDOW_MS, COLORS } = CONFIG;
      
      drawGrid(ctx);
      drawAmplitudeScale(ctx);
      drawTimeScale(ctx);
      drawVitalInfo(ctx, now);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // === SIGNAL PROCESSING ===
      const scaledValue = signalValue * 2;
      
      if (peak) {
        const currentCount = arrStatus ? parseInt(arrStatus.split('|')[1] || '0') : 0;
        if (currentCount > lastArrhythmiaCountRef.current) {
          beatArrhythmiaRef.current = true;
          lastArrhythmiaCountRef.current = currentCount;
          
          // === RETROACTIVAMENTE MARCAR EL LATIDO COMPLETO ===
          // Usa el último intervalo RR (o 800ms default) para cubrir
          // toda la fase de subida del latido arrítmico
          const { rrIntervals: rr } = propsRef.current;
          const lastRR = rr && rr.length > 0 ? rr[rr.length - 1] : 800;
          const retroDuration = Math.min(Math.max(lastRR, 400), 1500);
          buffer.markArrhythmiaBack(retroDuration);
        } else {
          beatArrhythmiaRef.current = false;
        }
        beatHistoryRef.current.push({ isArrhythmia: beatArrhythmiaRef.current, time: now });
        if (beatHistoryRef.current.length > 20) {
          beatHistoryRef.current = beatHistoryRef.current.slice(-20);
        }
      }
      const currentIsArrhythmia = beatArrhythmiaRef.current;
      
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia
      });
      
      // Dynamic amplitude scaling
      const points = buffer.getPoints();
      if (points.length > 30) {
        const recentPoints = points.slice(-150);
        const values = recentPoints.map(p => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(40, max - min);
        const stats = amplitudeStatsRef.current;
        stats.min = stats.min * 0.95 + (min - range * 0.1) * 0.05;
        stats.max = stats.max * 0.95 + (max + range * 0.1) * 0.05;
        stats.range = stats.max - stats.min;
      }
      
      const stats = amplitudeStatsRef.current;
      
      // === DRAW PPG SIGNAL — PROFESSIONAL MONITOR ===
      if (points.length > 2) {
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        
        // Build path coordinates
        const pathCoords: { x: number; y: number; isArr: boolean; val: number; time: number }[] = [];
        
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          if (x < plot.x || x > plot.x + plot.width) continue;
          pathCoords.push({ x, y, isArr: pt.isArrhythmia, val: pt.value, time: pt.time });
        }
        
        if (pathCoords.length > 2) {
          // === PHOSPHOR DECAY TRAIL (older signal fades with wider glow) ===
          ctx.save();
          for (let i = 1; i < pathCoords.length; i++) {
            const prev = pathCoords[i - 1];
            const curr = pathCoords[i];
            const age = now - curr.time;
            const ageFactor = 1 - (age / WINDOW_MS);
            const alpha = Math.max(0.05, ageFactor * 0.2);
            
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.strokeStyle = curr.isArr 
              ? `rgba(255, 45, 45, ${alpha})` 
              : `rgba(0, 255, 100, ${alpha})`;
            ctx.lineWidth = 12;
            ctx.stroke();
          }
          ctx.restore();
          
          // === MAIN SIGNAL — ELECTRIC, sharp, high-contrast ===
          // Wide outer glow (electric aura)
          for (let i = 1; i < pathCoords.length; i++) {
            const prev = pathCoords[i - 1];
            const curr = pathCoords[i];
            const age = now - curr.time;
            const ageFactor = Math.max(0.5, 1 - (age / WINDOW_MS) * 0.5);
            
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            
            if (curr.isArr) {
              ctx.strokeStyle = `rgba(255, 45, 45, ${0.6 * ageFactor})`;
              ctx.shadowColor = '#ff2d2d';
              ctx.shadowBlur = 30;
              ctx.lineWidth = 8;
            } else {
              ctx.strokeStyle = `rgba(0, 255, 100, ${0.5 * ageFactor})`;
              ctx.shadowColor = '#00ff64';
              ctx.shadowBlur = 25;
              ctx.lineWidth = 7;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          // Mid glow layer
          for (let i = 1; i < pathCoords.length; i++) {
            const prev = pathCoords[i - 1];
            const curr = pathCoords[i];
            const age = now - curr.time;
            const ageFactor = Math.max(0.6, 1 - (age / WINDOW_MS) * 0.4);
            
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            
            if (curr.isArr) {
              ctx.strokeStyle = `rgba(255, 80, 80, ${0.8 * ageFactor})`;
              ctx.shadowColor = '#ff4444';
              ctx.shadowBlur = 15;
              ctx.lineWidth = 4;
            } else {
              ctx.strokeStyle = `rgba(0, 255, 120, ${0.7 * ageFactor})`;
              ctx.shadowColor = '#00ff80';
              ctx.shadowBlur = 12;
              ctx.lineWidth = 3.5;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          // Core line — crisp, bright, electric
          for (let i = 1; i < pathCoords.length; i++) {
            const prev = pathCoords[i - 1];
            const curr = pathCoords[i];
            const age = now - curr.time;
            const ageFactor = Math.max(0.7, 1 - (age / WINDOW_MS) * 0.3);
            
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            
            if (curr.isArr) {
              ctx.strokeStyle = `rgba(255, 100, 100, ${ageFactor})`;
              ctx.lineWidth = 2.5;
            } else {
              ctx.strokeStyle = `rgba(50, 255, 140, ${ageFactor})`;
              ctx.lineWidth = 2.2;
            }
            ctx.stroke();
          }
          
          // === White-hot inner core (phosphor hotspot) ===
          for (let i = 1; i < pathCoords.length; i++) {
            const prev = pathCoords[i - 1];
            const curr = pathCoords[i];
            const age = now - curr.time;
            const ageFactor = Math.max(0.3, 1 - (age / WINDOW_MS) * 0.7);
            
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.strokeStyle = curr.isArr 
              ? `rgba(255, 200, 200, ${0.5 * ageFactor})`
              : `rgba(200, 255, 220, ${0.45 * ageFactor})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          
          // === SWEEP LINE (vertical cursor at newest point) ===
          if (pathCoords.length > 0) {
            const newestX = pathCoords[pathCoords.length - 1].x;
            const sweepWidth = 30;
            
            // Erase zone ahead of sweep
            const eraseGrad = ctx.createLinearGradient(newestX, 0, newestX + sweepWidth, 0);
            eraseGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
            eraseGrad.addColorStop(0.3, 'rgba(0, 0, 0, 0.7)');
            eraseGrad.addColorStop(1, 'rgba(0, 0, 0, 0.95)');
            ctx.fillStyle = eraseGrad;
            ctx.fillRect(newestX, plot.y + 1, sweepWidth, plot.height - 2);
            
            // Bright sweep cursor line
            ctx.strokeStyle = COLORS.SWEEP_LINE;
            ctx.lineWidth = 1.5;
            ctx.shadowColor = COLORS.SIGNAL_GLOW;
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(newestX, plot.y);
            ctx.lineTo(newestX, plot.y + plot.height);
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
        }
        
        // === PEAKS & VALLEYS ===
        const peaks: { x: number; y: number; isArrhythmia: boolean; time: number; val: number }[] = [];
        const valleys: { x: number; y: number; val: number }[] = [];
        const history = beatHistoryRef.current;
        const visibleBeats: { time: number; x: number; y: number; isArrhythmia: boolean; val: number }[] = [];
        
        for (const beat of history) {
          const age = now - beat.time;
          if (age > WINDOW_MS || age < 0) continue;
          
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          if (x < plot.x || x > plot.x + plot.width) continue;
          
          let closestPt: PPGDataPoint | null = null;
          let minDist = Infinity;
          for (const pt of points) {
            const dist = Math.abs(pt.time - beat.time);
            if (dist < minDist) { minDist = dist; closestPt = pt; }
          }
          
          if (closestPt && minDist < 200) {
            const normalizedY = (stats.max - closestPt.value) / stats.range;
            const y = plot.y + normalizedY * plot.height;
            peaks.push({ x, y, isArrhythmia: beat.isArrhythmia, time: beat.time, val: closestPt.value });
            visibleBeats.push({ time: beat.time, x, y, isArrhythmia: beat.isArrhythmia, val: closestPt.value });
          }
        }
        
        // Derive valleys between consecutive peaks
        for (let b = 0; b < visibleBeats.length - 1; b++) {
          const t0 = visibleBeats[b].time;
          const t1 = visibleBeats[b + 1].time;
          let minVal = Infinity;
          let minPt: PPGDataPoint | null = null;
          for (const pt of points) {
            if (pt.time > t0 && pt.time < t1 && pt.value < minVal) {
              minVal = pt.value;
              minPt = pt;
            }
          }
          if (minPt) {
            const age2 = now - minPt.time;
            const vx = plot.x + plot.width - (age2 * plot.width / WINDOW_MS);
            const vy = plot.y + ((stats.max - minPt.value) / stats.range) * plot.height;
            if (vx >= plot.x && vx <= plot.x + plot.width) {
              valleys.push({ x: vx, y: vy, val: minPt.value });
            }
          }
        }
        
        // === IBI ANNOTATIONS between peaks ===
        for (let i = 0; i < peaks.length - 1; i++) {
          const p1 = peaks[i];
          const p2 = peaks[i + 1];
          const ibiMs = Math.abs(p1.time - p2.time);
          if (ibiMs > 0 && ibiMs < 3000) {
            const midX = (p1.x + p2.x) / 2;
            const topY = Math.min(p1.y, p2.y) - 32;
            
            // Bracket line
            ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p1.x, topY + 8);
            ctx.lineTo(p1.x, topY);
            ctx.lineTo(p2.x, topY);
            ctx.lineTo(p2.x, topY + 8);
            ctx.stroke();
            
            // IBI value
            ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
            ctx.fillStyle = COLORS.IBI_TEXT;
            ctx.textAlign = 'center';
            ctx.fillText(`${ibiMs}ms`, midX, topY - 4);
            
            // Instant HR from this interval
            const instantHR = Math.round(60000 / ibiMs);
            ctx.font = '8px "SF Mono", Consolas, monospace';
            ctx.fillStyle = 'rgba(0, 229, 255, 0.5)';
            ctx.fillText(`${instantHR}bpm`, midX, topY - 16);
          }
        }
        
        // Draw peak markers with amplitude values
        peaks.forEach(p => {
          const color = p.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          
          // Vertical reference line — thinner, subtler
          ctx.save();
          ctx.strokeStyle = p.isArrhythmia ? 'rgba(255, 45, 45, 0.25)' : 'rgba(0, 204, 255, 0.2)';
          ctx.lineWidth = 0.8;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.moveTo(p.x, plot.y);
          ctx.lineTo(p.x, plot.y + plot.height);
          ctx.stroke();
          ctx.restore();
          
          // Peak diamond marker (more professional than circle)
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.PI / 4);
          const markerSize = p.isArrhythmia ? 5 : 4;
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 8;
          ctx.fillRect(-markerSize, -markerSize, markerSize * 2, markerSize * 2);
          ctx.shadowBlur = 0;
          // White center
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(-1.5, -1.5, 3, 3);
          ctx.restore();
          
          // Peak amplitude value annotation
          const peakAmplitude = p.val.toFixed(1);
          ctx.font = 'bold 9px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.PEAK_NORMAL;
          ctx.textAlign = 'center';
          ctx.fillText(`${peakAmplitude}μV`, p.x, p.y - 20);
          
          // Beat label
          ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.SIGNAL_NORMAL;
          ctx.fillText(p.isArrhythmia ? '▲A' : '▲N', p.x, p.y - 10);
          
          // Pulsating halo for arrhythmia
          if (p.isArrhythmia) {
            const alpha = (Math.sin(now / 60) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 45, 45, ${0.4 + alpha * 0.5})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            
            ctx.beginPath();
            ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 45, 45, ${0.1 + alpha * 0.2})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        });
        
        // Draw valley markers with values
        valleys.forEach(v => {
          // Small inverted triangle
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 3);
          ctx.lineTo(v.x - 3, v.y + 9);
          ctx.lineTo(v.x + 3, v.y + 9);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
          
          // Valley amplitude value
          ctx.font = '8px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText(`${v.val.toFixed(1)}`, v.x, v.y + 20);
        });
        
        // === Peak-to-valley amplitude delta ===
        for (let i = 0; i < peaks.length && i < valleys.length; i++) {
          const pk = peaks[i];
          const vl = valleys[i];
          const delta = Math.abs(pk.val - vl.val);
          if (delta > 0) {
            const midY = (pk.y + vl.y) / 2;
            const sideX = Math.min(pk.x, vl.x) - 18;
            if (sideX > plot.x) {
              // Vertical amplitude line
              ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              ctx.moveTo(sideX, pk.y);
              ctx.lineTo(sideX, vl.y);
              ctx.stroke();
              
              // Arrow tips
              ctx.beginPath();
              ctx.moveTo(sideX - 2, pk.y + 4);
              ctx.lineTo(sideX, pk.y);
              ctx.lineTo(sideX + 2, pk.y + 4);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(sideX - 2, vl.y - 4);
              ctx.lineTo(sideX, vl.y);
              ctx.lineTo(sideX + 2, vl.y - 4);
              ctx.stroke();
              
              // Delta value
              ctx.font = '7px "SF Mono", Consolas, monospace';
              ctx.fillStyle = COLORS.IBI_TEXT;
              ctx.textAlign = 'center';
              ctx.save();
              ctx.translate(sideX - 8, midY);
              ctx.rotate(-Math.PI / 2);
              ctx.fillText(`Δ${delta.toFixed(1)}`, 0, 0);
              ctx.restore();
            }
          }
        }
      }
      
      // === BEAT HISTORY (last 20) ===
      const beatHistory = beatHistoryRef.current;
      if (beatHistory.length > 0) {
        const histX = plot.x;
        const histY = plot.y + plot.height + 30;
        const dotRadius = 6;
        const dotSpacing = 16;
        const totalWidth = beatHistory.length * dotSpacing;
        const startX = histX + (plot.width - totalWidth) / 2;
        
        ctx.fillStyle = 'rgba(0, 5, 0, 0.9)';
        const panelPad = 6;
        ctx.fillRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 12);
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.15)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 12);
        
        ctx.font = '7px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText('BEAT HISTORY', startX + totalWidth / 2, histY - dotRadius - 1);
        
        const arrCount = beatHistory.filter(b => b.isArrhythmia).length;
        const normalCount = beatHistory.length - arrCount;
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.SIGNAL_NORMAL;
        ctx.fillText(`N:${normalCount}`, startX + totalWidth + panelPad - 2, histY - dotRadius - 1);
        ctx.fillStyle = arrCount > 0 ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'left';
        ctx.fillText(`A:${arrCount}`, startX - panelPad + 2, histY - dotRadius - 1);
        ctx.textAlign = 'center';
        
        beatHistory.forEach((beat, i) => {
          const cx = startX + i * dotSpacing + dotSpacing / 2;
          const cy = histY + 5;
          
          if (beat.isArrhythmia) {
            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius + 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 45, 45, 0.2)';
            ctx.fill();
          }
          
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = beat.isArrhythmia ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
          ctx.fill();
          
          ctx.font = 'bold 6px "SF Mono", Consolas, monospace';
          ctx.fillStyle = '#000';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, cx, cy + 2.5);
        });
      }
      
      // === LEGEND ===
      const legendY = CONFIG.CANVAS_HEIGHT - 15;
      ctx.font = '8px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const lx = CONFIG.PLOT_AREA.LEFT;
      
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(lx, legendY - 5, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal', lx + 16, legendY);
      
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(lx + 65, legendY - 5, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia', lx + 81, legendY);
      
      // Peak marker in legend
      ctx.save();
      ctx.translate(lx + 140, legendY - 3);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = COLORS.PEAK_NORMAL;
      ctx.fillRect(-2, -2, 4, 4);
      ctx.restore();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Pico', lx + 148, legendY);
      
      ctx.fillStyle = COLORS.VALLEY_COLOR;
      ctx.beginPath();
      ctx.moveTo(lx + 185, legendY - 5);
      ctx.lineTo(lx + 182, legendY);
      ctx.lineTo(lx + 188, legendY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Valle', lx + 192, legendY);
      
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillRect(lx + 228, legendY - 4, 10, 1.5);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('IBI', lx + 242, legendY);
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drawGrid, drawAmplitudeScale, drawTimeScale, drawVitalInfo, getPlotArea]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    amplitudeStatsRef.current = { min: -50, max: 50, range: 100 };
    beatHistoryRef.current = [];
    lastArrhythmiaCountRef.current = 0;
    ibiDisplayRef.current = 0;
    hrvDisplayRef.current = { sdnn: 0, rmssd: 0 };
    onReset();
  }, [onReset]);

  return (
    <div className="fixed inset-0 bg-slate-950">
      <canvas
        ref={canvasRef}
        width={CONFIG.CANVAS_WIDTH}
        height={CONFIG.CANVAS_HEIGHT}
        className="w-full h-full absolute inset-0"
      />

      <div className="absolute top-0 left-0 p-2 z-10 flex items-center gap-2" style={{ top: '6px', left: '140px' }}>
        <div className={`p-1.5 rounded-full transition-all duration-100 ${
          showPulse ? 'bg-red-500/30 scale-110' : 'bg-emerald-500/20'
        }`}>
          <Heart 
            className={`w-4 h-4 transition-all duration-100 ${
              showPulse ? 'text-red-400 scale-110' : 'text-emerald-400'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
        </div>
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[10px] font-mono text-emerald-400/80">PPG MONITOR v3</span>
      </div>

      <div className="fixed bottom-0 left-0 right-0 h-12 grid grid-cols-2 z-10">
        <button 
          onClick={onStartMeasurement}
          className={`font-semibold text-sm transition-colors border-t border-slate-700/50 ${
            isMonitoring
              ? 'bg-red-500/20 hover:bg-red-500/30 active:bg-red-500/40 text-red-300 border-r'
              : 'bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 text-emerald-400 border-r'
          }`}
        >
          {isMonitoring ? 'DETENER' : 'INICIAR'}
        </button>
        <button 
          onClick={handleReset}
          className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 text-slate-300 font-semibold text-sm transition-colors border-t border-slate-700/50"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;
