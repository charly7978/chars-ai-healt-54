/**
 * PPG Web Worker — Heavy computation offloaded from main thread
 * Handles: ROI extraction, autocorrelation periodicity, source ranking
 */

interface ROIRequest {
  type: 'extractROI';
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  tileConfidence: number[];
}

interface AutocorrRequest {
  type: 'autocorrelation';
  id: number;
  signal: number[];
  mean: number;
  sampleRate: number;
}

interface SourceRankRequest {
  type: 'rankSources';
  id: number;
  sourceBuffers: { [key: string]: number[] };
  activeSource: string;
  currentScore: number;
}

type WorkerRequest = ROIRequest | AutocorrRequest | SourceRankRequest;

// === ROI EXTRACTION (pixel-heavy) ===
function extractROI(
  pixels: Uint8ClampedArray, width: number, height: number,
  tileConfidence: number[]
): {
  rawRed: number; rawGreen: number; rawBlue: number;
  coverageRatio: number; fingerScore: number;
  updatedTileConfidence: number[];
} {
  const TILE_COLS = 5;
  const TILE_ROWS = 5;

  const roiSize = Math.min(width, height) * 0.78;
  const startX = Math.floor((width - roiSize) / 2);
  const startY = Math.floor((height - roiSize) / 2);
  const endX = startX + Math.floor(roiSize);
  const endY = startY + Math.floor(roiSize);

  const tiles = new Array(TILE_COLS * TILE_ROWS);
  for (let i = 0; i < tiles.length; i++) {
    tiles[i] = { red: 0, green: 0, blue: 0, count: 0 };
  }

  const roiWidth = Math.max(1, endX - startX);
  const roiHeight = Math.max(1, endY - startY);

  // Sample every 3rd pixel
  for (let y = startY; y < endY; y += 3) {
    for (let x = startX; x < endX; x += 3) {
      const i = (y * width + x) * 4;
      const tileX = Math.min(TILE_COLS - 1, Math.floor(((x - startX) / roiWidth) * TILE_COLS));
      const tileY = Math.min(TILE_ROWS - 1, Math.floor(((y - startY) / roiHeight) * TILE_ROWS));
      const tile = tiles[tileY * TILE_COLS + tileX];
      tile.red += pixels[i];
      tile.green += pixels[i + 1];
      tile.blue += pixels[i + 2];
      tile.count++;
    }
  }

  const updatedConf = [...tileConfidence];
  const averagedTiles: any[] = [];

  for (let idx = 0; idx < tiles.length; idx++) {
    const tile = tiles[idx];
    if (tile.count === 0) continue;
    const red = tile.red / tile.count;
    const green = tile.green / tile.count;
    const blue = tile.blue / tile.count;
    const total = red + green + blue;
    const redDominance = red - (green + blue) / 2;
    const rednessRatio = red / Math.max(1, green);
    const gridX = idx % TILE_COLS;
    const gridY = Math.floor(idx / TILE_COLS);
    const normX = gridX / (TILE_COLS - 1);
    const normY = gridY / (TILE_ROWS - 1);
    const distanceFromCenter = Math.sqrt((normX - 0.5) ** 2 + (normY - 0.5) ** 2);
    const centerBias = Math.min(1, Math.max(0.3, 1 - distanceFromCenter * 1.2));

    const brightnessScore = Math.min(1, Math.max(0, (total - 100) / 250));
    const redRatioScore = Math.min(1, Math.max(0, (rednessRatio - 1.0) / 0.9));
    const dominanceScore = Math.min(1, Math.max(0, (redDominance - 5) / 40));
    const frameScore = redRatioScore * 0.45 + dominanceScore * 0.4 + brightnessScore * 0.15;

    updatedConf[idx] = updatedConf[idx] * 0.75 + frameScore * centerBias * 0.25;
    const combinedScore = updatedConf[idx] * 0.7 + frameScore * 0.3;

    averagedTiles.push({ red, green, blue, total, redDominance, rednessRatio, centerBias, combinedScore });
  }

  if (averagedTiles.length === 0) {
    return { rawRed: 0, rawGreen: 0, rawBlue: 0, coverageRatio: 0, fingerScore: 0, updatedTileConfidence: updatedConf };
  }

  // More relaxed finger tile filter
  const fingerTiles = averagedTiles.filter(t =>
    t.red > 45 && t.total > 100 && t.redDominance > 8 && t.rednessRatio > 1.05 && t.combinedScore > 0.30
  );

  const selected = fingerTiles.length >= 4 ? fingerTiles : averagedTiles;

  const weightedAvg = (ch: 'red' | 'green' | 'blue') => {
    let ws = 0, tw = 0;
    for (const t of selected) {
      const w = 0.3 + t.combinedScore * 2 + t.centerBias * 0.4;
      ws += t[ch] * w;
      tw += w;
    }
    return tw > 0 ? ws / tw : averagedTiles.reduce((s: number, t: any) => s + t[ch], 0) / averagedTiles.length;
  };

  const coverageRatio = fingerTiles.length / averagedTiles.length;
  const avgFingerScore = fingerTiles.length > 0
    ? fingerTiles.reduce((s: number, t: any) => s + t.combinedScore, 0) / fingerTiles.length
    : 0;

  return {
    rawRed: weightedAvg('red'),
    rawGreen: weightedAvg('green'),
    rawBlue: weightedAvg('blue'),
    coverageRatio,
    fingerScore: avgFingerScore,
    updatedTileConfidence: updatedConf,
  };
}

// === AUTOCORRELATION (O(n²) CPU-bound) ===
function computeAutocorrelation(signal: number[], mean: number, sampleRate: number): number {
  const n = signal.length;
  if (n < 40) return 0;

  const minLag = Math.max(2, Math.floor(sampleRate * 60 / 210));
  const maxLag = Math.min(Math.floor(n * 0.6), Math.floor(sampleRate * 60 / 30));
  if (minLag >= maxLag || maxLag >= n) return 0;

  let variance = 0;
  for (let i = 0; i < n; i++) variance += (signal[i] - mean) ** 2;
  if (variance < 1e-6) return 0;

  let bestCorr = 0;
  let bestLag = 0;

  // Step by 1 for precision in cardiac range
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += (signal[i] - mean) * (signal[i + lag] - mean);
    }
    const r = sum / variance;
    if (r > bestCorr) { bestCorr = r; bestLag = lag; }
  }

  // Harmonic check
  let harmonicBonus = 0;
  if (bestLag > 0 && bestCorr > 0.12) {
    const dLag = bestLag * 2;
    if (dLag < n) {
      let s2 = 0;
      for (let i = 0; i < n - dLag; i++) {
        s2 += (signal[i] - mean) * (signal[i + dLag] - mean);
      }
      if (s2 / variance > 0.08) harmonicBonus = 0.15;
    }
  }

  const raw = Math.min(1, Math.max(0, bestCorr + harmonicBonus));
  return Math.min(1, Math.max(0, (raw - 0.10) / 0.55));
}

// === SOURCE RANKING ===
function rankSources(sourceBuffers: { [key: string]: number[] }, activeSource: string, currentScore: number): { bestSource: string; scores: { [key: string]: number } } {
  const scores: { [key: string]: number } = {};
  let bestSource = activeSource;
  let bestScore = -1;

  for (const key of Object.keys(sourceBuffers)) {
    const buf = sourceBuffers[key];
    if (buf.length < 40) continue;
    const recent = buf.slice(-90);
    const sorted = [...recent].sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
    const range = p90 - p10;
    if (range < 0.08) { scores[key] = 0; continue; }
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const variance = recent.reduce((a, v) => a + (v - mean) ** 2, 0) / recent.length;
    const snr = range / (Math.sqrt(variance) + 0.1);
    const clipped = recent.filter(v => Math.abs(v) > 70).length / recent.length;
    scores[key] = Math.max(0, snr * 15 - clipped * 30);
    if (scores[key] > bestScore) { bestScore = scores[key]; bestSource = key; }
  }

  // Only switch if 20% better
  if (bestSource !== activeSource && bestScore <= currentScore * 1.2) {
    bestSource = activeSource;
  }

  return { bestSource, scores };
}

// === MESSAGE HANDLER ===
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'extractROI': {
      const result = extractROI(msg.pixels, msg.width, msg.height, msg.tileConfidence);
      (self as any).postMessage({ type: 'roiResult', id: msg.id, ...result });
      break;
    }
    case 'autocorrelation': {
      const score = computeAutocorrelation(msg.signal, msg.mean, msg.sampleRate);
      (self as any).postMessage({ type: 'autocorrResult', id: msg.id, score });
      break;
    }
    case 'rankSources': {
      const result = rankSources(msg.sourceBuffers, msg.activeSource, msg.currentScore);
      (self as any).postMessage({ type: 'rankResult', id: msg.id, ...result });
      break;
    }
  }
};
