interface NumericCapabilityRange {
  max?: number;
  min?: number;
  step?: number;
}

interface MediaTrackCapabilities {
  torch?: boolean;
  exposureMode?: string;
  exposureTime?: NumericCapabilityRange;
  exposureCompensation?: NumericCapabilityRange;
  focusMode?: string;
  whiteBalanceMode?: string;
  focusDistance?: NumericCapabilityRange;
  zoom?: NumericCapabilityRange;
  brightness?: NumericCapabilityRange;
  contrast?: NumericCapabilityRange;
  saturation?: NumericCapabilityRange;
  sharpness?: NumericCapabilityRange;
  colorTemperature?: NumericCapabilityRange;
  iso?: NumericCapabilityRange;
}

interface MediaTrackConstraintSet {
  torch?: boolean;
  exposureMode?: ConstrainDOMString;
  exposureTime?: ConstrainDouble;
  exposureCompensation?: ConstrainDouble;
  focusMode?: ConstrainDOMString;
  whiteBalanceMode?: ConstrainDOMString;
  focusDistance?: ConstrainDouble;
  zoom?: ConstrainDouble;
  brightness?: ConstrainDouble;
  contrast?: ConstrainDouble;
  saturation?: ConstrainDouble;
  sharpness?: ConstrainDouble;
  colorTemperature?: ConstrainDouble;
  iso?: ConstrainDouble;
}

declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
  takePhoto(): Promise<Blob>;
}