/**
 * DEBUG PANEL TÉCNICO - FASE 1
 * 
 * Muestra en pantalla:
 * - fps real
 * - backend usado: CPU / Canvas2D / WebGL / WebGPU
 * - torch activo
 * - camera settings reales
 * - exposure/iso/focus/whiteBalance support
 * - darkOffsetRGB
 * - whiteRefRGB
 * - saturationRatio RGB
 * - contactScore
 * - motionScore
 * - ROI box
 * - raw RGB traces
 * - OD traces
 * - estado de dedo
 * - errores de constraints
 */

import React, { useState, useEffect, useRef } from 'react';
import type { CameraDiagnostics } from '../modules/camera/CameraService';
import type { FingerState } from '../modules/detection/FingerDetection';
import type { ROIBox } from '../modules/roi/DynamicROI';
import type { PPGSample } from '../modules/extraction/PPGExtraction';

interface DebugPanelProps {
  diagnostics?: CameraDiagnostics;
  fingerState?: FingerState;
  fingerReason?: string;
  contactScore?: number;
  motionScore?: number;
  roiBox?: ROIBox;
  roiLocked?: boolean;
  roiLockReason?: string;
  ppgSample?: PPGSample;
  calibrationStatus?: {
    isDarkCalibrated: boolean;
    isWhiteCalibrated: boolean;
    darkOffsetRGB: { r: number; g: number; b: number };
    whiteRefRGB: { r: number; g: number; b: number };
  };
  backend?: 'CPU' | 'Canvas2D' | 'WebGL' | 'WebGPU';
  visible?: boolean;
  onToggle?: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  diagnostics,
  fingerState,
  fingerReason,
  contactScore,
  motionScore,
  roiBox,
  roiLocked,
  roiLockReason,
  ppgSample,
  calibrationStatus,
  backend = 'CPU',
  visible = true,
  onToggle,
}) => {
  const [expanded, setExpanded] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rgbHistoryRef = useRef<{ r: number; g: number; b: number }[]>([]);
  const odHistoryRef = useRef<{ r: number; g: number; b: number }[]>([]);
  const maxHistory = 200;

  // Actualizar historiales
  useEffect(() => {
    if (ppgSample) {
      rgbHistoryRef.current.push({
        r: ppgSample.meanR,
        g: ppgSample.meanG,
        b: ppgSample.meanB,
      });
      odHistoryRef.current.push({
        r: ppgSample.meanODR,
        g: ppgSample.meanODG,
        b: ppgSample.meanODB,
      });

      if (rgbHistoryRef.current.length > maxHistory) {
        rgbHistoryRef.current.shift();
      }
      if (odHistoryRef.current.length > maxHistory) {
        odHistoryRef.current.shift();
      }
    }
  }, [ppgSample]);

  // Dibujar traces en canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !expanded) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Limpiar
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Dibujar RGB traces
    const drawTrace = (
      data: number[],
      color: string,
      offset: number,
      scale: number
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let i = 0; i < data.length; i++) {
        const x = (i / maxHistory) * width;
        const y = height - offset - data[i] * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
    };

    const rgbData = rgbHistoryRef.current;
    const odData = odHistoryRef.current;

    if (rgbData.length > 0) {
      const rData = rgbData.map(d => d.r);
      const gData = rgbData.map(d => d.g);
      const bData = rgbData.map(d => d.b);

      drawTrace(rData, '#ff4444', 20, 0.3);
      drawTrace(gData, '#44ff44', 80, 0.3);
      drawTrace(bData, '#4444ff', 140, 0.3);
    }

    if (odData.length > 0) {
      const rData = odData.map(d => d.r);
      const gData = odData.map(d => d.g);
      const bData = odData.map(d => d.b);

      drawTrace(rData, '#ff8888', 200, 50);
      drawTrace(gData, '#88ff88', 260, 50);
      drawTrace(bData, '#8888ff', 320, 50);
    }
  }, [expanded, ppgSample]);

  if (!visible) return null;

  const getFingerStateColor = (state?: FingerState) => {
    switch (state) {
      case 'FINGER_STABLE': return 'text-green-400';
      case 'FINGER_DETECTED_UNSTABLE': return 'text-yellow-400';
      case 'SATURATED': return 'text-red-400';
      case 'TOO_DARK': return 'text-orange-400';
      case 'MOTION_CONTAMINATED': return 'text-purple-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="fixed top-2 right-2 w-96 bg-black/90 border border-gray-700 rounded-lg text-xs font-mono z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className="text-white font-bold">🔧 DEBUG PANEL</span>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded ${backend === 'WebGPU' ? 'bg-purple-600' : backend === 'WebGL' ? 'bg-blue-600' : backend === 'Canvas2D' ? 'bg-green-600' : 'bg-gray-600'} text-white`}>
            {backend}
          </span>
          <span className="text-gray-400">{expanded ? '▼' : '▶'}</span>
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-3 max-h-[80vh] overflow-y-auto">
          {/* FPS y Backend */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400">FPS Real</div>
              <div className="text-white text-lg font-bold">{diagnostics?.realFps.toFixed(1) || '--'}</div>
            </div>
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400">Backend</div>
              <div className="text-white">{backend}</div>
            </div>
          </div>

          {/* Torch */}
          <div className="bg-gray-800 p-2 rounded">
            <div className="text-gray-400">Torch</div>
            <div className="flex items-center gap-2">
              <span className={diagnostics?.torchActive ? 'text-green-400' : 'text-red-400'}>
                {diagnostics?.torchActive ? '✓ ON' : '✗ OFF'}
              </span>
              {diagnostics?.torchRequested && !diagnostics.torchActive && (
                <span className="text-yellow-400">(requested)</span>
              )}
              {diagnostics?.torchEffective && (
                <span className="text-blue-400">(effective)</span>
              )}
            </div>
          </div>

          {/* Estado del dedo */}
          <div className="bg-gray-800 p-2 rounded">
            <div className="text-gray-400">Estado Dedo</div>
            <div className={`${getFingerStateColor(fingerState)} font-bold`}>
              {fingerState || 'NO_FINGER'}
            </div>
            <div className="text-gray-500 text-[10px]">{fingerReason || ''}</div>
          </div>

          {/* Scores */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400">Contact Score</div>
              <div className="text-white">{((contactScore || 0) * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400">Motion Score</div>
              <div className="text-white">{((motionScore || 0) * 100).toFixed(1)}%</div>
            </div>
          </div>

          {/* ROI */}
          <div className="bg-gray-800 p-2 rounded">
            <div className="text-gray-400">ROI</div>
            <div className="text-white">
              {roiBox ? `x:${roiBox.x} y:${roiBox.y} w:${roiBox.width} h:${roiBox.height}` : 'N/A'}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={roiLocked ? 'text-green-400' : 'text-yellow-400'}>
                {roiLocked ? '🔒 Locked' : '🔓 Dynamic'}
              </span>
              <span className="text-gray-500 text-[10px]">{roiLockReason || ''}</span>
            </div>
          </div>

          {/* Camera Settings */}
          {diagnostics && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400 mb-1">Camera Settings</div>
              <div className="space-y-1 text-gray-300">
                <div>Res: {diagnostics.settings.width}x{diagnostics.settings.height}</div>
                <div>FPS: {diagnostics.settings.frameRate}</div>
                {diagnostics.settings.exposureMode && <div>Exp: {diagnostics.settings.exposureMode}</div>}
                {diagnostics.settings.iso && <div>ISO: {diagnostics.settings.iso}</div>}
                {diagnostics.settings.whiteBalanceMode && <div>WB: {diagnostics.settings.whiteBalanceMode}</div>}
                {diagnostics.settings.focusMode && <div>Focus: {diagnostics.settings.focusMode}</div>}
              </div>
            </div>
          )}

          {/* Capabilities */}
          {diagnostics && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400 mb-1">Capabilities</div>
              <div className="grid grid-cols-2 gap-1 text-gray-300">
                <div className={diagnostics.capabilities.hasTorch ? 'text-green-400' : 'text-red-400'}>
                  Torch: {diagnostics.capabilities.hasTorch ? '✓' : '✗'}
                </div>
                <div className={diagnostics.capabilities.hasExposureMode ? 'text-green-400' : 'text-red-400'}>
                  Exp: {diagnostics.capabilities.hasExposureMode ? '✓' : '✗'}
                </div>
                <div className={diagnostics.capabilities.hasWhiteBalanceMode ? 'text-green-400' : 'text-red-400'}>
                  WB: {diagnostics.capabilities.hasWhiteBalanceMode ? '✓' : '✗'}
                </div>
                <div className={diagnostics.capabilities.hasFocusMode ? 'text-green-400' : 'text-red-400'}>
                  Focus: {diagnostics.capabilities.hasFocusMode ? '✓' : '✗'}
                </div>
                <div className={diagnostics.capabilities.hasIso ? 'text-green-400' : 'text-red-400'}>
                  ISO: {diagnostics.capabilities.hasIso ? '✓' : '✗'}
                </div>
                <div className={diagnostics.capabilities.hasZoom ? 'text-green-400' : 'text-red-400'}>
                  Zoom: {diagnostics.capabilities.hasZoom ? '✓' : '✗'}
                </div>
              </div>
            </div>
          )}

          {/* Calibración */}
          {calibrationStatus && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400 mb-1">Calibración</div>
              <div className="space-y-1 text-gray-300">
                <div className={calibrationStatus.isDarkCalibrated ? 'text-green-400' : 'text-red-400'}>
                  Dark: {calibrationStatus.isDarkCalibrated ? '✓' : '✗'}
                  {calibrationStatus.isDarkCalibrated && (
                    <span className="text-gray-500 ml-1">
                      R:{calibrationStatus.darkOffsetRGB.r.toFixed(0)} 
                      G:{calibrationStatus.darkOffsetRGB.g.toFixed(0)} 
                      B:{calibrationStatus.darkOffsetRGB.b.toFixed(0)}
                    </span>
                  )}
                </div>
                <div className={calibrationStatus.isWhiteCalibrated ? 'text-green-400' : 'text-red-400'}>
                  White: {calibrationStatus.isWhiteCalibrated ? '✓' : '✗'}
                  {calibrationStatus.isWhiteCalibrated && (
                    <span className="text-gray-500 ml-1">
                      R:{calibrationStatus.whiteRefRGB.r.toFixed(0)} 
                      G:{calibrationStatus.whiteRefRGB.g.toFixed(0)} 
                      B:{calibrationStatus.whiteRefRGB.b.toFixed(0)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Saturación RGB */}
          {ppgSample && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400 mb-1">Saturación RGB</div>
              <div className="grid grid-cols-3 gap-1 text-gray-300">
                <div>R: {(ppgSample.saturationRatioR * 100).toFixed(1)}%</div>
                <div>G: {(ppgSample.saturationRatioG * 100).toFixed(1)}%</div>
                <div>B: {(ppgSample.saturationRatioB * 100).toFixed(1)}%</div>
              </div>
            </div>
          )}

          {/* Signal Quality */}
          {ppgSample && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400">Signal Quality</div>
              <div className="text-white text-lg font-bold">{ppgSample.signalQuality.toFixed(1)}%</div>
            </div>
          )}

          {/* AC/DC */}
          {ppgSample && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400 mb-1">AC/DC RGB</div>
              <div className="grid grid-cols-3 gap-1 text-gray-300 text-[10px]">
                <div>
                  <div>R AC: {ppgSample.acR.toFixed(2)}</div>
                  <div>R DC: {ppgSample.dcR.toFixed(1)}</div>
                </div>
                <div>
                  <div>G AC: {ppgSample.acG.toFixed(2)}</div>
                  <div>G DC: {ppgSample.dcG.toFixed(1)}</div>
                </div>
                <div>
                  <div>B AC: {ppgSample.acB.toFixed(2)}</div>
                  <div>B DC: {ppgSample.dcB.toFixed(1)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Traces Canvas */}
          <div className="bg-gray-800 p-2 rounded">
            <div className="text-gray-400 mb-1">Traces (RGB arriba, OD abajo)</div>
            <canvas ref={canvasRef} width={360} height={400} className="w-full h-40 bg-black rounded" />
          </div>

          {/* Constraint Errors */}
          {diagnostics && (diagnostics.constraintFailures.length > 0 || diagnostics.constraintIgnored.length > 0) && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400 mb-1">Constraints</div>
              {diagnostics.constraintFailures.length > 0 && (
                <div className="text-red-400 text-[10px]">
                  Fallidos: {diagnostics.constraintFailures.join(', ')}
                </div>
              )}
              {diagnostics.constraintIgnored.length > 0 && (
                <div className="text-yellow-400 text-[10px]">
                  Ignorados: {diagnostics.constraintIgnored.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Warm-up Status */}
          {diagnostics && diagnostics.warmUpStatus !== 'COMPLETE' && (
            <div className="bg-gray-800 p-2 rounded">
              <div className="text-gray-400">Warm-up</div>
              <div className="text-white">{diagnostics.warmUpStatus}</div>
              <div className="text-gray-500">{diagnostics.warmUpProgress.toFixed(0)}%</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
