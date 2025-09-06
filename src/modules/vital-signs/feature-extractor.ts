// src/modules/vital-signs/feature-extractor.ts
// Extracción de features reales (sin simulación) a partir de PPG y RR.
// Produce un vector de características fijo para entrenar/predicir Hb/Glucosa/Lípidos.
// NO usa números mágicos: todo sale de estadísticas, morfología y HRV reales.

export type RRData = {
  intervals: number[]; // ms
  rmssd: number;
  pnn50: number;
  cvRR: number;
};

export type PPGChannels = {
  red: number[];   // últimas muestras (DC+AC)
  green: number[];
};

export type FeatureVector = {
  names: string[];
  values: number[];
};

function mean(arr: number[]) {
  if (!arr.length) return 0;
  return arr.reduce((a,b)=>a+b,0)/arr.length;
}
function variance(arr: number[], m?: number) {
  if (!arr.length) return 0;
  const mu = m ?? mean(arr);
  return arr.reduce((a,b)=>a+(b-mu)*(b-mu),0)/arr.length;
}
function std(arr: number[], m?: number) {
  return Math.sqrt(Math.max(0, variance(arr, m)));
}
function minmax(arr: number[]) {
  if (!arr.length) return {min:0,max:0,ptp:0};
  let mn = arr[0], mx = arr[0];
  for (let i=1;i<arr.length;i++){ if(arr[i]<mn) mn=arr[i]; if(arr[i]>mx) mx=arr[i]; }
  return {min: mn, max: mx, ptp: mx-mn};
}
function zscores(arr: number[]) {
  const mu = mean(arr), sd = std(arr, mu)||1;
  return arr.map(v => (v-mu)/sd);
}
function diff(arr: number[]) {
  const out: number[] = [];
  for (let i=1;i<arr.length;i++){ out.push(arr[i]-arr[i-1]); }
  return out;
}
function skewness(arr: number[]) {
  if (arr.length<3) return 0;
  const mu = mean(arr), sd = std(arr, mu)||1;
  const n = arr.length;
  const s3 = arr.reduce((a,b)=>a+Math.pow((b-mu)/sd,3),0)/n;
  return s3;
}
function kurtosis(arr: number[]) {
  if (arr.length<3) return 0;
  const mu = mean(arr), sd = std(arr, mu)||1;
  const n = arr.length;
  const k = arr.reduce((a,b)=>a+Math.pow((b-mu)/sd,4),0)/n - 3;
  return k;
}
function zeroCrossRate(arr: number[]) {
  let z=0;
  for (let i=1;i<arr.length;i++){ if ((arr[i-1]>=0)!==(arr[i]>=0)) z++; }
  return arr.length? z/(arr.length-1) : 0;
}
function aucNormalized(arr: number[]) {
  // área bajo curva normalizada a [0,1] por min-max
  if (!arr.length) return 0;
  const {min, max} = minmax(arr);
  const rng = (max-min)||1;
  let s=0;
  for (let i=0;i<arr.length;i++){ s += (arr[i]-min)/rng; }
  return s/arr.length;
}
function peakProminence(arr: number[]) {
  // medida simple: pico global relativo a vecinos
  if (arr.length<3) return 0;
  const {max} = minmax(arr);
  const mu = mean(arr);
  return (max-mu)/(std(arr, mu)||1);
}

// Goertzel para una frecuencia objetivo aproximada (útil con HR estimada)
function goertzelPower(x: number[], fs: number, f0: number) {
  if (!x.length || fs<=0 || f0<=0) return 0;
  const k = Math.round((x.length * f0) / fs);
  const w = 2*Math.PI*k/x.length;
  let s0=0,s1=0,s2=0;
  for (let n=0;n<x.length;n++){
    s0 = x[n] + 2*Math.cos(w)*s1 - s2;
    s2 = s1; s1 = s0;
  }
  const power = s1*s1 + s2*s2 - 2*Math.cos(w)*s1*s2;
  return Math.max(0, power/x.length);
}

export function extractPPGFeatures(ch: PPGChannels, rr?: RRData): FeatureVector {
  const r = ch.red || [];
  const g = ch.green || [];
  const names: string[] = [];
  const values: number[] = [];

  // --- Estadísticos básicos (R, G)
  const mr = mean(r),  vr = variance(r, mr),  sdr = Math.sqrt(vr);
  const mg = mean(g),  vg = variance(g, mg),  sdg = Math.sqrt(vg);
  const {ptp:ptpr} = minmax(r);
  const {ptp:ptpg} = minmax(g);
  const zr = zscores(r);
  const zg = zscores(g);

  names.push("R_mean","R_std","R_ptp","G_mean","G_std","G_ptp");
  values.push(mr,      sdr,    ptpr,   mg,      sdg,    ptpg);

  // --- Morfología (derivadas, asimetría, curtosis)
  const dr = diff(r);
  const d2r = diff(dr);
  names.push("R_skew","R_kurt","R_d1_std","R_d2_std","R_aucN","R_peakProm");
  values.push(skewness(r), kurtosis(r), std(dr), std(d2r), aucNormalized(r), peakProminence(r));

  // --- Relación R/G (aprox. multispectral)
  const rgRatioMean = (mg>0)? (mr/mg) : 0;
  const rgStdMean   = (sdg>0)? (sdr/sdg) : 0;
  names.push("RG_mean_ratio","RG_std_ratio");
  values.push(rgRatioMean, rgStdMean);

  // --- Frecuencia (usar HR aproximada de RR si existe)
  let fsGuess = 30; // aproximación razonable (tu capturador trabaja a 30 FPS)
  // Dominante a HR (si hay RR)
  let f0 = 1.2; // Hz por defecto (~72 bpm)
  if (rr?.intervals?.length) {
    const meanRR = mean(rr.intervals);
    if (meanRR>0) f0 = Math.max(0.6, Math.min(3.0, 1000/meanRR)); // 36–180 bpm
  }
  names.push("R_goertzel_at_HR","G_goertzel_at_HR","R_zcr","G_zcr");
  values.push(goertzelPower(r, fsGuess, f0), goertzelPower(g, fsGuess, f0), zeroCrossRate(r), zeroCrossRate(g));

  // --- HRV reales (si hay)
  if (rr) {
    names.push("RR_rmssd","RR_pnn50","RR_cvRR");
    values.push(rr.rmssd||0, rr.pnn50||0, rr.cvRR||0);
  } else {
    names.push("RR_rmssd","RR_pnn50","RR_cvRR");
    values.push(0,0,0);
  }

  return { names, values };
}
