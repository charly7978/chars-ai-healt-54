import React, { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RotateCcw } from "lucide-react";
import { parseArrhythmiaStatus, getArrhythmiaText, getArrhythmiaColor } from '@/utils/arrhythmiaUtils';

interface PPGResultDialogProps {
  isOpen: boolean;
  onClose: () => void;
  signalData: Array<{time: number, value: number, isPeak: boolean, status: any}>;
}

const PPGResultDialog = ({ isOpen, onClose, signalData }: PPGResultDialogProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const MAX_TIME = 30000; // 30 segundos

  useEffect(() => {
    if (!canvasRef.current || !isOpen || signalData.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Limpiar canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dibujar líneas de grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const y = (canvas.height / 9) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Calcular rango de valores
    const minVal = Math.min(...signalData.map(d => d.value));
    const maxVal = Math.max(...signalData.map(d => d.value));
    const range = maxVal - minVal || 1;

    // Dibujar señal completa
    ctx.beginPath();
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;

    signalData.forEach((point, index) => {
      const x = (canvas.width * point.time) / MAX_TIME;
      const normalizedY = (point.value - minVal) / range;
      const y = normalizedY * canvas.height * 0.8 + canvas.height * 0.1;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Dibujar picos detectados
    signalData.forEach(point => {
      if (point.isPeak) {
        const x = (canvas.width * point.time) / MAX_TIME;
        const normalizedY = (point.value - minVal) / range;
        const y = normalizedY * canvas.height * 0.8 + canvas.height * 0.1;
        
        const status = parseArrhythmiaStatus(point.status);
        ctx.fillStyle = getArrhythmiaColor(status);
        ctx.fillText(getArrhythmiaText(status), x, y);
      }
    });

  }, [isOpen, signalData]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-screen-lg w-[90vw] h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Resultados PPG (30 segundos)
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 bg-black/60 rounded-lg p-4">
          <canvas
            ref={canvasRef}
            width={800}
            height={400}
            className="w-full h-full object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PPGResultDialog;
