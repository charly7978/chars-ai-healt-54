export class BufferManager {
  private static instance: BufferManager;
  private buffers: Map<string, ArrayBuffer | SharedArrayBuffer> = new Map();
  
  private constructor() {}
  
  public static getInstance(): BufferManager {
    if (!BufferManager.instance) {
      BufferManager.instance = new BufferManager();
    }
    return BufferManager.instance;
  }
  
  /**
   * Creates a new shared buffer with the specified size and type
   */
  public createBuffer(
    name: string, 
    size: number, 
    type: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64' = 'float32',
    shared: boolean = true
  ): TypedArray {
    if (this.buffers.has(name)) {
      throw new Error(`Buffer with name '${name}' already exists`);
    }
    
    const byteLength = this.getBytesPerElement(type) * size;
    const buffer = shared ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength);
    this.buffers.set(name, buffer);
    
    return this.getTypedArray(name, type);
  }
  
  /**
   * Gets an existing buffer or creates a new one if it doesn't exist
   */
  public getOrCreateBuffer(
    name: string, 
    size: number, 
    type: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64' = 'float32',
    shared: boolean = true
  ): TypedArray {
    try {
      return this.getTypedArray(name, type);
    } catch (e) {
      return this.createBuffer(name, size, type, shared);
    }
  }
  
  /**
   * Gets a typed array view of an existing buffer
   */
  public getTypedArray(
    name: string, 
    type: 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32' | 'float64' = 'float32'
  ): TypedArray {
    const buffer = this.buffers.get(name);
    if (!buffer) {
      throw new Error(`Buffer '${name}' not found`);
    }
    
    switch (type) {
      case 'int8': return new Int8Array(buffer);
      case 'uint8': return new Uint8Array(buffer);
      case 'int16': return new Int16Array(buffer);
      case 'uint16': return new Uint16Array(buffer);
      case 'int32': return new Int32Array(buffer);
      case 'uint32': return new Uint32Array(buffer);
      case 'float32': return new Float32Array(buffer);
      case 'float64': return new Float64Array(buffer);
      default: throw new Error(`Unsupported buffer type: ${type}`);
    }
  }
  
  /**
   * Releases a buffer and frees its memory
   */
  public releaseBuffer(name: string): void {
    this.buffers.delete(name);
  }
  
  /**
   * Gets the size of a buffer in elements
   */
  public getBufferSize(name: string): number | null {
    const buffer = this.buffers.get(name);
    if (!buffer) return null;
    
    // This is a simplified implementation - in reality, you'd need to track the type
    return buffer.byteLength / 4; // Assuming Float32 by default
  }
  
  /**
   * Gets the memory usage of all buffers in bytes
   */
  public getTotalMemoryUsage(): number {
    let total = 0;
    for (const buffer of this.buffers.values()) {
      total += buffer.byteLength;
    }
    return total;
  }
  
  private getBytesPerElement(type: string): number {
    switch (type) {
      case 'int8':
      case 'uint8':
        return 1;
      case 'int16':
      case 'uint16':
        return 2;
      case 'int32':
      case 'uint32':
      case 'float32':
        return 4;
      case 'float64':
        return 8;
      default:
        throw new Error(`Unsupported buffer type: ${type}`);
    }
  }
}

type TypedArray = 
  | Int8Array 
  | Uint8Array 
  | Int16Array 
  | Uint16Array 
  | Int32Array 
  | Uint32Array 
  | Float32Array 
  | Float64Array;
