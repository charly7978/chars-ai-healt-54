/**
 * Indicador visual de que la medición está activa.
 *
 * IMPORTANTE: no enlazar el mismo MediaStream a otro <video> además del de CameraView.
 * En Safari / WebView iOS y varios móviles, dos videos con el mismo stream dejan de
 * recibir frames en uno de ellos → drawImage() sin señal y PPG en cero.
 */
import React from "react";

interface CameraPreviewProps {
  stream: MediaStream | null;
  isVisible: boolean;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({ stream, isVisible }) => {
  if (!isVisible) return null;

  const active = stream != null && stream.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <div className="absolute top-14 left-3 z-40 pointer-events-none">
      <div
        className="rounded-xl overflow-hidden shadow-lg"
        style={{
          backgroundColor: "rgba(0,0,0,0.85)",
          border: "2px solid #22c55e",
          boxShadow: "0 0 15px rgba(34, 197, 94, 0.3)",
          width: "110px",
        }}
      >
        <div className="h-20 w-full flex items-center justify-center bg-black/60">
          <span className="text-2xl" aria-hidden>
            {active ? "📷" : "⏳"}
          </span>
        </div>
        <div className="px-2 py-1 text-center">
          <span className="text-xs text-emerald-400 font-semibold">
            {active ? "PPG ACTIVO" : "CÁMARA…"}
          </span>
        </div>
      </div>
    </div>
  );
};

export default CameraPreview;
