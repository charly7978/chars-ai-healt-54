/**
 * DISCLAIMER OVERLAY - AVISO LEGAL PERMANENTE
 * 
 * Componente que muestra el disclaimer obligatorio
 * indicando que la app es REFERENCIAL y no diagnóstica
 * 
 * Debe mostrarse:
 * 1. Como modal al inicio de la medición
 * 2. Como footer permanente durante la medición
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Info } from 'lucide-react';

interface DisclaimerOverlayProps {
  /** Mostrar como modal (bloquea interacción hasta aceptar) */
  asModal?: boolean;
  /** Callback cuando el usuario acepta */
  onAccept?: () => void;
  /** Mostrar versión compacta (footer) */
  compact?: boolean;
}

export const DisclaimerOverlay: React.FC<DisclaimerOverlayProps> = ({
  asModal = false,
  onAccept,
  compact = false
}) => {
  const [isVisible, setIsVisible] = useState(asModal);
  const [hasAccepted, setHasAccepted] = useState(false);
  
  // Check if user has previously accepted
  useEffect(() => {
    if (asModal) {
      const accepted = sessionStorage.getItem('disclaimer_accepted');
      if (accepted === 'true') {
        setHasAccepted(true);
        setIsVisible(false);
      }
    }
  }, [asModal]);
  
  const handleAccept = () => {
    setHasAccepted(true);
    setIsVisible(false);
    sessionStorage.setItem('disclaimer_accepted', 'true');
    onAccept?.();
  };
  
  // Modal version
  if (asModal && isVisible && !hasAccepted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-yellow-500/20 rounded-full">
              <AlertTriangle className="w-6 h-6 text-yellow-500" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              Aviso Importante
            </h2>
          </div>
          
          {/* Content */}
          <div className="space-y-4 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">
              ESTA APLICACIÓN ES REFERENCIAL - NO DIAGNÓSTICA
            </p>
            
            <p>
              Los valores mostrados son <strong>estimaciones</strong> basadas en 
              fotopletismografía (PPG) de la cámara del dispositivo y 
              <strong> NO reemplazan</strong> equipos médicos certificados.
            </p>
            
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
              <p className="text-destructive font-medium">
                ⚠️ No tome decisiones médicas basándose únicamente en esta aplicación.
              </p>
            </div>
            
            <p>
              Para diagnóstico y tratamiento médico, consulte siempre a un 
              profesional de salud calificado con equipos certificados.
            </p>
            
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>SpO2: precisión estimada ±5% respecto a oxímetros certificados</li>
              <li>Presión arterial: valores estimados sin calibración individual</li>
              <li>Arritmias: detección indicativa, no diagnóstica</li>
              <li>Glucosa/Hemoglobina: correlaciones experimentales</li>
            </ul>
          </div>
          
          {/* Accept button */}
          <button
            onClick={handleAccept}
            className="w-full mt-6 py-3 px-4 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
          >
            Entiendo y Acepto
          </button>
          
          <p className="text-xs text-center text-muted-foreground mt-3">
            Al continuar, acepta que entiende las limitaciones de esta aplicación.
          </p>
        </div>
      </div>
    );
  }
  
  // Compact footer version
  if (compact) {
    return (
      <div className="bg-yellow-500/10 border-t border-yellow-500/30 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500">
          <Info className="w-3 h-3 flex-shrink-0" />
          <span>
            <strong>Referencial</strong> - No diagnóstica. Consulte a un profesional de salud.
          </span>
        </div>
      </div>
    );
  }
  
  // Inline version (non-modal)
  return (
    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-yellow-600 dark:text-yellow-500">
          <p className="font-semibold">Aplicación referencial - No diagnóstica</p>
          <p className="mt-1 text-yellow-600/80 dark:text-yellow-500/80">
            Los valores son estimaciones basadas en PPG. 
            Consulte a un profesional de salud para diagnóstico médico.
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Footer permanente para usar durante la medición
 */
export const DisclaimerFooter: React.FC = () => {
  return <DisclaimerOverlay compact />;
};

/**
 * Hook para manejar el estado del disclaimer
 */
export function useDisclaimer() {
  const [hasAccepted, setHasAccepted] = useState(false);
  
  useEffect(() => {
    const accepted = sessionStorage.getItem('disclaimer_accepted');
    setHasAccepted(accepted === 'true');
  }, []);
  
  const resetDisclaimer = () => {
    sessionStorage.removeItem('disclaimer_accepted');
    setHasAccepted(false);
  };
  
  return {
    hasAccepted,
    resetDisclaimer,
    showModal: !hasAccepted
  };
}

export default DisclaimerOverlay;
