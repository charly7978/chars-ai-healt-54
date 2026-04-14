import { Activity, Cpu, Sparkles } from "lucide-react";

interface ClinicalTopBarProps {
  isMonitoring: boolean;
  elapsedSeconds: number;
  signalQuality: number;
  isCalibrating: boolean;
  calibrationProgress: number;
}

function formatElapsed(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function ClinicalTopBar({
  isMonitoring,
  elapsedSeconds,
  signalQuality,
  isCalibrating,
  calibrationProgress,
}: ClinicalTopBarProps) {
  const q = Math.max(0, Math.min(100, signalQuality));

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 top-0 z-[24] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
      aria-hidden
    >
      <div className="clinical-topbar-glass relative flex w-full max-w-2xl items-center justify-between gap-3 rounded-b-2xl border border-cyan-500/20 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/20 to-teal-600/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <Sparkles className="h-4 w-4 text-cyan-300/90" />
          </div>
          <div className="min-w-0 text-left">
            <p className="truncate font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/95">
              HealthPulse
            </p>
            <p className="truncate text-[9px] font-medium tracking-wide text-slate-400/95">
              PPG · estimación no invasiva
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
          {isMonitoring && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/35 px-2 py-1 font-mono text-xs tabular-nums text-cyan-50 sm:text-sm">
              <Activity className="h-3.5 w-3.5 text-emerald-400/90" />
              <span>{formatElapsed(elapsedSeconds)}</span>
              <span className="hidden text-[9px] font-normal text-slate-500 sm:inline">
                / 60:00
              </span>
            </div>
          )}

          {isMonitoring && (
            <div
              className="flex items-center gap-1.5 sm:hidden"
              title={`Calidad de señal: ${Math.round(q)}%`}
            >
              <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    q >= 70
                      ? "bg-emerald-400"
                      : q >= 40
                        ? "bg-amber-400"
                        : "bg-rose-500"
                  }`}
                  style={{ width: `${q}%` }}
                />
              </div>
              <span className="font-mono text-[9px] text-cyan-200/90">{Math.round(q)}</span>
            </div>
          )}

          <div
            className="hidden items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1 sm:flex"
            title="Calidad de señal estimada"
          >
            <Cpu className="h-3.5 w-3.5 text-slate-400" />
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                Señal
              </span>
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      q >= 70
                        ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                        : q >= 40
                          ? "bg-gradient-to-r from-amber-600 to-amber-400"
                          : "bg-gradient-to-r from-rose-700 to-rose-500"
                    }`}
                    style={{ width: `${isMonitoring ? q : 0}%` }}
                  />
                </div>
                <span className="w-8 text-right font-mono text-[10px] text-cyan-100/90">
                  {isMonitoring ? Math.round(q) : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {isCalibrating && (
          <div className="absolute -bottom-px left-4 right-4 h-0.5 overflow-hidden rounded-full bg-slate-800/80">
            <div
              className="h-full bg-gradient-to-r from-cyan-600 via-teal-400 to-cyan-500 transition-[width] duration-300"
              style={{ width: `${calibrationProgress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
