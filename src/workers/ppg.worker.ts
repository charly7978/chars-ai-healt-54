/**
 * PPG WEB WORKER
 * 
 * Offloads heavy pixel operations to a separate thread:
 * - Tile-based ROI processing
 * - Optical density calculations
 * - Tile-level metrics (variance, entropy, gradient)
 * - Frame differencing for visual motion detection
 * - Clipping detection
 */

export interface TileMetrics {
  tileIndex: number;
  rawRed: number;
  rawGreen: number;
  rawBlue: number;
  coverageRatio: number;
  clipHighRatio: number;
  clipLowRatio: number;
  variance: number;
  entropy: number;
  gradient: number;
  spatialUniformity: number;
  centerDistance: number;
  dominantComponentIndex: number;
}

export interface WorkerInput {
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
  gridSize: number; // e.g., 5 for 5x5 grid
  roiMask?: boolean[];
  operation: 'tileMetrics' | 'opticalDensity' | 'visualMotion' | 'clipping';
}

export interface WorkerOutput {
  tileMetrics?: TileMetrics[];
  opticalDensity?: { redOD: number; greenOD: number; blueOD: number };
  visualMotion?: number;
  clipping?: { clipHighRatio: number; clipLowRatio: number };
}

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const { imageData, width, height, gridSize, roiMask, operation } = event.data;

  try {
    let result: WorkerOutput;

    switch (operation) {
      case 'tileMetrics':
        result = { tileMetrics: computeTileMetrics(imageData, width, height, gridSize, roiMask) };
        break;
      case 'opticalDensity':
        result = { opticalDensity: computeOpticalDensity(imageData, width, height, roiMask) };
        break;
      case 'visualMotion':
        result = { visualMotion: computeVisualMotion(imageData, width, height) };
        break;
      case 'clipping':
        result = { clipping: computeClipping(imageData, width, height, roiMask) };
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    self.postMessage({ success: true, result });
  } catch (error) {
    self.postMessage({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
};

/**
 * Compute tile-level metrics for a grid of tiles
 */
function computeTileMetrics(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize: number,
  roiMask?: boolean[]
): TileMetrics[] {
  const tileWidth = Math.floor(width / gridSize);
  const tileHeight = Math.floor(height / gridSize);
  const tiles: TileMetrics[] = [];

  for (let ty = 0; ty < gridSize; ty++) {
    for (let tx = 0; tx < gridSize; tx++) {
      const tileIndex = ty * gridSize + tx;
      const startX = tx * tileWidth;
      const startY = ty * tileHeight;
      const endX = Math.min(startX + tileWidth, width);
      const endY = Math.min(startY + tileHeight, height);

      // Skip if tile is outside ROI mask
      if (roiMask && !roiMask[tileIndex]) {
        tiles.push(createEmptyTileMetrics(tileIndex));
        continue;
      }

      const metrics = computeTileMetricsHelper(
        imageData, width, height, startX, startY, endX, endY, tileIndex, gridSize
      );
      tiles.push(metrics);
    }
  }

  return tiles;
}

/**
 * Helper to compute metrics for a single tile
 */
function computeTileMetricsHelper(
  imageData: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  tileIndex: number,
  gridSize: number
): TileMetrics {
  let sumR = 0, sumG = 0, sumB = 0;
  let sumR2 = 0, sumG2 = 0, sumB2 = 0;
  let clipHighCount = 0, clipLowCount = 0;
  let pixelCount = 0;
  const histogramR = new Array(256).fill(0);
  const histogramG = new Array(256).fill(0);
  const histogramB = new Array(256).fill(0);

  // Sample pixels in the tile
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * imgWidth + x) * 4;
      const r = imageData[idx];
      const g = imageData[idx + 1];
      const b = imageData[idx + 2];

      sumR += r;
      sumG += g;
      sumB += b;
      sumR2 += r * r;
      sumG2 += g * g;
      sumB2 += b * b;

      histogramR[r]++;
      histogramG[g]++;
      histogramB[b]++;

      if (r > 250 || g > 250 || b > 250) clipHighCount++;
      if (r < 5 || g < 5 || b < 5) clipLowCount++;

      pixelCount++;
    }
  }

  if (pixelCount === 0) {
    return createEmptyTileMetrics(tileIndex);
  }

  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;

  const varianceR = (sumR2 / pixelCount) - (meanR * meanR);
  const varianceG = (sumG2 / pixelCount) - (meanG * meanG);
  const varianceB = (sumB2 / pixelCount) - (meanB * meanB);

  // Compute entropy
  const entropyR = computeEntropy(histogramR, pixelCount);
  const entropyG = computeEntropy(histogramG, pixelCount);
  const entropyB = computeEntropy(histogramB, pixelCount);
  const avgEntropy = (entropyR + entropyG + entropyB) / 3;

  // Compute gradient (edge detection)
  const gradient = computeGradient(imageData, imgWidth, imgHeight, startX, startY, endX, endY);

  // Spatial uniformity (inverse of variance)
  const spatialUniformity = 1 / (1 + Math.sqrt(varianceR + varianceG + varianceB) / 50);

  // Center distance (normalized distance from image center)
  const centerX = imgWidth / 2;
  const centerY = imgHeight / 2;
  const tileCenterX = (startX + endX) / 2;
  const tileCenterY = (startY + endY) / 2;
  const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
  const centerDistance = Math.sqrt(
    (tileCenterX - centerX) ** 2 + (tileCenterY - centerY) ** 2
  ) / maxDist;

  // Dominant component
  const dominantComponentIndex = [meanR, meanG, meanB].indexOf(Math.max(meanR, meanG, meanB));

  return {
    tileIndex,
    rawRed: meanR,
    rawGreen: meanG,
    rawBlue: meanB,
    coverageRatio: 1, // Will be computed by caller
    clipHighRatio: clipHighCount / pixelCount,
    clipLowRatio: clipLowCount / pixelCount,
    variance: (varianceR + varianceG + varianceB) / 3,
    entropy: avgEntropy,
    gradient,
    spatialUniformity,
    centerDistance,
    dominantComponentIndex,
  };
}

/**
 * Compute optical density from RGB values
 */
function computeOpticalDensity(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  roiMask?: boolean[]
): { redOD: number; greenOD: number; blueOD: number } {
  let sumR = 0, sumG = 0, sumB = 0;
  let pixelCount = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    // Skip if outside ROI mask
    if (roiMask && roiMask[Math.floor((i / 4) / (width * height / roiMask.length)) % roiMask.length] === false) {
      continue;
    }

    sumR += imageData[i];
    sumG += imageData[i + 1];
    sumB += imageData[i + 2];
    pixelCount++;
  }

  if (pixelCount === 0) {
    return { redOD: 0, greenOD: 0, blueOD: 0 };
  }

  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;

  const eps = 1e-6;
  const maxIntensity = 255;

  const redOD = -Math.log((meanR + eps) / maxIntensity);
  const greenOD = -Math.log((meanG + eps) / maxIntensity);
  const blueOD = -Math.log((meanB + eps) / maxIntensity);

  return { redOD, greenOD, blueOD };
}

/**
 * Compute visual motion using frame difference
 */
function computeVisualMotion(
  imageData: Uint8ClampedArray,
  width: number,
  height: number
): number {
  // This would need previous frame data stored in worker state
  // For now, return 0 as a placeholder
  // In a real implementation, we'd store the previous frame and compute differences
  return 0;
}

/**
 * Compute clipping ratios
 */
function computeClipping(
  imageData: Uint8ClampedArray,
  width: number,
  height: number,
  roiMask?: boolean[]
): { clipHighRatio: number; clipLowRatio: number } {
  let clipHighCount = 0;
  let clipLowCount = 0;
  let pixelCount = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    // Skip if outside ROI mask
    if (roiMask && roiMask[Math.floor((i / 4) / (width * height / roiMask.length)) % roiMask.length] === false) {
      continue;
    }

    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];

    if (r > 250 || g > 250 || b > 250) clipHighCount++;
    if (r < 5 || g < 5 || b < 5) clipLowCount++;

    pixelCount++;
  }

  if (pixelCount === 0) {
    return { clipHighRatio: 0, clipLowRatio: 0 };
  }

  return {
    clipHighRatio: clipHighCount / pixelCount,
    clipLowRatio: clipLowCount / pixelCount,
  };
}

/**
 * Compute entropy from histogram
 */
function computeEntropy(histogram: number[], total: number): number {
  let entropy = 0;
  for (let i = 0; i < histogram.length; i++) {
    if (histogram[i] > 0) {
      const p = histogram[i] / total;
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Compute gradient (edge magnitude) using Sobel operator
 */
function computeGradient(
  imageData: Uint8ClampedArray,
  imgWidth: number,
  imgHeight: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): number {
  let totalGradient = 0;
  let pixelCount = 0;

  // Convert to grayscale for gradient computation
  const getGray = (x: number, y: number) => {
    const idx = (y * imgWidth + x) * 4;
    return 0.299 * imageData[idx] + 0.587 * imageData[idx + 1] + 0.114 * imageData[idx + 2];
  };

  // Sobel kernels
  const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

  for (let y = startY + 1; y < endY - 1; y++) {
    for (let x = startX + 1; x < endX - 1; x++) {
      let gx = 0, gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const gray = getGray(x + kx, y + ky);
          gx += gray * sobelX[ky + 1][kx + 1];
          gy += gray * sobelY[ky + 1][kx + 1];
        }
      }

      totalGradient += Math.sqrt(gx * gx + gy * gy);
      pixelCount++;
    }
  }

  return pixelCount > 0 ? totalGradient / pixelCount : 0;
}

/**
 * Create empty tile metrics for masked-out tiles
 */
function createEmptyTileMetrics(tileIndex: number): TileMetrics {
  return {
    tileIndex,
    rawRed: 0,
    rawGreen: 0,
    rawBlue: 0,
    coverageRatio: 0,
    clipHighRatio: 0,
    clipLowRatio: 0,
    variance: 0,
    entropy: 0,
    gradient: 0,
    spatialUniformity: 0,
    centerDistance: 1,
    dominantComponentIndex: 0,
  };
}
