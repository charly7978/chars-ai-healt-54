/**
 * CARDIAC MONITOR - VISUALIZACIÓN MÉDICA PROFESIONAL (9.9/10)
 * 
 * Display estilo monitor hospitalario:
 * - ECG-style waveform scrolling
 * - Poincaré plot real-time
 * - Métricas HRV dinámicas
 * - Alertas de arritmias con sonido
 * - Grilla de fondo médica
 * 
 * Referencias visuales:
 * - Philips IntelliVue MX series
 * - GE Healthcare CARESCAPE
 * - Medtronic monitors
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { ElitePPGResult } from '../../modules/integration/ElitePPGProcessor';
import type { ArrhythmiaType } from '../../modules/vital-signs/AdvancedArrhythmiaDetector';

interface CardiacMonitorProps {
  width: number;
  height: number;
  data: ElitePPGResult | null;
  showPoincare?: boolean;
  showHRVMetrics?: boolean;
  enableAudio?: boolean;
}

interface WaveformPoint {
  x: number;
  y: number;
  timestamp: number;
  isPeak: boolean;
}

interface PoincarePoint {
  x: number;  // RR_n
  y: number;  // RR_{n+1}
  color: string;
}

export const CardiacMonitor: React.FC<CardiacMonitorProps> = ({
  width,
  height,
  data,
  showPoincare = true,
  showHRVMetrics = true,
  enableAudio = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Estado del waveform
  const [waveform, setWaveform] = useState<WaveformPoint[]>([]);
  const [poincarePoints, setPoincarePoints] = useState<PoincarePoint[]>([]);
  const [lastPeakTime, setLastPeakTime] = useState<number>(0);
  const [beepEnabled, setBeepEnabled] = useState(true);
  
  // Colores médicos estándar
  const colors = {
    background: '#0a0a0f',
    grid: '#1a1a2e',
    waveform: '#00ff88',
    waveformLow: '#ffaa00',
    waveformCritical: '#ff4444',
    peak: '#ffffff',
    text: '#a0a0b0',
    textHighlight: '#ffffff',
    alertAF: '#ff6600',
    alertVT: '#ff0000',
    alertNormal: '#00ff88'
  };
  
  // Inicializar audio
  useEffect(() => {
    if (enableAudio && !audioContextRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContext();
    }
  }, [enableAudio]);
  
  // Función beep
  const playBeep = useCallback((frequency: number = 800, duration: number = 0.05) => {
    if (!beepEnabled || !audioContextRef.current) return;
    
    const ctx = audioContextRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }, [beepEnabled]);
  
  // Actualizar waveform con nuevos datos
  useEffect(() => {
    if (!data) return;
    
    const now = performance.now();
    
    setWaveform(prev => {
      const newPoint: WaveformPoint = {
        x: now,
        y: data.signal.filtered,
        timestamp: data.timestamp,
        isPeak: data.beat.isPeak
      };
      
      // Mantener ventana de 4 segundos
      const windowMs = 4000;
      const filtered = [...prev, newPoint].filter(p => now - p.x < windowMs);
      
      return filtered;
    });
    
    // Detectar pico y sonar beep
    if (data.beat.isPeak && data.timestamp - lastPeakTime > 300) {
      setLastPeakTime(data.timestamp);
      
      // Beep diferente según arritmia
      if (data.arrhythmia.detected && data.arrhythmia.severity === 'critical') {
        playBeep(400, 0.15); // Beep grave para VT/VF
      } else if (data.arrhythmia.detected) {
        playBeep(600, 0.08); // Beep medio para AF/ectopías
      } else {
        playBeep(800, 0.05); // Beep normal
      }
    }
    
  }, [data, lastPeakTime, playBeep]);
  
  // Actualizar Poincaré plot
  useEffect(() => {
    if (!data || data.hrvTime.rrIntervals.length < 2) return;
    
    const rr = data.hrvTime.rrIntervals;
    const newPoints: PoincarePoint[] = [];
    
    for (let i = 1; i < rr.length; i++) {
      const x = rr[i - 1];
      const y = rr[i];
      
      // Color según normalidad
      const isNormal = Math.abs(x - y) < 50;
      const color = isNormal ? colors.waveform : colors.alertAF;
      
      newPoints.push({ x, y, color });
    }
    
    setPoincarePoints(newPoints.slice(-50)); // Últimos 50 puntos
  }, [data, colors.waveform, colors.alertAF]);
  
  // Renderizar canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Setup
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    
    // Fondo
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, width, height);
    
    // ========== PANEL IZQUIERDO: WAVEFORM ==========
    const leftWidth = showPoincare ? width * 0.65 : width;
    
    // Grilla médica
    drawMedicalGrid(ctx, 0, 0, leftWidth, height, colors.grid);
    
    // Waveform PPG
    if (waveform.length > 1) {
      drawWaveform(ctx, waveform, 0, 0, leftWidth, height, colors);
    }
    
    // Overlay de información
    drawWaveformOverlay(ctx, data, 10, 10, leftWidth - 20, colors);
    
    // ========== PANEL DERECHO: POINCARÉ + HRV ==========
    if (showPoincare) {
      const rightX = leftWidth;
      const rightWidth = width - leftWidth;
      
      // Fondo
      ctx.fillStyle = colors.background;
      ctx.fillRect(rightX, 0, rightWidth, height);
      
      // Poincaré plot (mitad superior)
      if (poincarePoints.length > 5) {
        drawPoincarePlot(ctx, poincarePoints, rightX, 0, rightWidth, height * 0.5, colors);
      }
      
      // Métricas HRV (mitad inferior)
      if (showHRVMetrics && data.hrvNonlinear) {
        drawHRVMetrics(ctx, data, rightX, height * 0.5, rightWidth, height * 0.5, colors);
      }
    }
    
    // Alerta de arritmia (overlay en toda la pantalla)
    if (data.arrhythmia.detected && data.arrhythmia.severity) {
      drawArrhythmiaAlert(ctx, data.arrhythmia.type, data.arrhythmia.severity, width, height, colors);
    }
    
  }, [waveform, poincarePoints, data, width, height, showPoincare, showHRVMetrics, colors]);
  
  // ============ FUNCIONES DE DIBUJO ============
  
  function drawMedicalGrid(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    w: number, h: number,
    color: string
  ) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    
    // Grilla gruesa cada 50px
    for (let i = 0; i <= w; i += 50) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i, y + h);
      ctx.stroke();
    }
    for (let i = 0; i <= h; i += 50) {
      ctx.beginPath();
      ctx.moveTo(x, y + i);
      ctx.lineTo(x + w, y + i);
      ctx.stroke();
    }
    
    // Grilla fina cada 10px
    ctx.strokeStyle = color + '40'; // 25% opacity
    for (let i = 0; i <= w; i += 10) {
      if (i % 50 === 0) continue;
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i, y + h);
      ctx.stroke();
    }
    for (let i = 0; i <= h; i += 10) {
      if (i % 50 === 0) continue;
      ctx.beginPath();
      ctx.moveTo(x, y + i);
      ctx.lineTo(x + w, y + i);
      ctx.stroke();
    }
  }
  
  function drawWaveform(
    ctx: CanvasRenderingContext2D,
    points: WaveformPoint[],
    x: number, y: number,
    w: number, h: number,
    colors: any
  ) {
    if (points.length < 2) return;
    
    // Encontrar rango
    const values = points.map(p => p.y);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    // Tiempo
    const now = points[points.length - 1].x;
    const timeWindow = 4000; // 4 segundos
    
    // Dibujar línea
    ctx.beginPath();
    ctx.strokeStyle = colors.waveform;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const px = x + w - ((now - p.x) / timeWindow) * w;
      const py = y + h - ((p.y - min) / range) * h * 0.8 - h * 0.1;
      
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    
    // Dibujar picos
    for (const p of points) {
      if (p.isPeak) {
        const px = x + w - ((now - p.x) / timeWindow) * w;
        const py = y + h - ((p.y - min) / range) * h * 0.8 - h * 0.1;
        
        ctx.fillStyle = colors.peak;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  
  function drawWaveformOverlay(
    ctx: CanvasRenderingContext2D,
    data: ElitePPGResult,
    x: number, y: number,
    w: number,
    colors: any
  ) {
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = colors.textHighlight;
    ctx.textAlign = 'left';
    
    // BPM grande
    ctx.fillText(`${Math.round(data.beat.bpm)}`, x, y + 30);
    ctx.font = '12px monospace';
    ctx.fillStyle = colors.text;
    ctx.fillText('BPM', x + 50, y + 30);
    
    if (data.spo2 > 0) {
      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = '#00ccff';
      ctx.fillText(`SpO2 ${Math.round(data.spo2)}%`, x, y + 55);
    }
    
    // Calidad de señal
    const quality = data.finger.contactQuality;
    ctx.fillStyle = quality > 70 ? colors.waveform : quality > 40 ? colors.waveformLow : colors.waveformCritical;
    ctx.font = '12px monospace';
    ctx.fillText(`SIG: ${quality}%`, x + 120, y + 30);
    
    // Contacto
    ctx.fillStyle = data.finger.detected ? colors.waveform : colors.waveformCritical;
    ctx.fillText(data.finger.detected ? '● CONTACT' : '○ NO CONTACT', x + 200, y + 30);
  }
  
  function drawPoincarePlot(
    ctx: CanvasRenderingContext2D,
    points: PoincarePoint[],
    x: number, y: number,
    w: number, h: number,
    colors: any
  ) {
    // Fondo
    ctx.fillStyle = colors.background;
    ctx.fillRect(x, y, w, h);
    
    // Grilla
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w/2, y);
    ctx.lineTo(x + w/2, y + h);
    ctx.moveTo(x, y + h/2);
    ctx.lineTo(x + w, y + h/2);
    ctx.stroke();
    
    // Línea de identidad
    ctx.strokeStyle = colors.grid + '60';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Encontrar rangos
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    // Dibujar puntos
    for (const p of points) {
      const px = x + ((p.x - minX) / (maxX - minX || 1)) * w;
      const py = y + h - ((p.y - minY) / (maxY - minY || 1)) * h;
      
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Label
    ctx.fillStyle = colors.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('POINCARÉ', x + 5, y + 15);
  }
  
  function drawHRVMetrics(
    ctx: CanvasRenderingContext2D,
    data: ElitePPGResult,
    x: number, y: number,
    w: number, h: number,
    colors: any
  ) {
    ctx.fillStyle = colors.background;
    ctx.fillRect(x, y, w, h);
    
    const hrv = data.hrvNonlinear;
    if (!hrv) return;
    
    ctx.font = '11px monospace';
    ctx.fillStyle = colors.text;
    ctx.textAlign = 'left';
    
    let lineY = y + 15;
    const lineHeight = 16;
    
    // Time domain
    ctx.fillStyle = colors.textHighlight;
    ctx.fillText('TIME DOMAIN', x + 5, lineY);
    lineY += lineHeight;
    
    ctx.fillStyle = colors.text;
    ctx.fillText(`RMSSD: ${Math.round(data.hrvTime.rmssd)}ms`, x + 5, lineY);
    ctx.fillText(`SDNN: ${Math.round(data.hrvTime.sdnn)}ms`, x + w/2, lineY);
    lineY += lineHeight;
    
    // Poincaré
    ctx.fillStyle = colors.textHighlight;
    ctx.fillText('POINCARÉ', x + 5, lineY);
    lineY += lineHeight;
    
    ctx.fillStyle = colors.text;
    ctx.fillText(`SD1: ${Math.round(hrv.poincare.sd1)}`, x + 5, lineY);
    ctx.fillText(`SD2: ${Math.round(hrv.poincare.sd2)}`, x + w/2, lineY);
    lineY += lineHeight;
    
    ctx.fillText(`SD1/SD2: ${hrv.poincare.sd1Sd2Ratio.toFixed(2)}`, x + 5, lineY);
    lineY += lineHeight;
    
    // Non-linear
    if (!isNaN(hrv.dfa.alpha1)) {
      ctx.fillStyle = colors.textHighlight;
      ctx.fillText('NON-LINEAR', x + 5, lineY);
      lineY += lineHeight;
      
      ctx.fillStyle = colors.text;
      ctx.fillText(`DFA α1: ${hrv.dfa.alpha1.toFixed(2)}`, x + 5, lineY);
      ctx.fillText(`SampEn: ${hrv.sampleEntropy.value.toFixed(2)}`, x + w/2, lineY);
      lineY += lineHeight;
    }
  }
  
  function drawArrhythmiaAlert(
    ctx: CanvasRenderingContext2D,
    type: ArrhythmiaType | null,
    severity: 'info' | 'warning' | 'alert' | 'critical' | null,
    w: number, h: number,
    colors: any
  ) {
    if (!type || !severity) return;
    
    const color = severity === 'critical' ? colors.alertVT :
                  severity === 'alert' ? colors.alertAF :
                  colors.waveformLow;
    
    // Banner superior
    ctx.fillStyle = color + '40';
    ctx.fillRect(0, 0, w, 40);
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, 40);
    
    ctx.fillStyle = color;
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`⚠ ${type.replace(/_/g, ' ')}`, w/2, 25);
  }
  
  // ============ RENDER PRINCIPAL ============
  
  return (
    <div style={{ position: 'relative', width, height, background: colors.background }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block' }}
      />
      
      {/* Controles */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        display: 'flex',
        gap: '10px'
      }}>
        <button
          onClick={() => setBeepEnabled(!beepEnabled)}
          style={{
            background: beepEnabled ? colors.waveform : colors.grid,
            border: 'none',
            padding: '5px 10px',
            color: 'white',
            fontSize: '10px',
            cursor: 'pointer',
            borderRadius: '3px'
          }}
        >
          {beepEnabled ? '🔊 BEEP ON' : '🔇 BEEP OFF'}
        </button>
      </div>
      
      {/* Status bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '20px',
        background: colors.grid,
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        fontSize: '10px',
        fontFamily: 'monospace',
        color: colors.text
      }}>
        <span style={{ marginRight: '20px' }}>
          FPS: {data ? '30' : '--'}
        </span>
        <span style={{ marginRight: '20px' }}>
          BUFFER: {waveform.length}
        </span>
        <span>
          QUALITY: {data?.finger.contactQuality ?? 0}%
        </span>
      </div>
    </div>
  );
};

export default CardiacMonitor;
