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
  CANVAS_HEIGHT: 2800,
  WINDOW_MS: 2800,
  TARGET_FPS: 30,
  BUFFER_SIZE: 400,
  PLOT_AREA: {
    LEFT: 80,
    RIGHT: 80,
    TOP: 260,
    BOTTOM: 60
  },
  COLORS: {
    BG: '#000000',
    GRID_MAJOR: 'rgba(0, 255, 128, 0.18)',
    GRID_MINOR: 'rgba(0, 255, 128, 0.06)',
    BASELINE: 'rgba(0, 255, 128, 0.3)',
    SIGNAL_NORMAL: '#00ff88',
    SIGNAL_GLOW: 'rgba(0, 255, 136, 0.7)',
    SIGNAL_ARRHYTHMIA: '#ff3333',
    ARRHYTHMIA_GLOW: 'rgba(255, 51, 51, 0.7)',
    PEAK_NORMAL: '#00ccff',
    PEAK_ARRHYTHMIA: '#ff3333',
    VALLEY_COLOR: '#4a5568',
    TEXT_PRIMARY: '#00ff88',
    TEXT_SECONDARY: '#7dd3fc',
    TEXT_WARNING: '#fbbf24',
    TEXT_DANGER: '#ff3333',
    SCALE_TEXT: '#4a6741',
    SIGNAL_FILL_NORMAL: 'rgba(0, 255, 136, 0.06)',
    SIGNAL_FILL_ARR: 'rgba(255, 51, 51, 0.06)',
    SYSTOLIC_MARKER: '#60a5fa',
    DIASTOLIC_MARKER: '#818cf8',
    DICHROTIC_NOTCH: '#a78bfa',
    IBI_TEXT: '#67e8f9',
    PANEL_LABEL: '#38bdf8',
    PANEL_BG: 'rgba(0, 8, 16, 0.92)',
    PANEL_BORDER: 'rgba(0, 255, 136, 0.35)',
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
    
    // Pure black background
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    // Subtle scanline effect
    for (let y = 0; y < H; y += 4) {
      ctx.fillStyle = 'rgba(0, 255, 100, 0.008)';
      ctx.fillRect(0, y, W, 1);
    }
    
    // Plot area with very faint phosphor tint
    ctx.fillStyle = 'rgba(0, 20, 8, 0.4)';
    ctx.fillRect(plot.x, plot.y, plot.width, plot.height);
    
    // Minor grid - fine dots style
    ctx.fillStyle = COLORS.GRID_MINOR;
    for (let x = plot.x; x <= plot.x + plot.width; x += 20) {
      for (let y = plot.y; y <= plot.y + plot.height; y += 20) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    
    // Major grid lines
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
    
    // Baseline
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Plot border with glow
    ctx.shadowColor = 'rgba(0, 255, 136, 0.15)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = COLORS.PANEL_BORDER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
    ctx.shadowBlur = 0;
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
    
    const panelH = 110;
    const panelW = 190;
    const panelY = 8;
    const gap = 8;
    const fontSize = {
      label: 'bold 15px "SF Mono", Consolas, monospace',
      value: 'bold 56px "SF Mono", Consolas, monospace',
      unit: 'bold 18px "SF Mono", Consolas, monospace',
      class: 'bold 12px "SF Mono", Consolas, monospace',
      small: '11px "SF Mono", Consolas, monospace',
    };

    // Helper to draw a panel with glow border
    const drawPanel = (x: number, y: number, w: number, h: number, borderColor: string) => {
      ctx.fillStyle = COLORS.PANEL_BG;
      ctx.fillRect(x, y, w, h);
      ctx.shadowColor = borderColor;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;
    };
    
    // === BPM PANEL (top-left) ===
    drawPanel(3, panelY, panelW, panelH, bpm > 100 ? COLORS.TEXT_WARNING : COLORS.PANEL_BORDER);
    
    ctx.font = fontSize.label;
    ctx.fillStyle = COLORS.PANEL_LABEL;
    ctx.textAlign = 'left';
    ctx.fillText('♥ FRECUENCIA', 12, panelY + 22);
    
    ctx.font = fontSize.value;
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : '#334155';
    ctx.shadowColor = bpm > 0 ? 'rgba(0,255,136,0.4)' : 'transparent';
    ctx.shadowBlur = bpm > 0 ? 10 : 0;
    ctx.fillText(bpm > 0 ? bpm.toString() : '--', 12, panelY + 78);
    ctx.shadowBlur = 0;
    
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.PANEL_LABEL;
    ctx.fillText('BPM', panelW - 40, panelY + 78);
    
    if (bpm > 0) {
      ctx.font = fontSize.class;
      let hrLabel = '', hrColor = COLORS.TEXT_PRIMARY;
      if (bpm < 60) { hrLabel = 'BRADICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      else if (bpm <= 100) { hrLabel = 'NORMAL'; hrColor = COLORS.TEXT_PRIMARY; }
      else { hrLabel = 'TAQUICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      ctx.fillStyle = hrColor;
      ctx.fillText(hrLabel, 12, panelY + 100);
    }
    
    // === SpO2 PANEL (top-right) ===
    const spo2Border = spo2 >= 95 ? COLORS.PANEL_BORDER : spo2 >= 90 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    drawPanel(W - panelW - 3, panelY, panelW, panelH, spo2Border);
    
    ctx.font = fontSize.label;
    ctx.fillStyle = COLORS.PANEL_LABEL;
    ctx.textAlign = 'left';
    ctx.fillText('O₂ SATURACIÓN', W - panelW + 6, panelY + 22);
    
    ctx.font = fontSize.value;
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : spo2 > 0 ? COLORS.TEXT_DANGER : '#334155';
    ctx.fillStyle = spo2Color;
    ctx.shadowColor = spo2 > 0 ? (spo2 >= 95 ? 'rgba(0,255,136,0.4)' : 'rgba(255,200,0,0.4)') : 'transparent';
    ctx.shadowBlur = spo2 > 0 ? 10 : 0;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - panelW + 6, panelY + 78);
    ctx.shadowBlur = 0;
    
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.PANEL_LABEL;
    ctx.fillText('%', W - 22, panelY + 78);
    
    if (spo2 > 0) {
      ctx.font = fontSize.class;
      let spLabel = '', spColor = COLORS.TEXT_PRIMARY;
      if (spo2 >= 95) { spLabel = 'NORMAL'; spColor = COLORS.TEXT_PRIMARY; }
      else if (spo2 >= 90) { spLabel = 'HIPOXEMIA LEVE'; spColor = COLORS.TEXT_WARNING; }
      else { spLabel = 'HIPOXEMIA'; spColor = COLORS.TEXT_DANGER; }
      ctx.fillStyle = spColor;
      ctx.fillText(spLabel, W - panelW + 6, panelY + 100);
    }
    
    // === CENTER: Quality + HRV ===
    const centerX = W / 2;
    const centerW = W - panelW * 2 - gap * 4 - 6;
    drawPanel(panelW + gap + 3, panelY, centerW, panelH, quality > 60 ? COLORS.PANEL_BORDER : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER);
    
    const cLeft = panelW + gap + 3;
    ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.PANEL_LABEL;
    ctx.fillText('CALIDAD SEÑAL', cLeft + centerW / 2, panelY + 20);
    
    // Quality bar
    const barWidth = centerW - 20;
    const barHeight = 12;
    const barX = cLeft + 10;
    const barY = panelY + 28;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    
    const qGrad = ctx.createLinearGradient(barX, 0, barX + (quality / 100) * barWidth, 0);
    if (quality > 60) { qGrad.addColorStop(0, '#003d1f'); qGrad.addColorStop(1, '#00ff88'); }
    else if (quality > 30) { qGrad.addColorStop(0, '#553a00'); qGrad.addColorStop(1, '#fbbf24'); }
    else { qGrad.addColorStop(0, '#550000'); qGrad.addColorStop(1, '#ff3333'); }
    ctx.fillStyle = qGrad;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    
    ctx.font = 'bold 16px "SF Mono", Consolas, monospace';
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillText(`${quality.toFixed(0)}%`, cLeft + centerW / 2, panelY + 60);
    
    // HRV data
    const ibi = ibiDisplayRef.current;
    const hrv = hrvDisplayRef.current;
    ctx.font = fontSize.small;
    ctx.textAlign = 'left';
    
    ctx.fillStyle = COLORS.IBI_TEXT;
    ctx.fillText(`IBI: ${ibi > 0 ? ibi + 'ms' : '--'}`, cLeft + 8, panelY + 78);
    
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText(`SDNN: ${hrv.sdnn > 0 ? hrv.sdnn + 'ms' : '--'}`, cLeft + 8, panelY + 94);
    ctx.fillText(`RMSSD: ${hrv.rmssd > 0 ? hrv.rmssd + 'ms' : '--'}`, cLeft + centerW / 2 - 10, panelY + 94);
    
    if (rrIntervals && rrIntervals.length > 0) {
      const lastRR = rrIntervals[rrIntervals.length - 1];
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.textAlign = 'right';
      ctx.fillText(`RR: ${lastRR.toFixed(0)}ms`, cLeft + centerW - 8, panelY + 78);
    }
    
    // === SECOND ROW: Monitor label ===
    const row2Y = panelY + panelH + 6;
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4a6741';
    ctx.fillText('ECG-PPG MONITOR', 3, row2Y + 12);
    ctx.textAlign = 'right';
    ctx.fillText('25mm/s • 10mm/mV', W - 3, row2Y + 12);
    
    // === ARRHYTHMIA ALERT ===
    if (arrhythmiaStatus?.includes('ARRITMIA')) {
      const parts = arrhythmiaStatus.split('|');
      const count = parts.length > 1 ? parseInt(parts[1]) : 0;
      
      const pulse = (Math.sin(now / 80) + 1) / 2;
      ctx.fillStyle = `rgba(255, 30, 30, ${0.25 + pulse * 0.35})`;
      ctx.fillRect(W - panelW - 3, panelY + panelH + 4, panelW, 34);
      ctx.strokeStyle = COLORS.TEXT_DANGER;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - panelW - 3, panelY + panelH + 4, panelW, 34);
      
      ctx.font = 'bold 15px "SF Mono", Consolas, monospace';
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = 'rgba(255,50,50,0.6)';
      ctx.shadowBlur = 8;
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ARRITMIA x${count}`, W - panelW / 2 - 3, panelY + panelH + 26);
      ctx.shadowBlur = 0;
      
      if (rawArrhythmiaData && rawArrhythmiaData.rmssd > 0) {
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.fillText(`RMSSD: ${rawArrhythmiaData.rmssd.toFixed(0)}ms`, W - panelW / 2 - 3, panelY + panelH + 44);
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
      
      // === DRAW PPG SIGNAL (Electric Oscilloscope Style) ===
      if (points.length > 2) {
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'butt';
        
        const pathCoords: { x: number; y: number; isArr: boolean }[] = [];
        
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          if (x < plot.x || x > plot.x + plot.width) continue;
          pathCoords.push({ x, y, isArr: pt.isArrhythmia });
        }
        
        if (pathCoords.length > 2) {
          // Layer 1: Wide diffuse phosphor glow
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pathCoords[0].x, pathCoords[0].y);
          for (let i = 1; i < pathCoords.length; i++) {
            ctx.lineTo(pathCoords[i].x, pathCoords[i].y);
          }
          ctx.strokeStyle = 'rgba(0, 255, 136, 0.08)';
          ctx.shadowColor = 'rgba(0, 255, 136, 0.3)';
          ctx.shadowBlur = 30;
          ctx.lineWidth = 12;
          ctx.stroke();
          ctx.restore();
          
          // Layer 2: Medium glow
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pathCoords[0].x, pathCoords[0].y);
          for (let i = 1; i < pathCoords.length; i++) {
            ctx.lineTo(pathCoords[i].x, pathCoords[i].y);
          }
          ctx.strokeStyle = 'rgba(0, 255, 136, 0.15)';
          ctx.shadowColor = 'rgba(0, 255, 136, 0.5)';
          ctx.shadowBlur = 15;
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.restore();
          
          // Layer 3: Sharp core line (per-segment for arrhythmia coloring)
          for (let i = 1; i < pathCoords.length; i++) {
            const prev = pathCoords[i - 1];
            const curr = pathCoords[i];
            
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            
            if (curr.isArr) {
              ctx.strokeStyle = '#ff4444';
              ctx.shadowColor = 'rgba(255, 50, 50, 0.9)';
              ctx.shadowBlur = 20;
              ctx.lineWidth = 3.5;
            } else {
              ctx.strokeStyle = '#bbffdd';
              ctx.shadowColor = 'rgba(0, 255, 136, 0.8)';
              ctx.shadowBlur = 8;
              ctx.lineWidth = 2.5;
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          // Layer 4: White-hot core for peaks (brightest point)
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pathCoords[0].x, pathCoords[0].y);
          for (let i = 1; i < pathCoords.length; i++) {
            ctx.lineTo(pathCoords[i].x, pathCoords[i].y);
          }
          ctx.strokeStyle = 'rgba(220, 255, 240, 0.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
          
          // Arrhythmia red glow overlay
          const arrSegments: { x: number; y: number }[][] = [];
          let currentSeg: { x: number; y: number }[] = [];
          for (const c of pathCoords) {
            if (c.isArr) {
              currentSeg.push(c);
            } else {
              if (currentSeg.length > 1) arrSegments.push(currentSeg);
              currentSeg = [];
            }
          }
          if (currentSeg.length > 1) arrSegments.push(currentSeg);
          
          for (const seg of arrSegments) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(seg[0].x, seg[0].y);
            for (const c of seg) ctx.lineTo(c.x, c.y);
            ctx.strokeStyle = 'rgba(255, 50, 50, 0.12)';
            ctx.shadowColor = 'rgba(255, 30, 30, 0.4)';
            ctx.shadowBlur = 25;
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.restore();
          }
        }
        
        // === PEAKS & VALLEYS ===
        const peaks: { x: number; y: number; isArrhythmia: boolean; time: number }[] = [];
        const valleys: { x: number; y: number }[] = [];
        const history = beatHistoryRef.current;
        const visibleBeats: { time: number; x: number; y: number; isArrhythmia: boolean }[] = [];
        
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
            peaks.push({ x, y, isArrhythmia: beat.isArrhythmia, time: beat.time });
            visibleBeats.push({ time: beat.time, x, y, isArrhythmia: beat.isArrhythmia });
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
              valleys.push({ x: vx, y: vy });
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
            const topY = Math.min(p1.y, p2.y) - 28;
            
            // Bracket line
            ctx.strokeStyle = 'rgba(103, 232, 249, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p1.x, topY + 8);
            ctx.lineTo(p1.x, topY);
            ctx.lineTo(p2.x, topY);
            ctx.lineTo(p2.x, topY + 8);
            ctx.stroke();
            
            // IBI value
            ctx.font = '9px "SF Mono", Consolas, monospace';
            ctx.fillStyle = COLORS.IBI_TEXT;
            ctx.textAlign = 'center';
            ctx.fillText(`${ibiMs}ms`, midX, topY - 3);
          }
        }
        
        // Draw peak markers with vertical reference lines
        peaks.forEach(p => {
          const color = p.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
          
          // Vertical reference line
          ctx.save();
          ctx.strokeStyle = p.isArrhythmia ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p.x, plot.y);
          ctx.lineTo(p.x, plot.y + plot.height);
          ctx.stroke();
          ctx.restore();
          
          // Peak circle with ring
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.isArrhythmia ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          
          // White inner dot
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          
          // Label
          ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.SIGNAL_NORMAL;
          ctx.textAlign = 'center';
          ctx.fillText(p.isArrhythmia ? 'A' : 'N', p.x, p.y - 16);
          
          // Pulsating halo for arrhythmia
          if (p.isArrhythmia) {
            const alpha = (Math.sin(now / 80) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.3 + alpha * 0.5})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            
            // Second outer ring
            ctx.beginPath();
            ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.1 + alpha * 0.2})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
        
        // Draw valley markers
        valleys.forEach(v => {
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 3);
          ctx.lineTo(v.x - 4, v.y + 10);
          ctx.lineTo(v.x + 4, v.y + 10);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
          
          ctx.font = '8px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText('V', v.x, v.y + 22);
        });
      }
      
      // === BEAT HISTORY (last 20) ===
      const beatHistory = beatHistoryRef.current;
      if (beatHistory.length > 0) {
        const histX = plot.x;
        const histY = plot.y + plot.height + 30;
        const dotRadius = 7;
        const dotSpacing = 18;
        const totalWidth = beatHistory.length * dotSpacing;
        const startX = histX + (plot.width - totalWidth) / 2;
        
        ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
        const panelPad = 8;
        ctx.fillRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 14);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 14);
        
        ctx.font = '8px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText('HISTORIAL DE LATIDOS', startX + totalWidth / 2, histY - dotRadius - 1);
        
        // Count arrhythmias in history
        const arrCount = beatHistory.filter(b => b.isArrhythmia).length;
        const normalCount = beatHistory.length - arrCount;
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.SIGNAL_NORMAL;
        ctx.fillText(`N:${normalCount}`, startX + totalWidth + panelPad - 2, histY - dotRadius - 1);
        ctx.fillStyle = arrCount > 0 ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.TEXT_SECONDARY;
        ctx.fillText(`A:${arrCount}`, startX - 2, histY - dotRadius - 1);
        ctx.textAlign = 'center';
        
        beatHistory.forEach((beat, i) => {
          const cx = startX + i * dotSpacing + dotSpacing / 2;
          const cy = histY + 6;
          
          if (beat.isArrhythmia) {
            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius + 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.fill();
          }
          
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = beat.isArrhythmia ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
          ctx.fill();
          
          ctx.font = 'bold 7px "SF Mono", Consolas, monospace';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, cx, cy + 3);
        });
      }
      
      // === LEGEND ===
      const legendY = CONFIG.CANVAS_HEIGHT - 15;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const lx = CONFIG.PLOT_AREA.LEFT;
      
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(lx, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 22, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal (N)', lx + 30, legendY);
      
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(lx + 110, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 132, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia (A)', lx + 140, legendY);
      
      ctx.beginPath();
      ctx.arc(lx + 230, legendY - 4, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.PEAK_NORMAL;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Pico', lx + 240, legendY);
      
      ctx.beginPath();
      ctx.moveTo(lx + 275, legendY - 6);
      ctx.lineTo(lx + 271, legendY);
      ctx.lineTo(lx + 279, legendY);
      ctx.closePath();
      ctx.fillStyle = COLORS.VALLEY_COLOR;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Valle', lx + 285, legendY);
      
      // IBI legend
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillRect(lx + 320, legendY - 5, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('IBI', lx + 338, legendY);
      
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
    <div className="fixed inset-0" style={{ backgroundColor: '#000000' }}>
      <canvas
        ref={canvasRef}
        width={CONFIG.CANVAS_WIDTH}
        height={CONFIG.CANVAS_HEIGHT}
        className="w-full h-full absolute inset-0"
      />

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
