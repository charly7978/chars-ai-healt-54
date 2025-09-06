// src/modules/vital-signs/ml-calibrator.ts
// Calibrador determinista (ridge) por tipo de biomarcador.
// addSample(kind, features, target) → train(kind) → predict(kind, features)
// Si no hay muestras suficientes, predict → NaN (no inventa).

export type Kind = "hemoglobin" | "glucose" | "cholesterol" | "triglycerides";

type Model = {
  w: number[];     // pesos
  b: number;       // sesgo
  lambda: number;  // regularización usada
  dim: number;     // dimensión de features
  samples: number; // cuántas muestras entrenaron el modelo
};

type Dataset = { X: number[][]; y: number[] };

const store: Record<Kind, Dataset> = {
  hemoglobin:   { X: [], y: [] },
  glucose:      { X: [], y: [] },
  cholesterol:  { X: [], y: [] },
  triglycerides:{ X: [], y: [] },
};

const models: Record<Kind, Model | null> = {
  hemoglobin: null,
  glucose: null,
  cholesterol: null,
  triglycerides: null,
};

export function addSample(kind: Kind, features: number[], target: number) {
  if (!isFinite(target)) return;
  store[kind].X.push(features.slice());
  store[kind].y.push(target);
}

function zeros(n:number){ return Array.from({length:n},()=>0); }

export function train(kind: Kind, lambda=1.0) {
  const { X, y } = store[kind];
  const n = X.length;
  if (n < 5) return null; // mínimo razonable
  const d = X[0].length;

  // Normal equations with ridge: w = (X^T X + λI)^-1 X^T y
  // Construimos XtX y XtY:
  const XtX: number[][] = Array.from({length:d},()=>zeros(d));
  const XtY: number[]   = zeros(d);

  for (let i=0;i<n;i++){
    const xi = X[i];
    const yi = y[i];
    for (let p=0;p<d;p++){
      XtY[p] += xi[p]*yi;
      for (let q=0;q<d;q++){
        XtX[p][q] += xi[p]*xi[q];
      }
    }
  }
  // λI
  for (let p=0;p<d;p++) XtX[p][p] += lambda;

  // Resolver sistema lineal XtX * w = XtY por Gauss-Seidel simple (estabilidad suficiente para d moderado)
  let w = zeros(d);
  const iters = 400;
  const alpha = 1/XtX.reduce((a,row,i)=>a+Math.abs(row[i]),0) || 1e-3;
  for (let it=0; it<iters; it++){
    const wNew = w.slice();
    for (let p=0;p<d;p++){
      let s = XtY[p];
      for (let q=0;q<d;q++){ if(q!==p) s -= XtX[p][q]*w[q]; }
      wNew[p] = (1 - alpha*XtX[p][p])*w[p] + alpha*s; // actualización relajada
    }
    w = wNew;
  }

  // Sesgo b: media de (y - x·w)
  let b = 0;
  for (let i=0;i<n;i++){
    const pred = dot(w, X[i]);
    b += (y[i] - pred);
  }
  b /= n;

  models[kind] = { w, b, lambda, dim: d, samples: n };
  return models[kind];
}

function dot(w:number[], x:number[]){ let s=0; for (let i=0;i<w.length;i++) s+=w[i]*x[i]; return s; }

export function predict(kind: Kind, features: number[]): number {
  const m = models[kind];
  if (!m || features.length !== m.dim) return NaN; // sin modelo entrenado o dimensión distinta
  return dot(m.w, features) + m.b;
}

export function getModel(kind: Kind){ return models[kind]; }
export function reset(kind?: Kind){
  const kinds: Kind[] = kind ? [kind] : ["hemoglobin","glucose","cholesterol","triglycerides"];
  kinds.forEach(k => { store[k] = { X: [], y: [] }; models[k] = null; });
}
