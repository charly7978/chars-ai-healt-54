
interface MediaTrackCapabilities {
  torch?: boolean;
  exposureMode?: string;
  exposureTime?: {
    max?: number;
    min?: number;
    step?: number;
  };
  focusMode?: string;
  whiteBalanceMode?: string;
  focusDistance?: {
    max?: number;
    min?: number;
    step?: number;
  };
}

interface MediaTrackConstraintSet {
  torch?: boolean;
  exposureMode?: ConstrainDOMString;
  exposureTime?: ConstrainDouble;
  focusMode?: ConstrainDOMString;
  whiteBalanceMode?: ConstrainDOMString;
  focusDistance?: ConstrainDouble;
}

declare class ImageCapture {
  constructor(track: MediaStreamTrack);
  grabFrame(): Promise<ImageBitmap>;
  takePhoto(): Promise<Blob>;
}
