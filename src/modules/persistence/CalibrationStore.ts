/**
 * CALIBRATION STORE
 * 
 * Persistencia segura de perfiles de calibración usando IndexedDB
 * 
 * Funcionalidades:
 * - Almacenamiento de perfiles de calibración dark/white
 * - Gestión de calibraciones SpO₂, presión, glucosa, lípidos
 * - Sincronización con backend si está disponible
 * - Validación de datos de calibración
 * - Recuperación ante errores
 * - Exportación/Importación de perfiles
 */

export interface DarkWhiteCalibration {
  id: string;
  timestamp: number;
  deviceId: string;
  darkOffset: { r: number; g: number; b: number };
  whiteReference: { r: number; g: number; b: number };
  quality: number; // 0..1
  temperature: number; // °C
  ambientLight: number; // lux
  isValid: boolean;
}

export interface SpO2Calibration {
  id: string;
  timestamp: number;
  deviceId: string;
  samples: Array<{
    reference: number; // SpO₂ real del oxímetro
    estimated: number; // SpO₂ estimado por cámara
    ratioRedIR: number; // R/(R+IR) o similar
    quality: number;
    timestamp: number;
  }>;
  regressionCoefficients: {
    slope: number;
    intercept: number;
    r2: number;
    rmse: number;
  };
  validRange: { min: number; max: number };
  isValid: boolean;
}

export interface BloodPressureCalibration {
  id: string;
  timestamp: number;
  deviceId: string;
  samples: Array<{
    reference: { systolic: number; diastolic: number };
    estimated: { systolic: number; diastolic: number };
    pulseWaveform: number[];
    features: {
      augmentationIndex: number;
      stiffnessIndex: number;
      reflectionIndex: number;
    };
    quality: number;
    timestamp: number;
  }>;
  regressionCoefficients: {
    systolic: { slope: number; intercept: number; r2: number; rmse: number };
    diastolic: { slope: number; intercept: number; r2: number; rmse: number };
  };
  isValid: boolean;
}

export interface GlucoseCalibration {
  id: string;
  timestamp: number;
  deviceId: string;
  samples: Array<{
    reference: number; // mg/dL del glucómetro
    estimated: number; // Estimado por cámara
    spectralFeatures: {
      absorptionPeaks: number[];
      scatteringCoefficients: number[];
      waterContent: number;
    };
    quality: number;
    timestamp: number;
  }>;
  regressionCoefficients: {
    slope: number;
    intercept: number;
    r2: number;
    rmse: number;
  };
  validRange: { min: number; max: number };
  isValid: boolean;
}

export interface LipidsCalibration {
  id: string;
  timestamp: number;
  deviceId: string;
  samples: Array<{
    reference: {
      cholesterol: number;
      triglycerides: number;
      ldl: number;
      hdl: number;
    };
    estimated: {
      cholesterol: number;
      triglycerides: number;
      ldl: number;
      hdl: number;
    };
    spectralSignature: number[];
    quality: number;
    timestamp: number;
  }>;
  regressionCoefficients: {
    cholesterol: { slope: number; intercept: number; r2: number; rmse: number };
    triglycerides: { slope: number; intercept: number; r2: number; rmse: number };
    ldl: { slope: number; intercept: number; r2: number; rmse: number };
    hdl: { slope: number; intercept: number; r2: number; rmse: number };
  };
  isValid: boolean;
}

export interface CalibrationProfile {
  id: string;
  userId?: string;
  deviceId: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  description?: string;
  darkWhite: DarkWhiteCalibration | null;
  spo2: SpO2Calibration | null;
  bloodPressure: BloodPressureCalibration | null;
  glucose: GlucoseCalibration | null;
  lipids: LipidsCalibration | null;
  isActive: boolean;
  isDefault: boolean;
}

export interface CalibrationStoreConfig {
  dbName: string;
  dbVersion: number;
  maxProfiles: number;
  autoBackup: boolean;
  syncEnabled: boolean;
  retentionDays: number;
}

const DEFAULT_CONFIG: CalibrationStoreConfig = {
  dbName: 'CharsHealthCalibration',
  dbVersion: 1,
  maxProfiles: 10,
  autoBackup: true,
  syncEnabled: false,
  retentionDays: 365,
};

export class CalibrationStore {
  private config: CalibrationStoreConfig;
  private db: IDBDatabase | null = null;
  private readonly STORE_NAME = 'calibration_profiles';

  constructor(config: Partial<CalibrationStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Inicializar la base de datos IndexedDB
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.dbVersion);

      request.onerror = () => {
        reject(new Error(`Error opening database: ${request.error}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('CalibrationStore initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          
          // Crear índices para búsquedas eficientes
          store.createIndex('deviceId', 'deviceId', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('isActive', 'isActive', { unique: false });
          store.createIndex('isDefault', 'isDefault', { unique: false });
        }
      };
    });
  }

  /**
   * Guardar un perfil de calibración completo
   */
  async saveProfile(profile: CalibrationProfile): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Validar perfil
    this.validateProfile(profile);

    // Actualizar timestamp
    profile.updatedAt = Date.now();

    // Si es el perfil activo, desactivar los demás
    if (profile.isActive) {
      await this.deactivateAllProfiles(profile.deviceId);
    }

    // Si es el perfil por defecto, quitar el defecto a los demás
    if (profile.isDefault) {
      await this.undefaultAllProfiles(profile.deviceId);
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(profile);

      request.onerror = () => {
        reject(new Error(`Error saving profile: ${request.error}`));
      };

      request.onsuccess = () => {
        console.log(`Calibration profile saved: ${profile.id}`);
        resolve(profile.id);
      };
    });
  }

  /**
   * Obtener un perfil por ID
   */
  async getProfile(id: string): Promise<CalibrationProfile | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.get(id);

      request.onerror = () => {
        reject(new Error(`Error getting profile: ${request.error}`));
      };

      request.onsuccess = () => {
        resolve(request.result || null);
      };
    });
  }

  /**
   * Obtener el perfil activo para un dispositivo
   */
  async getActiveProfile(deviceId: string): Promise<CalibrationProfile | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('deviceId');
      const request = index.openCursor(IDBKeyRange.only(deviceId));

      let activeProfile: CalibrationProfile | null = null;

      request.onerror = () => {
        reject(new Error(`Error getting active profile: ${request.error}`));
      };

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor) {
          const profile = cursor.value as CalibrationProfile;
          if (profile.isActive) {
            activeProfile = profile;
          }
          cursor.continue();
        } else {
          resolve(activeProfile);
        }
      };
    });
  }

  /**
   * Obtener el perfil por defecto para un dispositivo
   */
  async getDefaultProfile(deviceId: string): Promise<CalibrationProfile | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('deviceId');
      const request = index.openCursor(IDBKeyRange.only(deviceId));

      let defaultProfile: CalibrationProfile | null = null;

      request.onerror = () => {
        reject(new Error(`Error getting default profile: ${request.error}`));
      };

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor) {
          const profile = cursor.value as CalibrationProfile;
          if (profile.isDefault) {
            defaultProfile = profile;
          }
          cursor.continue();
        } else {
          resolve(defaultProfile);
        }
      };
    });
  }

  /**
   * Listar todos los perfiles para un dispositivo
   */
  async listProfiles(deviceId: string): Promise<CalibrationProfile[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('deviceId');
      const request = index.getAll(IDBKeyRange.only(deviceId));

      request.onerror = () => {
        reject(new Error(`Error listing profiles: ${request.error}`));
      };

      request.onsuccess = () => {
        const profiles = request.result as CalibrationProfile[];
        // Ordenar por fecha de actualización descendente
        profiles.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(profiles);
      };
    });
  }

  /**
   * Eliminar un perfil
   */
  async deleteProfile(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => {
        reject(new Error(`Error deleting profile: ${request.error}`));
      };

      request.onsuccess = () => {
        console.log(`Calibration profile deleted: ${id}`);
        resolve();
      };
    });
  }

  /**
   * Activar un perfil (desactiva los demás)
   */
  async activateProfile(id: string): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    await this.deactivateAllProfiles(profile.deviceId);
    profile.isActive = true;
    profile.updatedAt = Date.now();
    await this.saveProfile(profile);
  }

  /**
   * Establecer un perfil como por defecto
   */
  async setDefaultProfile(id: string): Promise<void> {
    const profile = await this.getProfile(id);
    if (!profile) {
      throw new Error(`Profile not found: ${id}`);
    }

    await this.undefaultAllProfiles(profile.deviceId);
    profile.isDefault = true;
    profile.updatedAt = Date.now();
    await this.saveProfile(profile);
  }

  /**
   * Exportar perfiles a JSON
   */
  async exportProfiles(deviceId?: string): Promise<string> {
    const profiles = deviceId ? 
      await this.listProfiles(deviceId) : 
      await this.listAllProfiles();

    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      deviceId: deviceId || 'all',
      profiles: profiles,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Importar perfiles desde JSON
   */
  async importProfiles(jsonData: string, replaceExisting = false): Promise<string[]> {
    try {
      const importData = JSON.parse(jsonData);
      
      if (!importData.profiles || !Array.isArray(importData.profiles)) {
        throw new Error('Invalid import data format');
      }

      const importedIds: string[] = [];

      for (const profileData of importData.profiles) {
        // Validar perfil
        this.validateProfile(profileData);

        // Generar nuevo ID para evitar conflictos
        const profile: CalibrationProfile = {
          ...profileData,
          id: this.generateId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        if (replaceExisting) {
          await this.saveProfile(profile);
        } else {
          // Verificar si ya existe un perfil con el mismo nombre
          const existing = await this.findProfileByName(profile.name, profile.deviceId);
          if (!existing) {
            await this.saveProfile(profile);
          }
        }

        importedIds.push(profile.id);
      }

      console.log(`Imported ${importedIds.length} calibration profiles`);
      return importedIds;
    } catch (error) {
      throw new Error(`Error importing profiles: ${error}`);
    }
  }

  /**
   * Limpiar perfiles antiguos
   */
  async cleanupOldProfiles(): Promise<number> {
    const cutoffTime = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
    const allProfiles = await this.listAllProfiles();
    
    const oldProfiles = allProfiles.filter(p => p.createdAt < cutoffTime && !p.isDefault);
    let deletedCount = 0;

    for (const profile of oldProfiles) {
      await this.deleteProfile(profile.id);
      deletedCount++;
    }

    console.log(`Cleaned up ${deletedCount} old calibration profiles`);
    return deletedCount;
  }

  /**
   * Métodos privados
   */

  private validateProfile(profile: CalibrationProfile): void {
    if (!profile.id || !profile.deviceId || !profile.name) {
      throw new Error('Profile must have id, deviceId, and name');
    }

    if (profile.darkWhite && !this.isValidDarkWhiteCalibration(profile.darkWhite)) {
      throw new Error('Invalid dark/white calibration data');
    }

    if (profile.spo2 && !this.isValidSpO2Calibration(profile.spo2)) {
      throw new Error('Invalid SpO2 calibration data');
    }

    if (profile.bloodPressure && !this.isValidBloodPressureCalibration(profile.bloodPressure)) {
      throw new Error('Invalid blood pressure calibration data');
    }

    if (profile.glucose && !this.isValidGlucoseCalibration(profile.glucose)) {
      throw new Error('Invalid glucose calibration data');
    }

    if (profile.lipids && !this.isValidLipidsCalibration(profile.lipids)) {
      throw new Error('Invalid lipids calibration data');
    }
  }

  private isValidDarkWhiteCalibration(cal: DarkWhiteCalibration): boolean {
    return cal.quality >= 0 && cal.quality <= 1 &&
           cal.samples >= 10 &&
           cal.isValid;
  }

  private isValidSpO2Calibration(cal: SpO2Calibration): boolean {
    return cal.samples.length >= 10 &&
           cal.samples.every(s => s.reference >= 70 && s.reference <= 100) &&
           cal.regressionCoefficients.r2 >= 0.8 &&
           cal.isValid;
  }

  private isValidBloodPressureCalibration(cal: BloodPressureCalibration): boolean {
    return cal.samples.length >= 10 &&
           cal.samples.every(s => 
             s.reference.systolic >= 60 && s.reference.systolic <= 250 &&
             s.reference.diastolic >= 30 && s.reference.diastolic <= 150
           ) &&
           cal.regressionCoefficients.systolic.r2 >= 0.7 &&
           cal.regressionCoefficients.diastolic.r2 >= 0.7 &&
           cal.isValid;
  }

  private isValidGlucoseCalibration(cal: GlucoseCalibration): boolean {
    return cal.samples.length >= 15 &&
           cal.samples.every(s => s.reference >= 50 && s.reference <= 400) &&
           cal.regressionCoefficients.r2 >= 0.8 &&
           cal.isValid;
  }

  private isValidLipidsCalibration(cal: LipidsCalibration): boolean {
    return cal.samples.length >= 15 &&
           cal.samples.every(s => 
             s.reference.cholesterol >= 100 && s.reference.cholesterol <= 400 &&
             s.reference.triglycerides >= 30 && s.reference.triglycerides <= 500
           ) &&
           cal.regressionCoefficients.cholesterol.r2 >= 0.7 &&
           cal.isValid;
  }

  private async deactivateAllProfiles(deviceId: string): Promise<void> {
    const profiles = await this.listProfiles(deviceId);
    
    for (const profile of profiles) {
      if (profile.isActive) {
        profile.isActive = false;
        profile.updatedAt = Date.now();
        await this.saveProfile(profile);
      }
    }
  }

  private async undefaultAllProfiles(deviceId: string): Promise<void> {
    const profiles = await this.listProfiles(deviceId);
    
    for (const profile of profiles) {
      if (profile.isDefault) {
        profile.isDefault = false;
        profile.updatedAt = Date.now();
        await this.saveProfile(profile);
      }
    }
  }

  private async listAllProfiles(): Promise<CalibrationProfile[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.getAll();

      request.onerror = () => {
        reject(new Error(`Error listing all profiles: ${request.error}`));
      };

      request.onsuccess = () => {
        const profiles = request.result as CalibrationProfile[];
        profiles.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(profiles);
      };
    });
  }

  private async findProfileByName(name: string, deviceId: string): Promise<CalibrationProfile | null> {
    const profiles = await this.listProfiles(deviceId);
    return profiles.find(p => p.name === name) || null;
  }

  private generateId(): string {
    return `cal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cerrar la base de datos
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('CalibrationStore closed');
    }
  }
}

export default CalibrationStore;
