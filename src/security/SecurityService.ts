import * as CryptoJS from 'crypto-js';
import { Observable, of, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

export class SecurityService {
  private static instance: SecurityService;
  private encryptionKey: string | null = null;
  private readonly STORAGE_KEY = 'health_secure_storage';
  private readonly SALT = 'health_app_salt';
  private readonly PBKDF2_ITERATIONS = 10000;
  private readonly KEY_SIZE = 256 / 32; // 256 bits
  
  private constructor() {
    // Initialize with a default key (in production, this should be retrieved securely)
    this.initializeKey('default_secure_key');
  }

  public static getInstance(): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService();
    }
    return SecurityService.instance;
  }

  public initializeKey(key: string): void {
    if (!key) {
      throw new Error('Encryption key cannot be empty');
    }
    this.encryptionKey = this.deriveKey(key, this.SALT);
  }

  private deriveKey(password: string, salt: string): string {
    return CryptoJS.PBKDF2(password, salt, {
      keySize: this.KEY_SIZE,
      iterations: this.PBKDF2_ITERATIONS
    }).toString();
  }

  public encryptData<T>(data: T): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const serializedData = JSON.stringify(data);
    const encrypted = CryptoJS.AES.encrypt(
      serializedData,
      this.encryptionKey
    ).toString();

    return encrypted;
  }

  public decryptData<T>(encryptedData: string): T | null {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    try {
      const decrypted = CryptoJS.AES.decrypt(
        encryptedData,
        this.encryptionKey
      );
      
      const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
      
      if (!decryptedStr) {
        console.error('Failed to decrypt data: Invalid key or corrupted data');
        return null;
      }

      return JSON.parse(decryptedStr) as T;
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  }

  public encryptDataObservable<T>(data: T): Observable<string> {
    return of(data).pipe(
      map(data => this.encryptData(data)),
      catchError(error => {
        console.error('Encryption error:', error);
        throw new Error('Failed to encrypt data');
      })
    );
  }

  public decryptDataObservable<T>(encryptedData: string): Observable<T | null> {
    return of(encryptedData).pipe(
      map(encrypted => this.decryptData<T>(encrypted)),
      catchError(error => {
        console.error('Decryption error:', error);
        return of(null);
      })
    );
  }

  public async storeSecure<T>(key: string, data: T): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Secure storage is only available in browser environment');
    }

    const encryptedData = this.encryptData(data);
    const storage = await this.getSecureStorage();
    storage[key] = encryptedData;
    
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(storage));
  }

  public async retrieveSecure<T>(key: string): Promise<T | null> {
    if (typeof window === 'undefined') {
      throw new Error('Secure storage is only available in browser environment');
    }

    try {
      const storage = await this.getSecureStorage();
      const encryptedData = storage[key];
      
      if (!encryptedData) {
        return null;
      }

      return this.decryptData<T>(encryptedData);
    } catch (error) {
      console.error('Error retrieving secure data:', error);
      return null;
    }
  }

  public async clearSecureStorage(): Promise<void> {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  private async getSecureStorage(): Promise<Record<string, string>> {
    if (typeof window === 'undefined') {
      return {};
    }

    const storageData = localStorage.getItem(this.STORAGE_KEY);
    return storageData ? JSON.parse(storageData) : {};
  }

  public generateSecureRandomKey(length: number = 32): string {
    const array = new Uint8Array(length);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(array);
    } else {
      // Fallback for non-secure environments (testing, etc.)
      for (let i = 0; i < length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(array, byte => ('0' + byte.toString(16)).slice(-2)).join('');
  }

  public hashData(data: string): string {
    const hash = CryptoJS.SHA256(data).toString();
    return hash;
  }

  public async secureWipe(obj: any): Promise<void> {
    if (obj === null || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        await this.secureWipe(obj[i]);
        obj[i] = null;
      }
    } else {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          await this.secureWipe(obj[key]);
          obj[key] = null;
        }
      }
    }
  }
}

// Export a singleton instance
export const securityService = SecurityService.getInstance();

// Helper functions for common operations
export async function encryptAndStore<T>(key: string, data: T): Promise<void> {
  return securityService.storeSecure(key, data);
}

export async function retrieveAndDecrypt<T>(key: string): Promise<T | null> {
  return securityService.retrieveSecure<T>(key);
}

export function hashSensitiveData(data: string): string {
  return securityService.hashData(data);
}
