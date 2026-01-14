import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart, Activity } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
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

// Configuración del monitor profesional
const CONFIG = {
  CANVAS_WIDTH: 1400,
  CANVAS_HEIGHT: 2800,
  WINDOW_MS: 2800, // 6 segundos de ventana
  TARGET_FPS: 30,
  BUFFER_SIZE: 400, // 6s @ 60fps
  // Área de visualización (evitar solapamiento con info)
  PLOT_AREA: {
    LEFT: 80,    // Espacio para escala Y izquierda
    RIGHT: 80,   // Espacio para info derecha
    TOP: 100,    // Espacio para info superior
    BOTTOM: 60   // Espacio para escala tiempo
  },
  COLORS: {
    BG: '#0a0f1a',
    GRID_MAJOR: 'rgba(34, 197, 94, 0.25)',
    GRID_MINOR: 'rgba(34, 197, 94, 0.1)',
    BASELINE: 'rgba(34, 197, 94, 0.4)',
    SIGNAL_NORMAL: '#22c55e',
    SIGNAL_GLOW: 'rgba(34, 197, 94, 0.5)',
    SIGNAL_ARRHYTHMIA: '#ef4444',
    ARRHYTHMIA_GLOW: 'rgba(239, 68, 68, 0.5)',
    PEAK_NORMAL: '#3b82f6',
    PEAK_ARRHYTHMIA: '#ef4444',
    VALLEY_COLOR: '#64748b',
    TEXT_PRIMARY: '#22c55e',
    TEXT_SECONDARY: '#94a3b8',
    TEXT_WARNING: '#f59e0b',
    TEXT_DANGER: '#ef4444',
    SCALE_TEXT: '#6b7280',
  }
} as const;

const PPGSignalMeter = ({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
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
  
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  
  // Estadísticas de amplitud para escala dinámica
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });

  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals };
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals]);

  // Efecto visual de pulso
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

  // Calcular área de plot
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

  // Dibujar grid profesional con escala
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    const plot = getPlotArea();
    
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    // Fondo del área de plot ligeramente diferente
    ctx.fillStyle = 'rgba(0, 20, 10, 0.3)';
    ctx.fillRect(plot.x, plot.y, plot.width, plot.height);
    
    // Grid menor (cada 20px)
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
    
    // Grid mayor (cada 100px)
    ctx.strokeStyle = COLORS.GRID_MAJOR;
    ctx.lineWidth = 1;
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
    
    // Línea base central (0)
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Borde del área de plot
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  }, [getPlotArea]);

  // Dibujar escala de amplitud (eje Y)
  const drawAmplitudeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS } = CONFIG;
    const plot = getPlotArea();
    const stats = amplitudeStatsRef.current;
    
    ctx.font = '11px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'right';
    
    // Escala en el lado izquierdo
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = plot.y + (i / steps) * plot.height;
      const val = stats.max - (i / steps) * stats.range;
      
      // Valor
      ctx.fillText(val.toFixed(0), plot.x - 8, y + 4);
      
      // Línea de marca
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x - 5, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
    }
    
    // Etiqueta del eje
    ctx.save();
    ctx.translate(15, plot.centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillText('AMPLITUD (uV)', 0, 0);
    ctx.restore();
  }, [getPlotArea]);

  // Dibujar escala de tiempo (eje X)
  const drawTimeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS, WINDOW_MS } = CONFIG;
    const plot = getPlotArea();
    
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'center';
    
    // Marcas de tiempo cada segundo
    const seconds = WINDOW_MS / 1000;
    for (let s = 0; s <= seconds; s++) {
      const x = plot.x + plot.width - (s / seconds) * plot.width;
      
      // Valor
      ctx.fillText(`${s}s`, x, plot.y + plot.height + 20);
      
      // Línea de marca
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.height);
      ctx.lineTo(x, plot.y + plot.height + 5);
      ctx.stroke();
    }
    
    // Velocidad de barrido
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.TEXT_PRIMARY;
    ctx.fillText('25mm/s', plot.x + plot.width, plot.y + plot.height + 40);
  }, [getPlotArea]);

  // Dibujar información vital (paneles separados)
  const drawVitalInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality, rrIntervals } = propsRef.current;
    
    // === PANEL SUPERIOR IZQUIERDO: BPM ===
    ctx.fillStyle = 'rgba(0, 30, 15, 0.8)';
    ctx.fillRect(5, 5, 130, 85);
    ctx.strokeStyle = COLORS.TEXT_PRIMARY;
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, 130, 85);
    
    ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('♥ FRECUENCIA', 12, 22);
    
    ctx.font = 'bold 42px "SF Mono", Consolas, monospace';
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
    ctx.fillText(bpm > 0 ? bpm.toString() : '--', 12, 65);
    
    ctx.font = '14px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('BPM', 100, 65);
    
    // === PANEL SUPERIOR DERECHO: SpO2 ===
    ctx.fillStyle = 'rgba(0, 15, 30, 0.8)';
    ctx.fillRect(W - 135, 5, 130, 85);
    ctx.strokeStyle = spo2 >= 95 ? COLORS.TEXT_PRIMARY : 
                      spo2 >= 90 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.strokeRect(W - 135, 5, 130, 85);
    
    ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('O₂ SATURACIÓN', W - 128, 22);
    
    ctx.font = 'bold 42px "SF Mono", Consolas, monospace';
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : 
                      spo2 >= 90 ? COLORS.TEXT_WARNING : 
                      spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
    ctx.fillStyle = spo2Color;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - 128, 65);
    
    ctx.font = '14px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('%', W - 35, 65);
    
    // === PANEL CENTRO SUPERIOR: Calidad y RR ===
    const centerX = W / 2;
    ctx.fillStyle = 'rgba(20, 20, 30, 0.8)';
    ctx.fillRect(centerX - 90, 5, 180, 50);
    ctx.strokeStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                      quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - 90, 5, 180, 50);
    
    // Calidad de señal
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('CALIDAD SEÑAL', centerX, 20);
    
    // Barra de calidad
    const barWidth = 140;
    const barHeight = 8;
    const barX = centerX - barWidth / 2;
    const barY = 26;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                    quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    
    // Valor de calidad
    ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
    ctx.fillText(`${quality.toFixed(0)}%`, centerX, 48);
    
    // Último RR interval
    if (rrIntervals && rrIntervals.length > 0) {
      const lastRR = rrIntervals[rrIntervals.length - 1];
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`RR: ${lastRR.toFixed(0)}ms`, centerX + 85, 48);
    }
    
    // === INDICADOR DE ARRITMIA ===
    if (arrhythmiaStatus?.includes('ARRITMIA')) {
      const parts = arrhythmiaStatus.split('|');
      const count = parts.length > 1 ? parseInt(parts[1]) : 0;
      
      // Panel pulsante en el lado derecho
      const pulse = (Math.sin(now / 100) + 1) / 2;
      ctx.fillStyle = `rgba(239, 68, 68, ${0.3 + pulse * 0.4})`;
      ctx.fillRect(W - 135, 92, 130, 28);
      ctx.strokeStyle = COLORS.TEXT_DANGER;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - 135, 92, 130, 28);
      
      ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_DANGER;
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ARRITMIA x${count}`, W - 70, 110);
    }
  }, []);

  // Loop de renderizado principal
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
      
      // Dibujar fondo, grid y escalas
      drawGrid(ctx);
      drawAmplitudeScale(ctx);
      drawTimeScale(ctx);
      drawVitalInfo(ctx, now);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // === PROCESAMIENTO DE SEÑAL ===
      // Escalar valor a amplitud visual controlada
      const scaledValue = signalValue * 2; // Amplificación para visualización
      
      // Detectar si es arritmia
      const currentIsArrhythmia = peak && arrStatus?.includes('ARRITMIA');
      
      // Agregar punto al buffer
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia || false
      });
      
      // Actualizar estadísticas de amplitud dinámicamente
      const points = buffer.getPoints();
      if (points.length > 30) {
        const recentPoints = points.slice(-150);
        const values = recentPoints.map(p => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(40, max - min); // Mínimo 40 de rango
        
        // Suavizar cambios de escala
        const stats = amplitudeStatsRef.current;
        stats.min = stats.min * 0.95 + (min - range * 0.1) * 0.05;
        stats.max = stats.max * 0.95 + (max + range * 0.1) * 0.05;
        stats.range = stats.max - stats.min;
      }
      
      const stats = amplitudeStatsRef.current;
      
      // === DIBUJAR SEÑAL PPG ===
      if (points.length > 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let prevX: number | null = null;
        let prevY: number | null = null;
        
        // Arrays para marcar picos y valles
        const peaks: { x: number; y: number; isArrhythmia: boolean }[] = [];
        const valleys: { x: number; y: number }[] = [];
        
        // Dibujar segmentos
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          // Posición X: el más reciente a la derecha
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          
          // Posición Y: normalizada a la escala
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          // Clip al área de plot
          if (x < plot.x || x > plot.x + plot.width) continue;
          
          if (prevX !== null && prevY !== null) {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            
            if (pt.isArrhythmia) {
              ctx.strokeStyle = COLORS.SIGNAL_ARRHYTHMIA;
              ctx.shadowColor = COLORS.ARRHYTHMIA_GLOW;
              ctx.shadowBlur = 15;
              ctx.lineWidth = 3.5;
            } else {
              ctx.strokeStyle = COLORS.SIGNAL_NORMAL;
              ctx.shadowColor = COLORS.SIGNAL_GLOW;
              ctx.shadowBlur = 10;
              ctx.lineWidth = 2.5;
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          prevX = x;
          prevY = y;
        }
        
        // === DETECTAR Y MARCAR PICOS/VALLES ===
        const recentPoints = points.filter(p => now - p.time < WINDOW_MS);
        
        for (let i = 3; i < recentPoints.length - 3; i++) {
          const pt = recentPoints[i];
          const age = now - pt.time;
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          if (x < plot.x || x > plot.x + plot.width) continue;
          
          const prev1 = recentPoints[i - 1].value;
          const prev2 = recentPoints[i - 2].value;
          const prev3 = recentPoints[i - 3].value;
          const next1 = recentPoints[i + 1].value;
          const next2 = recentPoints[i + 2].value;
          const next3 = recentPoints[i + 3].value;
          
          // Detectar pico (máximo local significativo)
          const isPeakPoint = pt.value > prev1 && pt.value > prev2 && pt.value > prev3 &&
                              pt.value > next1 && pt.value > next2 && pt.value > next3 &&
                              pt.value > stats.min + stats.range * 0.4;
          
          // Detectar valle (mínimo local significativo)
          const isValley = pt.value < prev1 && pt.value < prev2 && pt.value < prev3 &&
                          pt.value < next1 && pt.value < next2 && pt.value < next3 &&
                          pt.value < stats.max - stats.range * 0.4;
          
          if (isPeakPoint) {
            peaks.push({ x, y, isArrhythmia: pt.isArrhythmia });
          }
          
          if (isValley) {
            valleys.push({ x, y });
          }
        }
        
        // Dibujar marcadores de pico
        peaks.forEach(p => {
          // Círculo del pico
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.isArrhythmia ? 7 : 5, 0, Math.PI * 2);
          ctx.fillStyle = p.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          ctx.fill();
          
          // Etiqueta
          ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(p.isArrhythmia ? 'A' : 'R', p.x, p.y - 12);
          
          // Halo para arritmia
          if (p.isArrhythmia) {
            const alpha = (Math.sin(now / 80) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 + alpha * 0.5})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        });
        
        // Dibujar marcadores de valle
        valleys.forEach(v => {
          // Triángulo pequeño hacia abajo
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 3);
          ctx.lineTo(v.x - 4, v.y + 10);
          ctx.lineTo(v.x + 4, v.y + 10);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
          
          // Etiqueta
          ctx.font = '8px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText('V', v.x, v.y + 22);
        });
      }
      
      // === LEYENDA ===
      const legendY = CONFIG.CANVAS_HEIGHT - 15;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      
      // Normal
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(CONFIG.PLOT_AREA.LEFT, legendY - 6, 15, 3);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal', CONFIG.PLOT_AREA.LEFT + 20, legendY);
      
      // Arritmia
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(CONFIG.PLOT_AREA.LEFT + 80, legendY - 6, 15, 3);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia', CONFIG.PLOT_AREA.LEFT + 100, legendY);
      
      // Pico R
      ctx.beginPath();
      ctx.arc(CONFIG.PLOT_AREA.LEFT + 175, legendY - 4, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.PEAK_NORMAL;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Pico R', CONFIG.PLOT_AREA.LEFT + 185, legendY);
      
      // Valle
      ctx.beginPath();
      ctx.moveTo(CONFIG.PLOT_AREA.LEFT + 240, legendY - 6);
      ctx.lineTo(CONFIG.PLOT_AREA.LEFT + 236, legendY);
      ctx.lineTo(CONFIG.PLOT_AREA.LEFT + 244, legendY);
      ctx.closePath();
      ctx.fillStyle = COLORS.VALLEY_COLOR;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Valle', CONFIG.PLOT_AREA.LEFT + 250, legendY);
      
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

      {/* Header con icono de pulso */}
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
        <span className="text-[10px] font-mono text-emerald-400/80">PPG MONITOR v2</span>
      </div>

      {/* Botones */}
      <div className="fixed bottom-0 left-0 right-0 h-12 grid grid-cols-2 z-10">
        <button 
          onClick={onStartMeasurement}
          className="bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 
                     text-emerald-400 font-semibold text-sm transition-colors border-t border-r border-slate-700/50"
        >
          INICIAR
        </button>
        <button 
          onClick={handleReset}
          className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 
                     text-slate-300 font-semibold text-sm transition-colors border-t border-slate-700/50"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;
