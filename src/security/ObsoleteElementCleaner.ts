/**
 * @file ObsoleteElementCleaner.ts
 * @description Sistema para eliminar elementos obsoletos y componentes deprecated
 * LIMPIEZA TOTAL - SIN CÓDIGO MUERTO
 */

export interface ObsoleteElement {
  type: 'FILE' | 'IMPORT' | 'CLASS' | 'FUNCTION' | 'VARIABLE';
  path: string;
  name: string;
  reason: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  replacement?: string;
}

export class ObsoleteElementCleaner {
  private static instance: ObsoleteElementCleaner;
  private obsoleteElements: ObsoleteElement[] = [];

  // Elementos obsoletos identificados
  private readonly OBSOLETE_PATTERNS = [
    {
      pattern: /HeartRateDisplay/g,
      type: 'FILE' as const,
      severity: 'CRITICAL' as const,
      reason: 'Deprecated component - Use HeartRate from @/components/HeartRate instead',
      replacement: 'HeartRate'
    },
    {
      pattern: /className=["'].*deprecated.*["']/g,
      type: 'CLASS' as const,
      severity: 'HIGH' as const,
      reason: 'Deprecated CSS classes detected'
    },
    {
      pattern: /\/\*\s*@deprecated.*?\*\//gs,
      type: 'FUNCTION' as const,
      severity: 'MEDIUM' as const,
      reason: 'Deprecated function with annotation'
    },
    {
      pattern: /import.*from\s+["'].*\/deprecated\/.*["']/g,
      type: 'IMPORT' as const,
      severity: 'HIGH' as const,
      reason: 'Import from deprecated directory'
    }
  ];

  private constructor() {}

  public static getInstance(): ObsoleteElementCleaner {
    if (!ObsoleteElementCleaner.instance) {
      ObsoleteElementCleaner.instance = new ObsoleteElementCleaner();
    }
    return ObsoleteElementCleaner.instance;
  }

  /**
   * Escanea código en busca de elementos obsoletos
   */
  public scanForObsoleteElements(code: string, filepath: string): ObsoleteElement[] {
    const elements: ObsoleteElement[] = [];
    const lines = code.split('\n');

    lines.forEach((line, lineIndex) => {
      this.OBSOLETE_PATTERNS.forEach(obsoletePattern => {
        const matches = line.matchAll(obsoletePattern.pattern);
        for (const match of matches) {
          elements.push({
            type: obsoletePattern.type,
            path: `${filepath}:${lineIndex + 1}`,
            name: match[0],
            reason: obsoletePattern.reason,
            severity: obsoletePattern.severity,
            replacement: obsoletePattern.replacement
          });
        }
      });
    });

    this.obsoleteElements.push(...elements);
    return elements;
  }

  /**
   * Limpia imports no utilizados
   */
  public cleanUnusedImports(code: string): string {
    const lines = code.split('\n');
    const importLines: string[] = [];
    const codeLines: string[] = [];
    
    lines.forEach(line => {
      if (line.trim().startsWith('import ')) {
        importLines.push(line);
      } else {
        codeLines.push(line);
      }
    });

    const codeContent = codeLines.join('\n');
    const usedImports = importLines.filter(importLine => {
      const importMatch = importLine.match(/import\s+(?:{([^}]+)}|(\w+))/);
      if (!importMatch) return true;

      const imports = importMatch[1] 
        ? importMatch[1].split(',').map(i => i.trim())
        : [importMatch[2]];

      return imports.some(importName => {
        const cleanImportName = importName.replace(/\s+as\s+\w+/, '').trim();
        return codeContent.includes(cleanImportName);
      });
    });

    return [...usedImports, ...codeLines].join('\n');
  }

  /**
   * Reemplaza elementos obsoletos con versiones actualizadas
   */
  public replaceObsoleteElements(code: string): string {
    let cleanCode = code;

    // Reemplazar HeartRateDisplay con HeartRate
    cleanCode = cleanCode.replace(
      /import.*HeartRateDisplay.*from.*["'].*HeartRateDisplay.*["'];?/g,
      "import { HeartRate } from '@/components/HeartRate';"
    );

    cleanCode = cleanCode.replace(
      /<HeartRateDisplay/g,
      '<HeartRate'
    );

    cleanCode = cleanCode.replace(
      /HeartRateDisplay/g,
      'HeartRate'
    );

    // Eliminar clases deprecated
    cleanCode = cleanCode.replace(
      /className=["'][^"']*deprecated[^"']*["']/g,
      'className=""'
    );

    // Eliminar comentarios deprecated
    cleanCode = cleanCode.replace(
      /\/\*\s*@deprecated.*?\*\//gs,
      ''
    );

    return cleanCode;
  }

  /**
   * Valida que no existan elementos obsoletos críticos
   */
  public validateNoObsoleteElements(code: string, filepath: string): boolean {
    const elements = this.scanForObsoleteElements(code, filepath);
    const criticalElements = elements.filter(e => e.severity === 'CRITICAL');
    
    if (criticalElements.length > 0) {
      console.error('OBSOLETE ELEMENT CLEANER: CRITICAL OBSOLETE ELEMENTS DETECTED:', {
        file: filepath,
        elements: criticalElements.length,
        details: criticalElements
      });
      return false;
    }

    return true;
  }

  /**
   * Genera reporte de elementos obsoletos
   */
  public getObsoleteReport(): {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    elements: ObsoleteElement[];
  } {
    const critical = this.obsoleteElements.filter(e => e.severity === 'CRITICAL').length;
    const high = this.obsoleteElements.filter(e => e.severity === 'HIGH').length;
    const medium = this.obsoleteElements.filter(e => e.severity === 'MEDIUM').length;
    const low = this.obsoleteElements.filter(e => e.severity === 'LOW').length;

    return {
      total: this.obsoleteElements.length,
      critical,
      high,
      medium,
      low,
      elements: this.obsoleteElements
    };
  }

  /**
   * Limpia el historial de elementos obsoletos
   */
  public clearObsoleteElements(): void {
    this.obsoleteElements = [];
  }
}

// Instancia singleton
export const obsoleteElementCleaner = ObsoleteElementCleaner.getInstance();

// Funciones de utilidad
export function cleanObsoleteCode(code: string): string {
  return obsoleteElementCleaner.replaceObsoleteElements(code);
}

export function validateCodeCleanliness(code: string, filepath: string): boolean {
  return obsoleteElementCleaner.validateNoObsoleteElements(code, filepath);
}