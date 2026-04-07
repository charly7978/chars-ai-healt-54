import React from "react";

interface CameraPreviewProps {
  stream: MediaStream | null;
}

const CameraPreview: React.FC<CameraPreviewProps> = ({ stream }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  if (!stream) return null;

  return (
    <div className="absolute top-2 right-2 w-24 h-20 rounded-lg overflow-hidden border-2 border-white/30 shadow-lg z-20">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </div>
  );
};

export default CameraPreview;
