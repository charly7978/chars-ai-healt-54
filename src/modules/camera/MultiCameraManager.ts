/**
 * Gestor de múltiples cámaras traseras para Android usando Camera API2
 * Captura simultánea de señales PPG para máxima precisión y robustez
 */

interface CameraDevice {
  id: string;
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
  capabilities: MediaTrackCapabilities | null;
  isActive: boolean;
  quality: number;
}

interface PPGSignalData {
  cameraId: string;
  timestamp: number;
  redChannel: number;
  greenChannel: number;
  irChannel: number;
  quality: number;
}

export class MultiCameraManager {
  private cameras: Map<string, CameraDevice> = new Map();
  private activeCameras: string[] = [];
  private signalProcessor: ((signals: PPGSignalData[]) => void) | null = null;
  private isCapturing = false;
  private frameProcessors: Map<string, number> = new Map();

  constructor() {
    console.log('MultiCameraManager: Inicializando gestor de múltiples cámaras');
  }

  /**
   * Detecta y enumera todas las cámaras traseras disponibles
   */
  async detectBackCameras(): Promise<string[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      const backCameras: string[] = [];
      
      for (const device of videoDevices) {
        // Detectar cámaras traseras por etiqueta o ID
        const isBackCamera = device.label.toLowerCase().includes('back') ||
                            device.label.toLowerCase().includes('rear') ||
                            device.label.toLowerCase().includes('trasera') ||
                            device.deviceId.includes('back');
        
        if (isBackCamera || !device.label) {
          // Verificar si la cámara soporta torch (flash)
          try {
            const stream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: device.deviceId }
            });
            
            const track = stream.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            
            if (capabilities.torch) {
              backCameras.push(device.deviceId);
              console.log(`Cámara trasera detectada: ${device.deviceId} - ${device.label}`);
            }
            
            track.stop();
          } catch (error) {
            console.warn(`Error verificando cámara ${device.deviceId}:`, error);
          }
        }
      }
      
      return backCameras;
    } catch (error) {
      console.error('Error detectando cámaras traseras:', error);
      return [];
    }
  }

  /**
   * Inicializa múltiples cámaras traseras simultáneamente
   */
  async initializeMultipleCameras(): Promise<boolean> {
    try {
      const backCameraIds = await this.detectBackCameras();
      
      if (backCameraIds.length === 0) {
        console.warn('No se encontraron cámaras traseras compatibles');
        return false;
      }

      console.log(`Inicializando ${backCameraIds.length} cámaras traseras`);

      // Inicializar cada cámara
      const initPromises = backCameraIds.map(async (cameraId) => {
        return this.initializeCamera(cameraId);
      });

      const results = await Promise.allSettled(initPromises);
      
      // Contar cámaras inicializadas exitosamente
      let successCount = 0;
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          this.activeCameras.push(backCameraIds[index]);
          successCount++;
        }
      });

      console.log(`${successCount} de ${backCameraIds.length} cámaras inicializadas correctamente`);
      return successCount > 0;

    } catch (error) {
      console.error('Error inicializando múltiples cámaras:', error);
      return false;
    }
  }

  /**
   * Inicializa una cámara individual con configuración optimizada para PPG
   */
  private async initializeCamera(cameraId: string): Promise<boolean> {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: { exact: cameraId },
          width: { ideal: 1920, max: 1920 },
          height: { ideal: 1080, max: 1080 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'environment'
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();

      // Configurar parámetros optimizados para PPG
      const advancedConstraints: MediaTrackConstraintSet[] = [];

      if (capabilities.torch) {
        advancedConstraints.push({ torch: true });
      }

      if (capabilities.exposureMode) {
        advancedConstraints.push({ exposureMode: 'manual' });
        if (capabilities.exposureTime) {
          const maxExposure = capabilities.exposureTime.max || 1000;
          advancedConstraints.push({ exposureTime: maxExposure * 0.8 });
        }
      }

      if (capabilities.focusMode) {
        advancedConstraints.push({ focusMode: 'continuous' });
      }

      if (capabilities.whiteBalanceMode) {
        advancedConstraints.push({ whiteBalanceMode: 'continuous' });
      }

      // Aplicar configuraciones avanzadas
      if (advancedConstraints.length > 0) {
        await track.applyConstraints({ advanced: advancedConstraints });
      }

      // Crear objeto de cámara
      const camera: CameraDevice = {
        id: cameraId,
        stream,
        track,
        capabilities,
        isActive: true,
        quality: 0
      };

      this.cameras.set(cameraId, camera);
      console.log(`Cámara ${cameraId} inicializada correctamente`);
      return true;

    } catch (error) {
      console.error(`Error inicializando cámara ${cameraId}:`, error);
      return false;
    }
  }

  /**
   * Inicia la captura simultánea de señales PPG de todas las cámaras
   */
  async startMultiCameraCapture(onSignalReady: (signals: PPGSignalData[]) => void): Promise<void> {
    if (this.isCapturing) {
      console.warn('La captura ya está en progreso');
      return;
    }

    this.signalProcessor = onSignalReady;
    this.isCapturing = true;

    console.log(`Iniciando captura simultánea en ${this.activeCameras.length} cámaras`);

    // Iniciar procesamiento para cada cámara activa
    for (const cameraId of this.activeCameras) {
      this.startCameraProcessing(cameraId);
    }
  }

  /**
   * Inicia el procesamiento de frames para una cámara específica
   */
  private startCameraProcessing(cameraId: string): void {
    const camera = this.cameras.get(cameraId);
    if (!camera || !camera.stream) return;

    const video = document.createElement('video');
    video.srcObject = camera.stream;
    video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const processFrame = () => {
      if (!this.isCapturing || !camera.isActive) return;

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        ctx?.drawImage(video, 0, 0);
        const imageData = ctx?.getImageData(0, 0, canvas.width, canvas.height);

        if (imageData) {
          const signalData = this.extractPPGSignal(cameraId, imageData);
          this.processCameraSignal(signalData);
        }
      }

      const frameId = requestAnimationFrame(processFrame);
      this.frameProcessors.set(cameraId, frameId);
    };

    processFrame();
  }

  /**
   * Extrae señales PPG de los datos de imagen
   */
  private extractPPGSignal(cameraId: string, imageData: ImageData): PPGSignalData {
    const { data, width, height } = imageData;
    const pixelCount = width * height;

    let redSum = 0, greenSum = 0, blueSum = 0;
    let validPixels = 0;

    // Procesar región central (donde debería estar el dedo)
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const regionSize = Math.min(width, height) * 0.3;

    for (let y = centerY - regionSize/2; y < centerY + regionSize/2; y++) {
      for (let x = centerX - regionSize/2; x < centerX + regionSize/2; x++) {
        if (x >= 0 && x < width && y >= 0 && y < height) {
          const index = (y * width + x) * 4;
          const red = data[index];
          const green = data[index + 1];
          const blue = data[index + 2];

          // Filtrar píxeles con suficiente intensidad (dedo presente)
          if (red > 50 && green > 50 && blue > 50) {
            redSum += red;
            greenSum += green;
            blueSum += blue;
            validPixels++;
          }
        }
      }
    }

    const avgRed = validPixels > 0 ? redSum / validPixels : 0;
    const avgGreen = validPixels > 0 ? greenSum / validPixels : 0;
    const avgBlue = validPixels > 0 ? blueSum / validPixels : 0;

    // Calcular calidad de señal basada en la cobertura del dedo
    const quality = Math.min(100, (validPixels / (regionSize * regionSize)) * 100);

    return {
      cameraId,
      timestamp: Date.now(),
      redChannel: avgRed,
      greenChannel: avgGreen,
      irChannel: avgBlue, // Usar canal azul como aproximación IR
      quality
    };
  }

  /**
   * Procesa señales de múltiples cámaras y las combina
   */
  private signalBuffer: Map<string, PPGSignalData[]> = new Map();
  private readonly BUFFER_SIZE = 5;

  private processCameraSignal(signal: PPGSignalData): void {
    // Agregar señal al buffer de la cámara
    if (!this.signalBuffer.has(signal.cameraId)) {
      this.signalBuffer.set(signal.cameraId, []);
    }

    const buffer = this.signalBuffer.get(signal.cameraId)!;
    buffer.push(signal);

    if (buffer.length > this.BUFFER_SIZE) {
      buffer.shift();
    }

    // Actualizar calidad de la cámara
    const camera = this.cameras.get(signal.cameraId);
    if (camera) {
      camera.quality = signal.quality;
    }

    // Combinar señales de todas las cámaras activas
    this.combineMultiCameraSignals();
  }

  /**
   * Combina señales de múltiples cámaras para mayor precisión
   */
  private combineMultiCameraSignals(): void {
    if (!this.signalProcessor) return;

    const combinedSignals: PPGSignalData[] = [];
    const now = Date.now();

    // Obtener la señal más reciente de cada cámara
    for (const cameraId of this.activeCameras) {
      const buffer = this.signalBuffer.get(cameraId);
      if (buffer && buffer.length > 0) {
        const latestSignal = buffer[buffer.length - 1];
        
        // Solo incluir señales recientes (últimos 100ms)
        if (now - latestSignal.timestamp < 100) {
          combinedSignals.push(latestSignal);
        }
      }
    }

    // Enviar señales combinadas al procesador
    if (combinedSignals.length > 0) {
      this.signalProcessor(combinedSignals);
    }
  }

  /**
   * Detiene la captura de todas las cámaras
   */
  async stopMultiCameraCapture(): Promise<void> {
    console.log('Deteniendo captura de múltiples cámaras');
    
    this.isCapturing = false;
    this.signalProcessor = null;

    // Detener procesadores de frames
    for (const [cameraId, frameId] of this.frameProcessors) {
      cancelAnimationFrame(frameId);
    }
    this.frameProcessors.clear();

    // Detener streams de cámaras
    for (const [cameraId, camera] of this.cameras) {
      if (camera.track) {
        // Apagar flash antes de detener
        try {
          await camera.track.applyConstraints({
            advanced: [{ torch: false }]
          });
        } catch (error) {
          console.warn(`Error apagando flash de cámara ${cameraId}:`, error);
        }
        
        camera.track.stop();
      }
      camera.isActive = false;
    }

    this.cameras.clear();
    this.activeCameras = [];
    this.signalBuffer.clear();
  }

  /**
   * Obtiene estadísticas de las cámaras activas
   */
  getCameraStats(): { cameraId: string; quality: number; isActive: boolean }[] {
    return Array.from(this.cameras.entries()).map(([id, camera]) => ({
      cameraId: id,
      quality: camera.quality,
      isActive: camera.isActive
    }));
  }

  /**
   * Obtiene el número de cámaras activas
   */
  getActiveCameraCount(): number {
    return this.activeCameras.length;
  }
}