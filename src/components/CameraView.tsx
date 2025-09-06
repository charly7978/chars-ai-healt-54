import React, { useRef, useEffect, useState } from "react";

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  onAuxStreamReady?: (stream: MediaStream) => void; // NUEVO: segundo stream
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

/**
 * Cámara trasera + torch + posibilidad de 2 cámaras simultáneas si el dispositivo lo permite.
 * No cambia estética: dos <video> invisibles, detrás del monitor.
 */
const CameraView: React.FC<CameraViewProps> = ({
  onStreamReady,
  onAuxStreamReady,
  isMonitoring,
}) => {
  const v1Ref = useRef<HTMLVideoElement | null>(null);
  const v2Ref = useRef<HTMLVideoElement | null>(null);
  const s1Ref = useRef<MediaStream | null>(null);
  const s2Ref = useRef<MediaStream | null>(null);
  const startedRef = useRef(false);

  const stopTrack = (s: MediaStream | null) => {
    if (!s) return;
    for (const t of s.getTracks()) try { t.stop(); } catch {}
  };
  const stopAll = () => {
    stopTrack(s1Ref.current);
    stopTrack(s2Ref.current);
    if (v1Ref.current) v1Ref.current.srcObject = null;
    if (v2Ref.current) v2Ref.current.srcObject = null;
    s1Ref.current = null; s2Ref.current = null;
    startedRef.current = false;
  };

  const enableTorch = async (track: MediaStreamTrack) => {
    const caps: any = track.getCapabilities?.() || {};
    if (caps?.torch) {
      try { await track.applyConstraints({ advanced: [{ torch: true }] } as any); } catch {}
    }
  };

  const pickBackCameras = async () => {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const vids = devs.filter(d => d.kind === "videoinput");
    // back/environ hints
    const backs = vids.filter(d =>
      /back|rear|environment/i.test(d.label || "") || /back|rear|environment/i.test(d.deviceId)
    );
    if (backs.length >= 2) return backs.slice(0,2);
    if (backs.length === 1) return [backs[0]];
    // fallback: cualquiera dos
    return vids.slice(0,2);
  };

  const start = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const cams = await pickBackCameras();
      // stream 1
      if (cams[0]) {
        const s1 = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: cams[0].deviceId }, width:{ideal:640}, height:{ideal:480}, frameRate:{ideal:30, max:60}, facingMode:"environment" as any }
        });
        s1Ref.current = s1;
        if (v1Ref.current) { v1Ref.current.srcObject = s1; await v1Ref.current.play().catch(()=>{}); }
        const t1 = s1.getVideoTracks()[0]; if (t1) enableTorch(t1);
        onStreamReady?.(s1);
      }
      // stream 2 (si existe)
      if (cams[1]) {
        const s2 = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: cams[1].deviceId }, width:{ideal:640}, height:{ideal:480}, frameRate:{ideal:30, max:60}, facingMode:"environment" as any }
        });
        s2Ref.current = s2;
        if (v2Ref.current) { v2Ref.current.srcObject = s2; await v2Ref.current.play().catch(()=>{}); }
        const t2 = s2.getVideoTracks()[0]; if (t2) enableTorch(t2);
        onAuxStreamReady?.(s2);
      }
    } catch (e) {
      // último intento genérico
      try {
        const s1 = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:"environment" } as any });
        s1Ref.current = s1;
        if (v1Ref.current) { v1Ref.current.srcObject = s1; await v1Ref.current.play().catch(()=>{}); }
        const t1 = s1.getVideoTracks()[0]; if (t1) enableTorch(t1);
        onStreamReady?.(s1);
      } catch (err) {
        startedRef.current = false;
        stopAll();
        console.error("No se pudo iniciar cámara:", err);
      }
    }
  };

  useEffect(() => {
    if (isMonitoring) start();
    else stopAll();
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMonitoring]);

  // mantener torch activa periódicamente
  useEffect(() => {
    const id = setInterval(() => {
      [s1Ref.current, s2Ref.current].forEach(s => {
        const t = s?.getVideoTracks?.()[0];
        if (t) enableTorch(t);
      });
    }, 1500);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <video
        ref={v1Ref}
        data-cam="primary"
        playsInline muted autoPlay
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.0001, pointerEvents:"none" }}
      />
      <video
        ref={v2Ref}
        data-cam="aux"
        playsInline muted autoPlay
        style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", opacity:0.0001, pointerEvents:"none" }}
      />
    </>
  );
};

export default CameraView;
