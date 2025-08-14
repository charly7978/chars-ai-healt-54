import React, { useRef, useEffect, useState } from 'react';
import { toast } from "@/components/ui/use-toast";
import { AdvancedVitalSignsProcessor, BiometricReading } from '../modules/vital-signs/VitalSignsProcessor';
import styles from './CameraView.module.css';

interface CameraViewProps {
  onStreamReady?: (stream: MediaStream) => void;
  isMonitoring: boolean;
  isFingerDetected?: boolean;
  signalQuality?: number;
}

const CameraView: React.FC<CameraViewProps> = ({ 
  onStreamReady, 
  isMonitoring, 
  isFingerDetected = false, 
  signalQuality = 0,
}) => {
  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const vitalProcessor = useRef<AdvancedVitalSignsProcessor>(new AdvancedVitalSignsProcessor());
  const torchAttempts = useRef<number>(0);
  const cameraInitialized = useRef<boolean>(false);
  const requestedTorch = useRef<boolean>(false);
  
  // State
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [deviceSupportsTorch, setDeviceSupportsTorch] = useState<boolean>(false);
  const [deviceSupportsAutoFocus, setDeviceSupportsAutoFocus] = useState<boolean>(false);
  
  // Helper functions
  const handleTorch = async (enable: boolean) => {
    if (!deviceSupportsTorch || !stream) return;
    
    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return;
      
      await videoTrack.applyConstraints({
        advanced: [{ torch: enable } as any]
      });
      setTorchEnabled(enable);
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Error toggling torch:', err);
      }
    }
  };

  const handleAutoFocus = async () => {
    if (!deviceSupportsAutoFocus || !stream) return;
    
    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) return;
      
      await videoTrack.applyConstraints({
        advanced: [{ focusMode: 'continuous' } as any]
      });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Error adjusting focus:', err);
      }
    }
  };

  const extractPPGSignals = (frameData: ImageData) => {
    const { width, height, data } = frameData;
    const pixelCount = width * height;
    
    // Calculate channel averages
    let redSum = 0, irSum = 0, greenSum = 0;
    
    for (let i = 0; i < pixelCount * 4; i += 4) {
      redSum += data[i];     // Red channel
      greenSum += data[i+1]; // Green channel
      irSum += data[i+2];    // Infrared channel
    }
    
    return {
      red: [redSum / pixelCount],
      ir: [irSum / pixelCount],
      green: [greenSum / pixelCount]
    };
  };

  const processFrame = (frameData: ImageData) => {
    const { red, ir, green } = extractPPGSignals(frameData);
    
    const results = vitalProcessor.current.processSignal({
      red,
      ir, 
      green,
      timestamp: Date.now()
    });
    
    if (results) {
      handleResults(results);
    }
  };

  const handleResults = (results: BiometricReading) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('Biometric measurements:', {
        spo2: results.spo2.toFixed(1) + '%',
        pressure: `${results.sbp}/${results.dbp} mmHg`,
        glucose: `${results.glucose.toFixed(0)} mg/dL`,
        confidence: `${(results.confidence * 100).toFixed(1)}%`
      });
    }
  };

  const stopCamera = async () => {
    if (stream) {
      try {
        // Stop all tracks in the stream
        stream.getTracks().forEach(track => {
          // Turn off torch if supported
          if (track.kind === 'video' && track.getCapabilities()?.torch) {
            track.applyConstraints({
              advanced: [{ torch: false } as any]
            }).catch(err => {
              if (process.env.NODE_ENV !== 'production') {
                console.error('Error turning off torch:', err);
              }
            });
          }
          track.stop();
        });
        
        // Clear video source
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        
        // Reset states
        setStream(null);
        setTorchEnabled(false);
        cameraInitialized.current = false;
        requestedTorch.current = false;
        
        if (process.env.NODE_ENV !== 'production') {
          console.log('Camera stopped successfully');
        }
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Error stopping camera:', error);
        }
      }
    }
  };

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia not supported");
      }

      // Sanitize user agent to prevent log injection
      const userAgent = typeof navigator !== 'undefined' ? 
        String(navigator.userAgent || '') : '';
      const isAndroid = /android/i.test(userAgent);
      const isIOS = /iPad|iPhone|iPod/.test(userAgent);

      let baseVideoConstraints: MediaTrackConstraints = {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      };

      if (isAndroid) {
        Object.assign(baseVideoConstraints, {
          frameRate: { ideal: 30, max: 30 },
          resizeMode: 'crop-and-scale'
        });
      } else if (isIOS) {
        Object.assign(baseVideoConstraints, {
          frameRate: { ideal: 30, min: 30 },
        });
      } else {
        Object.assign(baseVideoConstraints, {
          frameRate: { ideal: 30 }
        });
      }

      const constraints: MediaStreamConstraints = {
        video: baseVideoConstraints,
        audio: false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const videoTrack = newStream.getVideoTracks()[0];

      if (videoTrack) {
        try {
          const capabilities = videoTrack.getCapabilities();
          
          const advancedConstraints: MediaTrackConstraintSet[] = [];
          
          if (capabilities.exposureMode) {
            advancedConstraints.push({ 
              exposureMode: 'manual'
            });

            if (capabilities.exposureTime) {
              const minExposure = capabilities.exposureTime.min || 0;
              const maxExposure = capabilities.exposureTime.max || 1000;
              const targetExposure = maxExposure * 0.8;
              
              advancedConstraints.push({
                exposureTime: targetExposure
              });
            }
          }
          
          if (capabilities.focusMode) {
            advancedConstraints.push({ focusMode: 'continuous' });
            setDeviceSupportsAutoFocus(true);
          }
          
          if (capabilities.whiteBalanceMode) {
            advancedConstraints.push({ whiteBalanceMode: 'continuous' });
          }

          if (advancedConstraints.length > 0) {
            try {
              await videoTrack.applyConstraints({
                advanced: advancedConstraints
              });
            } catch (err) {
              if (process.env.NODE_ENV !== 'production') {
                console.error("Error applying advanced constraints:", err);
              }
            }
          }

          if (videoRef.current) {
            videoRef.current.style.transform = 'translateZ(0)';
            videoRef.current.style.backfaceVisibility = 'hidden';
          }
          
          if (capabilities.torch) {
            setDeviceSupportsTorch(true);
            
            try {
              await handleTorch(true);
            } catch (err) {
              torchAttempts.current++;
              
              setTimeout(async () => {
                try {
                  await handleTorch(true);
                } catch (err) {
                  if (process.env.NODE_ENV !== 'production') {
                    console.error("Error on second torch attempt:", err);
                  }
                }
              }, 1000);
            }
          } else {
            setDeviceSupportsTorch(false);
          }
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.log("Could not apply some optimizations:", err);
          }
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        if (isAndroid) {
          videoRef.current.style.willChange = 'transform';
          videoRef.current.style.transform = 'translateZ(0)';
        }
      }

      setStream(newStream);
      cameraInitialized.current = true;
      
      if (onStreamReady) {
        onStreamReady(newStream);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error("Error starting camera:", err);
      }
    }
  };

  // Effects
  useEffect(() => {
    const initCamera = async () => {
      if (isMonitoring && !stream) {
        await startCamera();
      } else if (!isMonitoring && stream) {
        await stopCamera();
      }
    };

    initCamera().catch(error => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Error during camera initialization:', error);
      }
    });

    return () => {
      if (stream) {
        stopCamera().catch(console.error);
      }
    };
  }, [isMonitoring]);

  useEffect(() => {
    if (!stream || !deviceSupportsTorch || !isMonitoring) return;
    
    const keepTorchOn = async () => {
      if (!isMonitoring || !deviceSupportsTorch) return;

      const torchIsReallyOn = stream.getVideoTracks()[0].getSettings && (stream.getVideoTracks()[0].getSettings() as any).torch === true;

      if (!torchIsReallyOn) {
        try {
          await handleTorch(true);
        } catch (err) {
          torchAttempts.current++;
          setTorchEnabled(false);
        }
      } else {
        if (!torchEnabled) {
          setTorchEnabled(true);
        }
      }
    };
    
    const torchCheckInterval = setInterval(keepTorchOn, 2000);
    keepTorchOn();
    
    return () => {
      clearInterval(torchCheckInterval);
    };
  }, [stream, isMonitoring, deviceSupportsTorch, torchEnabled]);

  useEffect(() => {
    if (!stream || !isMonitoring || !deviceSupportsAutoFocus) return;
    
    const focusIntervalTime = isFingerDetected ? 4000 : 1500;
    
    const attemptRefocus = async () => {
      await handleAutoFocus();
    };
    
    attemptRefocus();
    
    const focusInterval = window.setInterval(attemptRefocus, focusIntervalTime);
    
    return () => {
      clearInterval(focusInterval);
    };
  }, [stream, isMonitoring, isFingerDetected, deviceSupportsAutoFocus]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className={`${styles.video} absolute top-0 left-0 min-w-full min-h-full w-auto h-auto z-0 object-cover`}
      }}
    />
  );
};

export default CameraView;