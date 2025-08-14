import { PPGSignalProcessor as OriginalPPGSignalProcessor } from './signal-processing/PPGSignalProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';

export class PPGSignalProcessor extends OriginalPPGSignalProcessor {
  private isInitialized: boolean = false;
  private isInitializing: boolean = false;
  private pendingFrames: ImageData[] = [];
  private callbacksInitialized: boolean = false;
  
  constructor(
    onSignalReady?: (signal: ProcessedSignal) => void,
    onError?: (error: ProcessingError) => void
  ) {
    // Configurar callbacks seguros
    const safeOnSignalReady = (signal: ProcessedSignal) => {
      console.log("[SIGNAL] Señal procesada recibida", { signal });
      onSignalReady?.(signal);
    };
    
    const safeOnError = (error: ProcessingError) => {
      console.error("[ERROR] Error en el procesador de señales:", error);
      onError?.(error);
    };
    
    // Llamar al constructor de la clase padre con los callbacks seguros
    super(safeOnSignalReady, safeOnError);
    
    console.log("[INIT] PPGSignalProcessor creado", {
      hasSignalReadyCallback: !!onSignalReady,
      hasErrorCallback: !!onError
    });
    
    // Inicialización diferida
    this.initialize().catch(err => {
      console.error("[ERROR] Error en inicialización automática:", err);
    });
  }
  
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing) return;
    
    this.isInitializing = true;
    console.log("[INIT] Inicializando procesador de señales...");
    
    try {
      // Asegurar que los callbacks estén configurados
      this.syncCallbacks();
      
      // Inicializar el procesador padre
      await super.initialize();
      
      this.isInitialized = true;
      console.log("[INIT] Procesador de señales inicializado correctamente");
      
      // Procesar frames en espera
      this.processPendingFrames();
      
    } catch (error) {
      console.error("[ERROR] Error al inicializar el procesador:", error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }
  
  private syncCallbacks() {
    // Sincronizar callbacks con la instancia padre
    if (this.onSignalReady && super.onSignalReady !== this.onSignalReady) {
      console.log("[DEBUG] Sincronizando callback onSignalReady");
      super.onSignalReady = this.onSignalReady;
    }
    
    if (this.onError && super.onError !== this.onError) {
      console.log("[DEBUG] Sincronizando callback onError");
      super.onError = this.onError;
    }
  }
  
  private processPendingFrames() {
    if (!this.isInitialized || this.pendingFrames.length === 0) return;
    
    console.log(`[DEBUG] Procesando ${this.pendingFrames.length} frames en espera`);
    
    while (this.pendingFrames.length > 0) {
      const frame = this.pendingFrames.shift();
      if (frame) {
        try {
          super.processFrame(frame);
        } catch (error) {
          console.error("[ERROR] Error al procesar frame en cola:", error);
        }
      }
    }
  }
  
  processFrame(imageData: ImageData): void {
    // Verificar si la imagen es válida
    if (!imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0) {
      console.warn("[WARN] Intento de procesar frame inválido");
      return;
    }
    
    // Sincronizar callbacks en cada frame para asegurar que estén actualizados
    this.syncCallbacks();
    
    // Si no está inicializado, encolar el frame
    if (!this.isInitialized) {
      console.log("[DEBUG] Procesador no inicializado, encolando frame");
      this.pendingFrames.push(imageData);
      
      // Iniciar inicialización si no está en proceso
      if (!this.isInitializing) {
        this.initialize().catch(error => {
          console.error("[ERROR] Error en inicialización diferida:", error);
        });
      }
      return;
    }
    
    // Procesar el frame
    try {
      super.processFrame(imageData);
    } catch (error) {
      console.error("[ERROR] Error al procesar frame:", error);
      
      // Intentar reiniciar el procesador en caso de error
      if (this.onError) {
        this.onError({
          code: "PROCESSOR_ERROR",
          message: "Error al procesar frame",
          timestamp: Date.now(),
          type: "PROCESSOR_ERROR",
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

// También re-exportamos los tipos
export * from './signal-processing/types';
