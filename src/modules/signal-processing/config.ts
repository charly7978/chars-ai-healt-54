/**
 * Configuración centralizada para el módulo PPG
 * Ajusta estos valores según el dispositivo y condiciones de iluminación
 */

export const PPG_CONFIG = {
  // Umbrales de detección de dedo (PPGChannel)
  FINGER_DETECTION: {
    MIN_RAW_SIGNAL: 5,        // Señal mínima (era 20)
    MIN_SNR: 1.5,             // SNR mínimo (era 3)
    MIN_QUALITY: 15,          // Calidad mínima (nuevo)
    MIN_CRITERIA_PASSED: 2,   // Criterios mínimos que deben pasar (de 4 total)
  },

  // Umbrales del MultiChannelManager
  MULTI_CHANNEL: {
    COVERAGE_RATIO_MIN: 0.15, // % mínimo de píxeles cubiertos (era 0.35)
    FRAME_DIFF_MAX: 15,       // Diferencia máxima entre frames (era 8)
    CHANNEL_CONSENSUS_MIN: 0.33, // % mínimo de canales que deben detectar (era 0.5)
  },

  // Configuración de canales
  CHANNELS: {
    COUNT: 6,                  // Número de canales
    WINDOW_SEC: 8,            // Ventana temporal en segundos
    INITIAL_GAIN_VARIATION: 0.03, // Variación inicial de gain entre canales
  },

  // Configuración de procesamiento
  PROCESSING: {
    RESAMPLE_SIZE: 256,       // Tamaño del resampling
    BANDPASS_CENTER: 1.3,     // Frecuencia central del filtro (Hz)
    BANDPASS_Q: 0.6,          // Factor Q del filtro
    FREQ_RANGE: [0.7, 3.5],  // Rango de frecuencias para análisis
    FREQ_RESOLUTION: 120,     // Resolución del análisis de frecuencias
  },

  // Configuración de debounce
  DEBOUNCE: {
    ENABLE_FRAMES: 6,         // Frames consecutivos para confirmar dedo
    DISABLE_FRAMES: 6,        // Frames consecutivos para desconfirmar dedo
  },

  // Configuración de feedback adaptativo
  ADAPTIVE_FEEDBACK: {
    GAIN_INCREASE: 0.02,      // Incremento de gain (+2%)
    GAIN_DECREASE: 0.03,      // Decremento de gain (-3%)
    MIN_GAIN: 0.1,            // Gain mínimo
    MAX_GAIN: 10,             // Gain máximo
  }
};

// Función helper para obtener configuración
export function getConfig() {
  return PPG_CONFIG;
}

// Función para actualizar configuración en tiempo real
export function updateConfig(newConfig: Partial<typeof PPG_CONFIG>) {
  Object.assign(PPG_CONFIG, newConfig);
  console.log('[PPG] Configuración actualizada:', PPG_CONFIG);
}
