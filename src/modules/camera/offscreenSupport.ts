/**
 * Detección de APIs para captura PPG sin readback pesado en main thread.
 */

export function supportsCreateImageBitmap(): boolean {
  return typeof createImageBitmap === 'function';
}

export function supportsImageBitmapInWorker(): boolean {
  return typeof ImageBitmap !== 'undefined';
}

export function supportsOffscreenCanvas(): boolean {
  return typeof OffscreenCanvas === 'function';
}
