/**
 * RIDGE REGRESSOR (Tikhonov regularization)
 *
 * Closed-form least-squares with L2 penalty:
 *   w* = (XᵀX + λI)⁻¹ Xᵀy
 *
 * Designed for the small-sample, low-dimension calibration regime found in
 * smartphone health monitoring (5..50 samples × 5..15 features). Includes:
 *  - Optional feature standardization (mean/std), with inverse transform
 *  - Intercept handling via centering (more numerically stable than column
 *    of 1s when λ>0)
 *  - Cholesky solver for the Gram matrix (symmetric positive definite when
 *    λ > 0)
 *  - Leave-one-out (LOO) cross-validated RMSE for honest error reporting
 *
 * No randomness. Deterministic, reproducible.
 */

export interface RidgeFitOptions {
  /** L2 regularization strength. Larger → flatter coefficients. Default 1.0 */
  lambda?: number;
  /** Standardize features to zero mean / unit std before fit. Default true. */
  standardize?: boolean;
}

export interface RidgeModel {
  /** Coefficient vector in original feature space (after un-standardization). */
  weights: number[];
  /** Intercept term in original feature space. */
  intercept: number;
  /** Number of features (length of weights). */
  nFeatures: number;
  /** Number of training samples. */
  nSamples: number;
  /** Lambda used for the fit. */
  lambda: number;
  /** Means used for standardization (zeros when standardize=false). */
  meansX: number[];
  /** Stds used for standardization (ones when standardize=false). */
  stdsX: number[];
  /** Mean of y used for centering. */
  meanY: number;
  /** Training RMSE. */
  trainRMSE: number;
  /** Leave-one-out cross-validated RMSE (∞ if N≤1). */
  looRMSE: number;
}

function mean(a: number[]): number { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function std(a: number[], m?: number): number {
  if (a.length < 2) return 1;
  const mu = m !== undefined ? m : mean(a);
  const v = a.reduce((s, x) => s + (x - mu) * (x - mu), 0) / a.length;
  return Math.sqrt(v) || 1; // guard against zero-variance features
}

/**
 * Cholesky decomposition of an n×n SPD matrix A: A = L Lᵀ.
 * Returns L (lower-triangular) or null if A is not SPD.
 */
function cholesky(A: number[][]): number[][] | null {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const d = A[i][i] - sum;
        if (d <= 1e-14) return null;
        L[i][i] = Math.sqrt(d);
      } else {
        L[i][j] = (A[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

/** Solve L y = b (forward substitution) */
function solveLower(L: number[][], b: number[]): number[] {
  const n = b.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  return y;
}

/** Solve Lᵀ x = y (back substitution) */
function solveUpperTransposed(L: number[][], y: number[]): number[] {
  const n = y.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** Fit ridge regression (with internal centering + optional standardization). */
export function fitRidge(X: number[][], y: number[], opts: RidgeFitOptions = {}): RidgeModel {
  const lambda = opts.lambda ?? 1.0;
  const standardize = opts.standardize ?? true;

  const N = X.length;
  if (N === 0) throw new Error('fitRidge: empty X');
  const P = X[0].length;
  if (y.length !== N) throw new Error('fitRidge: dimension mismatch');

  // Per-feature stats
  const meansX = new Array<number>(P).fill(0);
  const stdsX = new Array<number>(P).fill(1);
  for (let j = 0; j < P; j++) {
    const col = X.map(row => row[j]);
    meansX[j] = mean(col);
    stdsX[j] = standardize ? std(col, meansX[j]) : 1;
  }
  const meanY = mean(y);

  // Build standardized & centered matrix Xs and centered yc
  const Xs: number[][] = Array.from({ length: N }, () => new Array(P).fill(0));
  const yc: number[] = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    yc[i] = y[i] - meanY;
    for (let j = 0; j < P; j++) Xs[i][j] = (X[i][j] - meansX[j]) / stdsX[j];
  }

  // Gram matrix G = XsᵀXs + λI
  const G: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  for (let j = 0; j < P; j++) {
    for (let k = 0; k <= j; k++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += Xs[i][j] * Xs[i][k];
      G[j][k] = s;
      G[k][j] = s;
    }
    G[j][j] += lambda;
  }

  // RHS = Xsᵀ yc
  const rhs = new Array<number>(P).fill(0);
  for (let j = 0; j < P; j++) {
    let s = 0;
    for (let i = 0; i < N; i++) s += Xs[i][j] * yc[i];
    rhs[j] = s;
  }

  // Solve G w = rhs via Cholesky
  const L = cholesky(G);
  let wStd: number[];
  if (L) {
    const yvec = solveLower(L, rhs);
    wStd = solveUpperTransposed(L, yvec);
  } else {
    // Should not happen with λ>0 but fall back to all zeros
    wStd = new Array<number>(P).fill(0);
  }

  // Un-standardize: w_orig[j] = wStd[j] / stdsX[j]
  // intercept = meanY − Σ_j w_orig[j] · meansX[j]
  const weights = wStd.map((w, j) => w / stdsX[j]);
  let intercept = meanY;
  for (let j = 0; j < P; j++) intercept -= weights[j] * meansX[j];

  // Training RMSE
  let trainSSE = 0;
  for (let i = 0; i < N; i++) {
    const pred = predict({ weights, intercept } as RidgeModel, X[i]);
    trainSSE += (pred - y[i]) ** 2;
  }
  const trainRMSE = Math.sqrt(trainSSE / N);

  // Leave-one-out CV (re-fit per sample). Cheap because P is tiny.
  let looSSE = 0;
  let looCount = 0;
  if (N >= 3) {
    for (let i = 0; i < N; i++) {
      const Xt = X.filter((_, k) => k !== i);
      const yt = y.filter((_, k) => k !== i);
      try {
        const m = fitRidgeNoLOO(Xt, yt, lambda, standardize);
        const pred = predict(m, X[i]);
        looSSE += (pred - y[i]) ** 2;
        looCount++;
      } catch { /* skip */ }
    }
  }
  const looRMSE = looCount > 0 ? Math.sqrt(looSSE / looCount) : Infinity;

  return {
    weights,
    intercept,
    nFeatures: P,
    nSamples: N,
    lambda,
    meansX,
    stdsX,
    meanY,
    trainRMSE,
    looRMSE,
  };
}

/** Internal fit without LOO (used by LOO loop to avoid infinite recursion). */
function fitRidgeNoLOO(X: number[][], y: number[], lambda: number, standardize: boolean): RidgeModel {
  const N = X.length, P = X[0].length;
  const meansX = new Array<number>(P).fill(0);
  const stdsX = new Array<number>(P).fill(1);
  for (let j = 0; j < P; j++) {
    const col = X.map(r => r[j]);
    meansX[j] = mean(col);
    stdsX[j] = standardize ? std(col, meansX[j]) : 1;
  }
  const meanY = mean(y);
  const Xs: number[][] = Array.from({ length: N }, () => new Array(P).fill(0));
  const yc = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    yc[i] = y[i] - meanY;
    for (let j = 0; j < P; j++) Xs[i][j] = (X[i][j] - meansX[j]) / stdsX[j];
  }
  const G: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  for (let j = 0; j < P; j++) {
    for (let k = 0; k <= j; k++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += Xs[i][j] * Xs[i][k];
      G[j][k] = s; G[k][j] = s;
    }
    G[j][j] += lambda;
  }
  const rhs = new Array<number>(P).fill(0);
  for (let j = 0; j < P; j++) {
    let s = 0;
    for (let i = 0; i < N; i++) s += Xs[i][j] * yc[i];
    rhs[j] = s;
  }
  const L = cholesky(G);
  let wStd: number[];
  if (L) {
    const yv = solveLower(L, rhs);
    wStd = solveUpperTransposed(L, yv);
  } else {
    wStd = new Array<number>(P).fill(0);
  }
  const weights = wStd.map((w, j) => w / stdsX[j]);
  let intercept = meanY;
  for (let j = 0; j < P; j++) intercept -= weights[j] * meansX[j];
  return { weights, intercept, nFeatures: P, nSamples: N, lambda, meansX, stdsX, meanY, trainRMSE: 0, looRMSE: Infinity };
}

/** Predict y for a single feature vector. */
export function predict(model: Pick<RidgeModel, 'weights' | 'intercept'>, x: number[]): number {
  let s = model.intercept;
  for (let j = 0; j < model.weights.length; j++) s += model.weights[j] * x[j];
  return s;
}

/**
 * Fit ridge over a small grid of λ values and return the model with the
 * lowest LOO RMSE. Useful when we don't know the right regularization.
 */
export function fitRidgeAutoLambda(
  X: number[][],
  y: number[],
  lambdas: number[] = [0.01, 0.1, 1, 10, 100],
  standardize = true
): RidgeModel {
  let best: RidgeModel | null = null;
  for (const lam of lambdas) {
    const m = fitRidge(X, y, { lambda: lam, standardize });
    if (!best || m.looRMSE < best.looRMSE) best = m;
  }
  return best ?? fitRidge(X, y, { lambda: 1, standardize });
}
