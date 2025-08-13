
/**
 * Filtro Kalman Extendido de Precisión Industrial para Señales Biomédicas
 * Implementación con matrices de covarianza adaptativas y estimación de ruido en tiempo real
 */
export class KalmanFilter {
  private readonly stateSize = 3; // [posición, velocidad, aceleración]
  private readonly measurementSize = 1;
  
  // Matrices de estado (precisión doble)
  private x: Float64Array; // Vector de estado
  private P: Float64Array; // Matriz de covarianza del error
  private F: Float64Array; // Matriz de transición de estado
  private H: Float64Array; // Matriz de observación
  private Q: Float64Array; // Matriz de ruido del proceso
  private R: number; // Varianza del ruido de medición
  
  // Parámetros adaptativos
  private innovationHistory: number[] = [];
  private adaptiveR: number = 1e-4;
  private adaptiveQ: number = 1e-6;
  private dt: number = 1/60; // 60 Hz por defecto
  
  // Métricas de calidad
  private likelihood: number = 0;
  private mahalanobisDistance: number = 0;
  
  constructor(samplingRate: number = 60) {
    this.dt = 1 / samplingRate;
    this.initializeMatrices();
  }
  
  private initializeMatrices(): void {
    // Estado inicial [posición, velocidad, aceleración]
    this.x = new Float64Array([0, 0, 0]);
    
    // Matriz de covarianza inicial (alta incertidumbre)
    this.P = new Float64Array([
      1000, 0, 0,
      0, 1000, 0,
      0, 0, 1000
    ]);
    
    // Matriz de transición (modelo cinemático)
    const dt2 = this.dt * this.dt;
    this.F = new Float64Array([
      1, this.dt, 0.5 * dt2,
      0, 1, this.dt,
      0, 0, 0.95 // Factor de amortiguamiento para aceleración
    ]);
    
    // Matriz de observación (solo observamos posición)
    this.H = new Float64Array([1, 0, 0]);
    
    // Matriz de ruido del proceso (modelo de aceleración constante)
    const q = this.adaptiveQ;
    const dt3 = dt2 * this.dt;
    const dt4 = dt3 * this.dt;
    this.Q = new Float64Array([
      dt4/4 * q, dt3/2 * q, dt2/2 * q,
      dt3/2 * q, dt2 * q, this.dt * q,
      dt2/2 * q, this.dt * q, q
    ]);
    
    this.R = this.adaptiveR;
  }
  
  filter(measurement: number): number {
    // 1. Predicción
    this.predict();
    
    // 2. Actualización con medición
    this.update(measurement);
    
    // 3. Adaptación de parámetros
    this.adaptParameters();
    
    return this.x[0]; // Retornar posición estimada
  }
  
  private predict(): void {
    // x_k|k-1 = F * x_k-1|k-1
    const newX = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      newX[i] = 0;
      for (let j = 0; j < 3; j++) {
        newX[i] += this.F[i * 3 + j] * this.x[j];
      }
    }
    this.x = newX;
    
    // P_k|k-1 = F * P_k-1|k-1 * F^T + Q
    const FP = this.matrixMultiply3x3(this.F, this.P);
    const FPFT = this.matrixMultiplyByTranspose3x3(FP, this.F);
    
    for (let i = 0; i < 9; i++) {
      this.P[i] = FPFT[i] + this.Q[i];
    }
  }
  
  private update(z: number): void {
    // Innovación: y = z - H * x
    const hx = this.H[0] * this.x[0] + this.H[1] * this.x[1] + this.H[2] * this.x[2];
    const innovation = z - hx;
    
    // Covarianza de la innovación: S = H * P * H^T + R
    const HP = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      HP[i] = 0;
      for (let j = 0; j < 3; j++) {
        HP[i] += this.H[j] * this.P[j * 3 + i];
      }
    }
    
    const S = HP[0] * this.H[0] + HP[1] * this.H[1] + HP[2] * this.H[2] + this.R;
    
    // Ganancia de Kalman: K = P * H^T * S^-1
    const K = new Float64Array(3);
    for (let i = 0; i < 3; i++) {
      K[i] = HP[i] / S;
    }
    
    // Actualización del estado: x = x + K * y
    for (let i = 0; i < 3; i++) {
      this.x[i] += K[i] * innovation;
    }
    
    // Actualización de covarianza: P = (I - K * H) * P
    const KH = new Float64Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        KH[i * 3 + j] = K[i] * this.H[j];
      }
    }
    
    // I - KH
    const IKH = new Float64Array(9);
    for (let i = 0; i < 9; i++) {
      IKH[i] = (i % 4 === 0 ? 1 : 0) - KH[i]; // Matriz identidad - KH
    }
    
    this.P = this.matrixMultiply3x3(IKH, this.P);
    
    // Métricas de calidad
    this.mahalanobisDistance = Math.abs(innovation) / Math.sqrt(S);
    this.likelihood = Math.exp(-0.5 * innovation * innovation / S) / Math.sqrt(2 * Math.PI * S);
    
    // Historial de innovaciones para adaptación
    this.innovationHistory.push(innovation);
    if (this.innovationHistory.length > 50) {
      this.innovationHistory.shift();
    }
  }
  
  private adaptParameters(): void {
    if (this.innovationHistory.length < 10) return;
    
    // Estimación adaptativa del ruido de medición
    const variance = this.calculateVariance(this.innovationHistory);
    this.adaptiveR = Math.max(1e-6, Math.min(1e-2, variance * 0.1));
    this.R = this.adaptiveR;
    
    // Adaptación del ruido del proceso basado en la distancia de Mahalanobis
    if (this.mahalanobisDistance > 3.0) {
      this.adaptiveQ *= 1.1; // Incrementar ruido del proceso
    } else if (this.mahalanobisDistance < 1.0) {
      this.adaptiveQ *= 0.99; // Decrementar ruido del proceso
    }
    
    this.adaptiveQ = Math.max(1e-8, Math.min(1e-4, this.adaptiveQ));
    this.updateProcessNoiseMatrix();
  }
  
  private updateProcessNoiseMatrix(): void {
    const q = this.adaptiveQ;
    const dt2 = this.dt * this.dt;
    const dt3 = dt2 * this.dt;
    const dt4 = dt3 * this.dt;
    
    this.Q[0] = dt4/4 * q; this.Q[1] = dt3/2 * q; this.Q[2] = dt2/2 * q;
    this.Q[3] = dt3/2 * q; this.Q[4] = dt2 * q;   this.Q[5] = this.dt * q;
    this.Q[6] = dt2/2 * q; this.Q[7] = this.dt * q; this.Q[8] = q;
  }
  
  private matrixMultiply3x3(A: Float64Array, B: Float64Array): Float64Array {
    const result = new Float64Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result[i * 3 + j] = 0;
        for (let k = 0; k < 3; k++) {
          result[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j];
        }
      }
    }
    return result;
  }
  
  private matrixMultiplyByTranspose3x3(A: Float64Array, B: Float64Array): Float64Array {
    const result = new Float64Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        result[i * 3 + j] = 0;
        for (let k = 0; k < 3; k++) {
          result[i * 3 + j] += A[i * 3 + k] * B[j * 3 + k]; // B transpuesta
        }
      }
    }
    return result;
  }
  
  private calculateVariance(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    return data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (data.length - 1);
  }
  
  getVelocity(): number {
    return this.x[1];
  }
  
  getAcceleration(): number {
    return this.x[2];
  }
  
  getLikelihood(): number {
    return this.likelihood;
  }
  
  getMahalanobisDistance(): number {
    return this.mahalanobisDistance;
  }
  
  reset(): void {
    this.x.fill(0);
    this.P.fill(0);
    this.P[0] = this.P[4] = this.P[8] = 1000; // Diagonal principal
    this.innovationHistory = [];
    this.adaptiveR = 1e-4;
    this.adaptiveQ = 1e-6;
    this.likelihood = 0;
    this.mahalanobisDistance = 0;
    this.updateProcessNoiseMatrix();
  }
}
