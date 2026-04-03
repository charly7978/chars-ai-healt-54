import React, { useState } from "react";
import { X, ChevronRight, ChevronLeft, Shield, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";

interface BPCalibrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCalibrate: (systolic: number, diastolic: number) => boolean | Promise<boolean>;
  signalQuality?: number;
  featureQuality?: number;
}

type Step = "intro" | "instructions" | "input" | "confirm";

const BPCalibrationWizard: React.FC<BPCalibrationWizardProps> = ({
  isOpen,
  onClose,
  onCalibrate,
  signalQuality = 0,
  featureQuality = 0,
}) => {
  const [step, setStep] = useState<Step>("intro");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [saving, setSaving] = useState(false);

  const signalSufficient = signalQuality >= 50 && featureQuality >= 30;

  if (!isOpen) return null;

  const systolicNum = parseInt(systolic);
  const diastolicNum = parseInt(diastolic);

  const isValidBP =
    !isNaN(systolicNum) &&
    !isNaN(diastolicNum) &&
    systolicNum >= 70 &&
    systolicNum <= 250 &&
    diastolicNum >= 40 &&
    diastolicNum <= 150 &&
    systolicNum > diastolicNum &&
    systolicNum - diastolicNum >= 15;

  const handleConfirm = async () => {
    if (!isValidBP) return;
    setSaving(true);

    try {
      // Save to database
      const { data: { user } } = await supabase.auth.getUser();
      const calibrationApplied = await onCalibrate(systolicNum, diastolicNum);

      if (!calibrationApplied) {
        toast({
          title: "Medición PPG insuficiente",
          description: "Primero obtén una estimación de presión válida para que la calibración sea complementaria.",
          variant: "destructive",
        });
        return;
      }

      if (user) {
        await supabase.from("calibration_settings").upsert({
          user_id: user.id,
          systolic_reference: systolicNum,
          diastolic_reference: diastolicNum,
          status: "completed" as const,
          last_calibration_date: new Date().toISOString(),
          is_active: true,
        }, { onConflict: "user_id" });
      }

      toast({
        title: "✅ Calibración exitosa",
        description: `Referencia: ${systolicNum}/${diastolicNum} mmHg`,
        duration: 4000,
      });

      handleClose();
    } catch (err) {
      console.error("Error saving calibration:", err);
      toast({
        title: "Error al guardar",
        description: "Inténtalo de nuevo",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setStep("intro");
    setSystolic("");
    setDiastolic("");
    onClose();
  };

  const renderStep = () => {
    switch (step) {
      case "intro":
        return (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Shield className="w-8 h-8 text-blue-400" />
              </div>
            </div>
            <h3 className="text-white text-lg font-bold text-center">
              Calibración de Presión Arterial
            </h3>
            <p className="text-slate-400 text-sm text-center leading-relaxed">
              Para mejorar la precisión de las estimaciones, ingresa una medición
              reciente tomada con un <strong className="text-slate-300">tensiómetro de manguito</strong>.
            </p>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
              <div className="flex gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <p className="text-yellow-300/90 text-xs leading-relaxed">
                  La medición de referencia debe ser tomada en reposo, con un tensiómetro
                  validado, idealmente en los últimos 30 minutos.
                </p>
              </div>
            </div>
            <button
              onClick={() => setStep("instructions")}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              Comenzar <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        );

      case "instructions":
        return (
          <div className="space-y-4">
            <h3 className="text-white text-base font-bold">Instrucciones</h3>
            <ol className="space-y-3">
              {[
                "Siéntate cómodamente y descansa 5 minutos",
                "Coloca el manguito en el brazo izquierdo",
                "Toma la medición con el tensiómetro",
                "Anota los valores de Sistólica y Diastólica",
              ].map((text, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <span className="text-slate-300 text-sm">{text}</span>
                </li>
              ))}
            </ol>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("intro")}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Atrás
              </button>
              <button
                onClick={() => setStep("input")}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                Ingresar valores <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        );

      case "input":
        return (
          <div className="space-y-4">
            <h3 className="text-white text-base font-bold">Valores de Referencia</h3>

            <div className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs font-medium block mb-1.5">
                  Presión Sistólica (alta)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={systolic}
                    onChange={(e) => setSystolic(e.target.value)}
                    placeholder="120"
                    min={70}
                    max={250}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-xl font-bold text-center placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    mmHg
                  </span>
                </div>
                {systolic && (systolicNum < 70 || systolicNum > 250) && (
                  <p className="text-red-400 text-xs mt-1">Valor fuera de rango (70-250)</p>
                )}
              </div>

              <div>
                <label className="text-slate-400 text-xs font-medium block mb-1.5">
                  Presión Diastólica (baja)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={diastolic}
                    onChange={(e) => setDiastolic(e.target.value)}
                    placeholder="80"
                    min={40}
                    max={150}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-xl font-bold text-center placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    mmHg
                  </span>
                </div>
                {diastolic && (diastolicNum < 40 || diastolicNum > 150) && (
                  <p className="text-red-400 text-xs mt-1">Valor fuera de rango (40-150)</p>
                )}
              </div>

              {systolic && diastolic && !isNaN(systolicNum) && !isNaN(diastolicNum) && systolicNum <= diastolicNum && (
                <p className="text-red-400 text-xs">La sistólica debe ser mayor que la diastólica</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setStep("instructions")}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Atrás
              </button>
              <button
                onClick={() => setStep("confirm")}
                disabled={!isValidBP}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                Revisar <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        );

      case "confirm":
        return (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
            </div>
            <h3 className="text-white text-base font-bold text-center">
              Confirmar Calibración
            </h3>

            <div className="bg-slate-800/80 rounded-xl p-4 text-center border border-slate-700/50">
              <p className="text-slate-400 text-xs mb-2">Valores de referencia</p>
              <div className="text-white text-3xl font-bold">
                {systolicNum}/{diastolicNum}
              </div>
              <p className="text-slate-500 text-xs mt-1">mmHg</p>
            </div>

              <p className="text-slate-400 text-xs text-center leading-relaxed">
                Estos valores se usarán como corrección complementaria sobre la
                estimación PPG actual, no como reemplazo directo.
            </p>

            {!signalSufficient && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-red-300 text-xs font-semibold">Señal insuficiente</p>
                  <p className="text-red-400/70 text-[10px] mt-0.5">
                    SQI: {signalQuality.toFixed(0)}% (mín. 50%) · FQ: {featureQuality.toFixed(0)} (mín. 30).
                    Mejore la colocación del dedo y espere estabilización.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setStep("input")}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium flex items-center justify-center gap-1 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Editar
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving || !signalSufficient}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:bg-slate-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1 transition-colors"
              >
                {saving ? "Guardando..." : !signalSufficient ? "⚠ Señal baja" : "Confirmar"}
              </button>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 border border-slate-700/50 rounded-2xl max-w-sm w-[92%] shadow-2xl overflow-hidden">
        {/* Close button */}
        <div className="flex justify-end p-3 pb-0">
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex justify-center gap-1.5 px-6 pb-3">
          {(["intro", "instructions", "input", "confirm"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1 rounded-full transition-all ${
                (["intro", "instructions", "input", "confirm"] as Step[]).indexOf(step) >= i
                  ? "bg-blue-500 w-8"
                  : "bg-slate-700 w-4"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-5 pb-5">{renderStep()}</div>
      </div>
    </div>
  );
};

export default BPCalibrationWizard;
