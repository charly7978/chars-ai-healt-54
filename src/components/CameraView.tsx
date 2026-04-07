import React, { useRef, useEffect, forwardRef, useImperativeHandle } from "react";

export interface CameraViewHandle {
  getVideoElement: () => HTMLVideoElement | null;
}

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
}

/**
 * CÁMARA PPG OPTIMIZADA - SELECCIÓN AUTOMÁTICA DE CÁMARA TRASERA PRINCIPAL
 * 
 * CARACTERÍSTICAS:
 * 1. Enumera dispositivos y selecciona la cámara trasera principal (con torch)
 * 2. Activa flash LED de forma robusta con reintentos
 * 3. Expone el video element para captura externa
 * 4. Configuración optimizada para PPG: 30fps, resolución moderada
 */
const CameraView = forwardRef<CameraViewHandle, CameraViewProps>(({
  onStreamReady,
  isMonitoring,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current
  }), []);

  useEffect(() => {
    let mounted = true;
    
    const stopCamera = async () => {
      if (streamRef.current) {
        // Apagar flash primero
        for (const track of streamRef.current.getVideoTracks()) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      isStartingRef.current = false;
    };

    /**
     * ENCONTRAR CÁMARA TRASERA PRINCIPAL
     * Prioriza la cámara que tenga torch (flash) disponible
     */
    const findMainBackCamera = async (): Promise<string | null> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        
        console.log('📷 Cámaras encontradas:', videoDevices.map(d => d.label || d.deviceId));
        
        // Buscar cámara trasera con torch
        for (const device of videoDevices) {
          const label = device.label.toLowerCase();
          
          // Priorizar cámara trasera principal (back, rear, environment)
          if (label.includes('back') || label.includes('rear') || label.includes('environment') || 
              label.includes('trasera') || label.includes('camera 0') || label.includes('camera0')) {
            
            // Verificar si tiene torch
            try {
              const testStream = await navigator.mediaDevices.getUserMedia({
                video: { deviceId: { exact: device.deviceId } }
              });
              
              const track = testStream.getVideoTracks()[0];
              const caps = track.getCapabilities?.() as any;
              const hasTorch = caps?.torch === true;
              
              testStream.getTracks().forEach(t => t.stop());
              
              if (hasTorch) {
                console.log('✅ Cámara principal encontrada:', device.label);
                return device.deviceId;
              }
            } catch {}
          }
        }
        
        // Fallback: buscar cualquier cámara con torch
        for (const device of videoDevices) {
          try {
            const testStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: device.deviceId } }
            });
            
            const track = testStream.getVideoTracks()[0];
            const caps = track.getCapabilities?.() as any;
            const hasTorch = caps?.torch === true;
            
            testStream.getTracks().forEach(t => t.stop());
            
            if (hasTorch) {
              console.log('✅ Cámara con torch encontrada:', device.label);
              return device.deviceId;
            }
          } catch {}
        }
        
        return null;
      } catch (e) {
        console.warn('No se pudo enumerar dispositivos:', e);
        return null;
      }
    };

    const startCamera = async () => {
      if (isStartingRef.current) return;
      isStartingRef.current = true;
      
      await stopCamera();
      if (!mounted) {
        isStartingRef.current = false;
        return;
      }

      try {
        // PASO 1: Buscar cámara trasera principal
        const mainCameraId = await findMainBackCamera();
        
        // PASO 2: Configurar constraints
        // Para finger-PPG priorizamos 30 fps estables y más luz por frame sobre 60 fps nominales.
        const preferredFrameRate = 30;
        const videoConstraints: MediaTrackConstraints = mainCameraId
          ? {
              deviceId: { exact: mainCameraId },
              width: { ideal: 640, max: 960 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: preferredFrameRate, min: 24, max: 30 }
            }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 640, max: 960 },
              height: { ideal: 480, max: 720 },
              frameRate: { ideal: preferredFrameRate, min: 24, max: 30 }
            };
        
        // PASO 3: Obtener stream
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: videoConstraints
          });
        } catch (e) {
          // Fallback sin exact
          console.warn('Fallback a constraints simples');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30, min: 24, max: 30 }
            }
          });
        }
        
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          isStartingRef.current = false;
          return;
        }

        streamRef.current = stream;
        
        // PASO 4: Conectar video
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          await new Promise<void>((resolve) => {
            const video = videoRef.current!;
            video.onloadedmetadata = async () => {
              try {
                await video.play();
              } catch {}
              resolve();
            };
          });
        }

        // PASO 5: ACTIVAR FLASH - Crítico para PPG
        const track = stream.getVideoTracks()[0];
        if (track) {
          // Esperar estabilización de cámara
          await new Promise(r => setTimeout(r, 500));
          
          let flashActivated = false;
          for (let attempt = 0; attempt < 5 && !flashActivated; attempt++) {
            try {
              const caps = track.getCapabilities?.() as any;
              if (caps?.torch) {
                await track.applyConstraints({ advanced: [{ torch: true } as any] });
                
                const settings = track.getSettings() as any;
                if (settings?.torch === true) {
                  flashActivated = true;
                  console.log('🔦 Flash ACTIVADO (verificado)');
                } else {
                  console.log(`🔦 Intento ${attempt + 1}: Flash aplicado, verificando...`);
                  flashActivated = true;
                }
              } else {
                console.warn('⚠️ Esta cámara no soporta torch');
                break;
              }
            } catch (e) {
              console.warn(`🔦 Intento ${attempt + 1} fallido:`, e);
              await new Promise(r => setTimeout(r, 300));
            }
          }
          
          if (!flashActivated) {
            console.warn('⚠️ No se pudo activar el flash después de 5 intentos');
          }

          // PASO 6: Estabilizar frame rate/exposición/ISO/WB para fortalecer señal PPG útil
          await new Promise(r => setTimeout(r, 300));
          try {
            const caps = track.getCapabilities?.() as any;
            const lockConstraints: any[] = [];
            
            if (caps?.frameRate) {
              lockConstraints.push({ frameRate: 30 });
            }

            if (caps?.exposureMode?.includes('manual')) {
              lockConstraints.push({ exposureMode: 'manual' });
            } else if (caps?.exposureMode?.includes('continuous')) {
              lockConstraints.push({ exposureMode: 'continuous' });
            }
            
            if (caps?.exposureCompensation) {
              const minExp = caps.exposureCompensation.min ?? -2;
              const maxExp = caps.exposureCompensation.max ?? 2;
              const targetExp = Math.max(minExp, Math.min(maxExp, -0.35));
              lockConstraints.push({ exposureCompensation: targetExp });
              console.log(`📷 Exposición compensada: ${targetExp}`);
            }
            
            if (caps?.whiteBalanceMode?.includes('manual')) {
              lockConstraints.push({ whiteBalanceMode: 'manual' });
            }
            
            if (caps?.iso) {
              const minISO = caps.iso.min ?? 50;
              const maxISO = caps.iso.max ?? 400;
              const targetISO = Math.max(minISO, Math.min(maxISO, 140));
              lockConstraints.push({ iso: targetISO });
              console.log(`📷 ISO fijado: ${targetISO}`);
            }
            
            if (caps?.focusMode?.includes('manual')) {
              lockConstraints.push({ focusMode: 'manual' });
            } else if (caps?.focusMode?.includes('continuous')) {
              lockConstraints.push({ focusMode: 'continuous' });
            }
            
            if (lockConstraints.length > 0) {
              await track.applyConstraints({ advanced: lockConstraints });
              console.log('✅ Parámetros de cámara estabilizados para PPG');
            }
          } catch (lockErr) {
            console.warn('⚠️ No se pudieron estabilizar parámetros de cámara:', lockErr);
          }
        }

        console.log('📹 Cámara lista:', videoRef.current?.videoWidth, 'x', videoRef.current?.videoHeight);
        onStreamReady?.(stream);
        isStartingRef.current = false;

      } catch (err) {
        console.error('❌ Error cámara:', err);
        isStartingRef.current = false;
      }
    };

    if (isMonitoring) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      mounted = false;
      stopCamera();
    };
  }, [isMonitoring, onStreamReady]);

  return (
    <video
      ref={videoRef}
      playsInline
      muted
      autoPlay
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        opacity: 1,
        pointerEvents: "none",
      }}
    />
  );
});

CameraView.displayName = 'CameraView';

export default CameraView;
