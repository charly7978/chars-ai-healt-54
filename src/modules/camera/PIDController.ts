/**
 * CONTROLADOR PID PARA PARÁMETROS DE CÁMARA
 * 
 * Proporciona ajustes suaves y estables para optimizar la señal PPG.
 * El controlador PID minimiza oscilaciones y responde rápidamente a cambios.
 * 
 * Referencias:
 * - Yi S. et al. "Skin-Guided Auto-Exposure" IEEE EMBC 2024
 * - Odinaev I. et al. "Optimizing Camera Exposure Control Settings for rPPG" CVPR 2023
 */

export interface PIDConfig {
  /** Ganancia proporcional - respuesta inmediata al error */
  kp: number;
  /** Ganancia integral - corrige errores acumulados */
  ki: number;
  /** Ganancia derivativa - anticipa cambios */
  kd: number;
  /** Límite de salida mínimo */
  outputMin: number;
  /** Límite de salida máximo */
  outputMax: number;
  /** Límite anti-windup para el integrador */
  integralLimit: number;
}

export class PIDController {
  private config: PIDConfig;
  private integral: number = 0;
  private lastError: number = 0;
  private lastOutput: number = 0;
  private lastUpdateTime: number = 0;
  
  constructor(config: Partial<PIDConfig> = {}) {
    this.config = {
      kp: config.kp ?? 0.5,
      ki: config.ki ?? 0.1,
      kd: config.kd ?? 0.05,
      outputMin: config.outputMin ?? 0,
      outputMax: config.outputMax ?? 1,
      integralLimit: config.integralLimit ?? 0.5,
    };
  }
  
  /**
   * Calcula la salida del controlador PID
   * @param setpoint - Valor objetivo deseado
   * @param current - Valor actual medido
   * @returns Salida del controlador (0-1 normalizado)
   */
  compute(setpoint: number, current: number): number {
    const now = performance.now();
    const dt = this.lastUpdateTime > 0 ? (now - this.lastUpdateTime) / 1000 : 0.033;
    this.lastUpdateTime = now;
    
    // Error = diferencia entre objetivo y actual
    const error = setpoint - current;
    
    // Término Proporcional
    const pTerm = this.config.kp * error;
    
    // Término Integral con anti-windup
    this.integral += error * dt;
    this.integral = Math.max(-this.config.integralLimit, 
                    Math.min(this.config.integralLimit, this.integral));
    const iTerm = this.config.ki * this.integral;
    
    // Término Derivativo (solo si tenemos historial)
    const derivative = dt > 0 ? (error - this.lastError) / dt : 0;
    const dTerm = this.config.kd * derivative;
    
    // Salida combinada
    let output = pTerm + iTerm + dTerm;
    
    // Clamp a límites
    output = Math.max(this.config.outputMin, 
             Math.min(this.config.outputMax, output));
    
    // Suavizado exponencial para evitar saltos bruscos
    const smoothing = 0.3;
    output = this.lastOutput * smoothing + output * (1 - smoothing);
    
    this.lastError = error;
    this.lastOutput = output;
    
    return output;
  }
  
  /**
   * Resetea el estado del controlador
   */
  reset(): void {
    this.integral = 0;
    this.lastError = 0;
    this.lastOutput = 0;
    this.lastUpdateTime = 0;
  }
  
  /**
   * Actualiza la configuración del PID
   */
  setConfig(config: Partial<PIDConfig>): void {
    Object.assign(this.config, config);
  }
  
  /**
   * Obtiene el último valor de salida
   */
  getLastOutput(): number {
    return this.lastOutput;
  }
}
