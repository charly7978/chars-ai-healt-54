import { describe, it, expect } from 'vitest';
import { fitRidge, fitRidgeAutoLambda, predict } from '../RidgeRegressor';

/**
 * Ridge → linear regression sanity tests with deterministic synthetic data.
 */
function syntheticLinear(N: number, P: number, betaTrue: number[], interceptTrue: number, noise = 0): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < N; i++) {
    const row: number[] = [];
    for (let j = 0; j < P; j++) {
      // Deterministic feature value: combination of i, j, sinusoids
      row.push(Math.sin(i * 0.7 + j) + 0.3 * (i % (j + 2)));
    }
    let yi = interceptTrue;
    for (let j = 0; j < P; j++) yi += row[j] * betaTrue[j];
    if (noise !== 0) yi += noise * Math.cos(i * 1.3); // structured noise, no Math.random
    X.push(row);
    y.push(yi);
  }
  return { X, y };
}

describe('RidgeRegressor', () => {
  it('recovers true coefficients with very small λ on noiseless data', () => {
    const { X, y } = syntheticLinear(40, 4, [2, -1, 0.5, 3], 10, 0);
    const m = fitRidge(X, y, { lambda: 1e-6, standardize: false });
    expect(m.weights[0]).toBeCloseTo(2, 1);
    expect(m.weights[1]).toBeCloseTo(-1, 1);
    expect(m.weights[2]).toBeCloseTo(0.5, 1);
    expect(m.weights[3]).toBeCloseTo(3, 1);
    expect(m.intercept).toBeCloseTo(10, 1);
    expect(m.trainRMSE).toBeLessThan(0.01);
  });

  it('shrinks coefficients toward zero with large λ', () => {
    const { X, y } = syntheticLinear(40, 4, [2, -1, 0.5, 3], 10, 0);
    const m = fitRidge(X, y, { lambda: 1e6, standardize: true });
    for (const w of m.weights) expect(Math.abs(w)).toBeLessThan(0.1);
  });

  it('predicts numerically stable values on training data', () => {
    const { X, y } = syntheticLinear(30, 5, [1, 2, -1, 0.3, -2], 5);
    const m = fitRidge(X, y, { lambda: 0.01 });
    for (let i = 0; i < X.length; i++) {
      const yh = predict(m, X[i]);
      expect(Number.isFinite(yh)).toBe(true);
      expect(Math.abs(yh - y[i])).toBeLessThan(1);
    }
  });

  it('LOO RMSE is finite when N≥3 and ∞ when N<3', () => {
    const { X, y } = syntheticLinear(10, 3, [1, 2, 3], 0);
    expect(Number.isFinite(fitRidge(X, y, { lambda: 1 }).looRMSE)).toBe(true);
    const m2 = fitRidge([[1, 2], [3, 4]], [1, 2], { lambda: 1 });
    expect(m2.looRMSE).toBe(Infinity);
  });

  it('handles zero-variance feature without crashing', () => {
    const X = [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]];
    const y = [10, 20, 30, 40, 50];
    const m = fitRidge(X, y, { lambda: 0.1, standardize: true });
    expect(Number.isFinite(m.intercept)).toBe(true);
    expect(Number.isFinite(m.weights[0])).toBe(true);
    expect(Number.isFinite(m.weights[1])).toBe(true);
  });

  it('fitRidgeAutoLambda picks a model and exposes LOO RMSE', () => {
    const { X, y } = syntheticLinear(20, 3, [1, -1, 0.5], 7);
    const m = fitRidgeAutoLambda(X, y, [0.001, 0.1, 10, 1000]);
    expect(Number.isFinite(m.looRMSE)).toBe(true);
    expect(m.lambda).toBeGreaterThan(0);
  });
});
