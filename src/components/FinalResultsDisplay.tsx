
import React from 'react';
import { VitalSignsResult } from '../modules/vital-signs/VitalSignsProcessor';

interface FinalResultsDisplayProps {
  results: VitalSignsResult;
  isActive: boolean;
  className?: string;
}

const FinalResultsDisplay: React.FC<FinalResultsDisplayProps> = ({
  results,
  isActive,
  className = ''
}) => {
  if (!isActive || results.isCalibrating) return null;

  return (
    <div className={`fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 ${className}`}>
      <div className="bg-slate-900/95 border border-amber-400/30 rounded-2xl p-8 max-w-2xl w-full animate-scale-in shadow-2xl">
        {/* Título */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-amber-400 mb-2 animate-pulse">
            ✨ RESULTADOS FINALES ✨
          </h2>
          <p className="text-amber-200/70 text-sm">
            Mediciones completadas con éxito
          </p>
        </div>

        {/* Grid de Resultados */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* SpO2 */}
          <div className="bg-slate-800/50 border border-amber-400/20 rounded-xl p-4 hover:border-amber-400/40 transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-amber-200 font-medium">SpO₂</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400 animate-fade-in">
                  {results.spo2}%
                </div>
                <div className="text-xs text-amber-300/60">Saturación</div>
              </div>
            </div>
          </div>

          {/* Presión Arterial */}
          <div className="bg-slate-800/50 border border-amber-400/20 rounded-xl p-4 hover:border-amber-400/40 transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-amber-200 font-medium">Presión</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400 animate-fade-in">
                  {results.pressure.systolic}/{results.pressure.diastolic}
                </div>
                <div className="text-xs text-amber-300/60">mmHg</div>
              </div>
            </div>
          </div>

          {/* Glucosa */}
          <div className="bg-slate-800/50 border border-amber-400/20 rounded-xl p-4 hover:border-amber-400/40 transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-amber-200 font-medium">Glucosa</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400 animate-fade-in">
                  {results.glucose}
                </div>
                <div className="text-xs text-amber-300/60">mg/dL</div>
              </div>
            </div>
          </div>

          {/* Hemoglobina */}
          <div className="bg-slate-800/50 border border-amber-400/20 rounded-xl p-4 hover:border-amber-400/40 transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-amber-200 font-medium">Hemoglobina</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400 animate-fade-in">
                  {results.hemoglobin}
                </div>
                <div className="text-xs text-amber-300/60">g/dL</div>
              </div>
            </div>
          </div>

          {/* Colesterol Total */}
          <div className="bg-slate-800/50 border border-amber-400/20 rounded-xl p-4 hover:border-amber-400/40 transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-amber-200 font-medium">Colesterol</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400 animate-fade-in">
                  {results.lipids.totalCholesterol}
                </div>
                <div className="text-xs text-amber-300/60">mg/dL</div>
              </div>
            </div>
          </div>

          {/* Triglicéridos */}
          <div className="bg-slate-800/50 border border-amber-400/20 rounded-xl p-4 hover:border-amber-400/40 transition-all duration-300">
            <div className="flex items-center justify-between">
              <span className="text-amber-200 font-medium">Triglicéridos</span>
              <div className="text-right">
                <div className="text-2xl font-bold text-amber-400 animate-fade-in">
                  {results.lipids.triglycerides}
                </div>
                <div className="text-xs text-amber-300/60">mg/dL</div>
              </div>
            </div>
          </div>

        </div>

        {/* Arritmias */}
        {results.arrhythmiaCount > 0 && (
          <div className="mt-6 bg-red-900/20 border border-red-400/30 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="text-red-300 font-medium">⚠️ Arritmias</span>
              <div className="text-right">
                <div className="text-xl font-bold text-red-400">
                  {results.arrhythmiaCount} detectadas
                </div>
                <div className="text-xs text-red-300/60">Consulte a su médico</div>
              </div>
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div className="mt-8 p-4 bg-blue-900/20 border border-blue-400/30 rounded-xl">
          <p className="text-blue-300 text-sm text-center">
            <span className="font-semibold">IMPORTANTE:</span> Estos resultados son referenciales. 
            No sustituyen consulta médica profesional.
          </p>
        </div>

        {/* Botón de Cerrar */}
        <div className="mt-6 text-center">
          <button
            onClick={() => window.location.reload()}
            className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-8 py-3 rounded-xl transition-all duration-300 hover:scale-105"
          >
            Nueva Medición
          </button>
        </div>
      </div>
    </div>
  );
};

export default FinalResultsDisplay;
