import { useEffect, useRef, useState } from "react";

export type IMUState = {
  motionIndex: number;   // 0-100 (alto = mucho movimiento)
  accelNorm: number;     // m/s^2
  rotRate: number;       // deg/s aproximado
};

export function useIMUFusion() {
  const [imu, setIMU] = useState<IMUState>({ motionIndex: 0, accelNorm: 0, rotRate: 0 });
  const last = useRef({ ax:0, ay:0, az:0, gx:0, gy:0, gz:0 });

  useEffect(() => {
    const onMotion = (e: DeviceMotionEvent) => {
      const ax = e.accelerationIncludingGravity?.x ?? 0;
      const ay = e.accelerationIncludingGravity?.y ?? 0;
      const az = e.accelerationIncludingGravity?.z ?? 0;
      const gx = e.rotationRate?.alpha ?? 0;
      const gy = e.rotationRate?.beta ?? 0;
      const gz = e.rotationRate?.gamma ?? 0;

      const accelNorm = Math.sqrt(ax*ax + ay*ay + az*az);
      const rotRate = Math.sqrt(gx*gx + gy*gy + gz*gz);
      // motionIndex: mezcla normalizada
      let mi = 0;
      mi += Math.min(1, Math.abs(accelNorm-9.81)/6); // gravedad ~9.81
      mi += Math.min(1, rotRate/300);
      mi = Math.max(0, Math.min(2, mi));
      setIMU({ motionIndex: Math.round(mi*50), accelNorm, rotRate });
      last.current = { ax, ay, az, gx, gy, gz };
    };

    window.addEventListener("devicemotion", onMotion, { passive: true });
    return () => window.removeEventListener("devicemotion", onMotion);
  }, []);

  return imu;
}
