/// <reference types="vite/client" />

interface HTMLVideoElement {
  requestVideoFrameCallback(callback: (now: number, metadata: VideoFrameCallbackMetadata) => void): number;
  cancelVideoFrameCallback(handle: number): void;
}

interface VideoFrameCallbackMetadata {
  mediaTime?: number;
  expectedDisplayTime?: number;
  presentedFrames?: number;
}
