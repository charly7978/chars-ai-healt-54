import React, { useLayoutEffect, useRef, useState } from 'react';
import { Activity, Heart, Play, Radio, Square } from 'lucide-react';
import { CardiacMonitor } from '@/components/monitor/CardiacMonitor';
import type { ElitePPGResult } from '@/modules/integration/ElitePPGProcessor';

export interface HospitalMonitorLayoutProps {
  eliteData: ElitePPGResult | null;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
  isMonitoring: boolean;
  diagnosticMessage?: string;
}

/**
 * Vista principal “clásica”: monitor hospitalario (onda + Poincaré) + misma barra de acción que antes.
 * Los datos vienen del mismo ElitePPGProcessor que Index (sin segundo pipeline).
 */
const HospitalMonitorLayout: React.FC<HospitalMonitorLayoutProps> = ({
  eliteData,
  quality,
  isFingerDetected,
  onStartMeasurement,
  onReset,
  isMonitoring,
  diagnosticMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.max(280, Math.floor(r.width)),
        h: Math.max(220, Math.floor(r.height)),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showPoincare = size.w >= 420;

  return (
    <div className="fixed inset-0 z-[15] flex flex-col bg-[#0a0a0f]">
      <header className="monitor-header-grid shrink-0 border-b border-emerald-500/20 bg-gradient-to-b from-[#0a0a0f] via-[#0f172a]/95 to-transparent px-3 pb-3 pt-[max(10px,env(safe-area-inset-top))] backdrop-blur-md sm:px-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40">
              <Heart className="h-6 w-6 text-emerald-400" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-emerald-500/90">
                  Cardiac monitor
                </p>
                <Radio className="h-3.5 w-3.5 text-emerald-600/80" aria-hidden />
              </div>
              <h1 className="truncate text-base font-bold tracking-tight text-white sm:text-lg">PPG en tiempo real</h1>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
            <div className="flex flex-wrap justify-end gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                  isFingerDetected
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/35'
                    : 'bg-slate-800/90 text-slate-500 ring-1 ring-white/10'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${isFingerDetected ? 'bg-emerald-400' : 'bg-slate-600'}`}
                />
                {isFingerDetected ? 'Contacto' : 'Sin contacto'}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ring-1 ${
                  isMonitoring
                    ? 'bg-rose-500/15 text-rose-200 ring-rose-400/40'
                    : 'bg-slate-800/90 text-slate-500 ring-white/10'
                }`}
              >
                {isMonitoring ? '● Registro' : '○ Espera'}
              </span>
            </div>
            <div className="w-full sm:w-48">
              <div className="mb-1 flex justify-between text-[9px] font-medium uppercase tracking-wider text-slate-500">
                <span>SQI</span>
                <span className="font-mono text-emerald-200/90">{quality.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-900 ring-1 ring-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-700 via-emerald-400 to-lime-300 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, quality))}%` }}
                />
              </div>
            </div>
            {diagnosticMessage ? (
              <p className="max-h-10 w-full overflow-hidden text-right font-mono text-[10px] leading-snug text-emerald-200/70 sm:max-w-[22rem]">
                {diagnosticMessage}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div ref={containerRef} className="min-h-0 w-full flex-1 overflow-hidden">
        <CardiacMonitor
          width={size.w}
          height={size.h}
          data={eliteData}
          showPoincare={showPoincare}
          showHRVMetrics={showPoincare}
          enableAudio={isMonitoring}
        />
      </div>

      <div className="grid h-[4.25rem] shrink-0 grid-cols-2 gap-px rounded-t-2xl border border-emerald-500/20 bg-slate-950/95 pb-[max(0.35rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:h-[4.5rem]">
        <button
          type="button"
          onClick={onStartMeasurement}
          className={`monitor-dock-btn flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-tl-2xl border-0 sm:flex-row sm:gap-2 ${
            isMonitoring
              ? 'bg-gradient-to-b from-rose-600/35 to-rose-950/45 text-rose-50'
              : 'bg-gradient-to-b from-emerald-600/45 to-emerald-950/55 text-emerald-50'
          }`}
        >
          {isMonitoring ? (
            <Square className="h-5 w-5 opacity-90 sm:h-6 sm:w-6" strokeWidth={2.5} />
          ) : (
            <Play className="h-5 w-5 opacity-90 sm:h-6 sm:w-6" strokeWidth={2.5} />
          )}
          <span className="text-sm font-bold tracking-wide sm:text-base">{isMonitoring ? 'Detener' : 'Iniciar'}</span>
        </button>
        <button
          type="button"
          onClick={onReset}
          className="monitor-dock-btn flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-tr-2xl border-0 bg-gradient-to-b from-slate-800/95 to-slate-950/95 text-slate-100 sm:flex-row sm:gap-2"
        >
          <Activity className="h-5 w-5 opacity-80 sm:h-6 sm:w-6" strokeWidth={2} />
          <span className="text-sm font-bold tracking-wide sm:text-base">Reiniciar</span>
        </button>
      </div>
    </div>
  );
};

export default HospitalMonitorLayout;
