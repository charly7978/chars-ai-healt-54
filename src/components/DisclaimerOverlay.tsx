import React from 'react';

/**
 * DISCLAIMER OVERLAY - PERMANENTE
 * 
 * Texto obligatorio que indica que la app es referencial
 * y no reemplaza equipos médicos certificados.
 */

interface DisclaimerOverlayProps {
  variant?: 'footer' | 'modal';
  onAccept?: () => void;
}

const DisclaimerOverlay: React.FC<DisclaimerOverlayProps> = ({ 
  variant = 'footer',
  onAccept 
}) => {
  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <div className="bg-background rounded-lg p-6 max-w-md w-full shadow-xl border border-border">
          <div className="text-center mb-4">
            <span className="text-4xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-center text-foreground mb-4">
            Aviso Importante
          </h2>
          <p className="text-sm text-muted-foreground mb-4 text-center leading-relaxed">
            Esta aplicación proporciona <strong>estimaciones referenciales</strong> basadas 
            en fotopletismografía (PPG) de la cámara del teléfono.
          </p>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 mb-4">
            <p className="text-xs text-destructive-foreground text-center font-medium">
              NO REEMPLAZA equipos médicos certificados ni diagnóstico profesional.
            </p>
          </div>
          <p className="text-xs text-muted-foreground text-center mb-6">
            Consulte siempre a un profesional de salud para decisiones médicas.
          </p>
          {onAccept && (
            <button
              onClick={onAccept}
              className="w-full py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90 transition-colors"
            >
              Entendido
            </button>
          )}
        </div>
      </div>
    );
  }
  
  // Footer permanente
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border px-4 py-2">
      <div className="max-w-lg mx-auto">
        <p className="text-[10px] text-muted-foreground text-center leading-tight">
          <span className="text-destructive font-semibold">⚠️ REFERENCIAL</span>
          {' '}- Valores estimados por fotopletismografía. No reemplaza diagnóstico médico.
        </p>
      </div>
    </div>
  );
};

export default DisclaimerOverlay;
