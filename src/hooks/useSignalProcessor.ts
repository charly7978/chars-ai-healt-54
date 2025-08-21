
import { useState, useEffect, useCallback, useRef } from 'react';
import { PPGSignalProcessor } from '../modules/signal-processing/PPGSignalProcessor';
import { ProcessedSignal, ProcessingError } from '../types/signal';

/**
 * HOOK COMPLETAMENTE UNIFICADO DE PROCESAMIENTO PPG - ELIMINADAS TODAS LAS DUPLICIDADES
 * Sistema matemático avanzado con control de estado unificado y prevención de múltiples instancias
 */
export const useSignalProcessor = () => {
  const processorRef = useRef<PPGSignalProcessor | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSignal, setLastSignal] = useState<ProcessedSignal | null>(null);
  const [error, setError] = useState<ProcessingError | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  
  // CONTROL UNIFICADO DE ESTADO PARA PREVENIR DUPLICIDADES
  const processingStateRef = useRef<'IDLE' | 'STARTING' | 'ACTIVE' | 'STOPPING'>('IDLE');
  const sessionIdRef = useRef<string>("");
  const errorCountRef = useRef(0);
  const lastErrorTimeRef = useRef(0);
  const frameCounterRef = useRef(0);

  // INICIALIZACIÓN UNIFICADA DEL PROCESADOR - UNA SOLA VEZ
  useEffect(() => {
    // GENERAR SESSION ID ÚNICO PARA PREVENIR CONFLICTOS
    const randomBytes = new Uint32Array(2);
    crypto.getRandomValues(randomBytes);
    sessionIdRef.current = `processor_${randomBytes[0].toString(36)}_${randomBytes[1].toString(36)}`;

    console.log(`🔬 CREANDO PROCESADOR UNIFICADO - ${sessionIdRef.current}`);

    // CALLBACKS OPTIMIZADOS SIN ACUMULACIONES DE MEMORIA
    const onSignalReady = (signal: ProcessedSignal) => {
      if (processingStateRef.current !== 'ACTIVE') return;
      
      setLastSignal(signal);
      setError(null);
      
      frameCounterRef.current++;
      setFramesProcessed(prev => {
        // RESETEAR CONTADOR CADA 1000 FRAMES PARA EVITAR OVERFLOW
        return frameCounterRef.current >= 1000 ? 1 : frameCounterRef.current;
      });
      
      if (frameCounterRef.current >= 1000) {
        frameCounterRef.current = 0;
      }
    };

    const onError = (error: ProcessingError) => {
      const currentTime = Date.now();
      
      // RATE LIMITING AVANZADO PARA PREVENIR SPAM DE ERRORES
      if (currentTime - lastErrorTimeRef.current < 2000) {
        errorCountRef.current++;
        if (errorCountRef.current > 10) {
          console.warn(`⚠️ Demasiados errores, pausando logging - ${sessionIdRef.current}`);
          return;
        }
      } else {
        errorCountRef.current = 1;
      }
      
      lastErrorTimeRef.current = currentTime;
      setError(error);
      console.error(`❌ Error en procesador: ${error.code} - ${error.message} - ${sessionIdRef.current}`);
    };

    // CREAR PROCESADOR ÚNICO
    processorRef.current = new PPGSignalProcessor(onSignalReady, onError);
    
    return () => {
      console.log(`🔬 DESTRUYENDO PROCESADOR - ${sessionIdRef.current}`);
      if (processorRef.current) {
        processorRef.current.stop();
        processorRef.current = null;
      }
      processingStateRef.current = 'IDLE';
    };
  }, []);

  // FUNCIÓN UNIFICADA DE INICIO - PREVIENE MÚLTIPLES INICIALIZACIONES
  const startProcessing = useCallback(() => {
    if (!processorRef.current) {
      console.error(`❌ Procesador no disponible - ${sessionIdRef.current}`);
      return;
    }

    if (processingStateRef.current !== 'IDLE') {
      console.warn(`⚠️ Inicio bloqueado - Estado: ${processingStateRef.current} - ${sessionIdRef.current}`);
      return;
    }

    console.log(`🚀 INICIANDO PROCESAMIENTO UNIFICADO - ${sessionIdRef.current}`);
    
    processingStateRef.current = 'STARTING';
    setIsProcessing(true);
    setFramesProcessed(0);
    frameCounterRef.current = 0;
    errorCountRef.current = 0;
    lastErrorTimeRef.current = 0;
    
    processorRef.current.start();
    processingStateRef.current = 'ACTIVE';
    
    console.log(`✅ Procesamiento iniciado - ${sessionIdRef.current}`);
  }, []);

  // FUNCIÓN UNIFICADA DE PARADA - LIMPIA COMPLETAMENTE EL ESTADO
  const stopProcessing = useCallback(() => {
    if (!processorRef.current) return;

    if (processingStateRef.current === 'STOPPING' || processingStateRef.current === 'IDLE') {
      console.log(`⚠️ Ya detenido o deteniéndose - ${sessionIdRef.current}`);
      return;
    }

    console.log(`🛑 DETENIENDO PROCESAMIENTO UNIFICADO - ${sessionIdRef.current}`);
    
    processingStateRef.current = 'STOPPING';
    setIsProcessing(false);
    processorRef.current.stop();
    processingStateRef.current = 'IDLE';
    
    console.log(`✅ Procesamiento detenido - ${sessionIdRef.current}`);
  }, []);

  // CALIBRACIÓN UNIFICADA
  const calibrate = useCallback(async () => {
    if (!processorRef.current) {
      console.error(`❌ Procesador no disponible para calibración - ${sessionIdRef.current}`);
      return false;
    }

    try {
      console.log(`🎯 INICIANDO CALIBRACIÓN UNIFICADA - ${sessionIdRef.current}`);
      const success = await processorRef.current.calibrate();
      console.log(`${success ? '✅' : '❌'} Calibración ${success ? 'exitosa' : 'falló'} - ${sessionIdRef.current}`);
      return success;
    } catch (error) {
      console.error(`❌ Error en calibración: ${error} - ${sessionIdRef.current}`);
      return false;
    }
  }, []);

  // PROCESAMIENTO DE FRAME UNIFICADO CON VALIDACIONES
  const processFrame = useCallback((imageData: ImageData) => {
    if (!processorRef.current) {
      console.warn(`⚠️ Procesador no disponible para frame - ${sessionIdRef.current}`);
      return;
    }
    
    if (processingStateRef.current !== 'ACTIVE') {
      console.warn(`⚠️ Procesamiento no activo para frame - Estado: ${processingStateRef.current} - ${sessionIdRef.current}`);
      return;
    }
    
    try {
      processorRef.current.processFrame(imageData);
    } catch (error) {
      console.error(`❌ Error procesando frame: ${error} - ${sessionIdRef.current}`);
    }
  }, []);

  // RETORNO UNIFICADO DEL HOOK
  return {
    isProcessing,
    lastSignal,
    error,
    framesProcessed,
    startProcessing,
    stopProcessing,
    calibrate,
    processFrame,
    // DEBUG INFO
    debugInfo: {
      sessionId: sessionIdRef.current,
      processingState: processingStateRef.current,
      errorCount: errorCountRef.current
    }
  };
};
