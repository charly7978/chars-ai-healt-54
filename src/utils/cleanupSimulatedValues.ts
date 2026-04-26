/**
 * CLEANUP SIMULATED VALUES UTILITY
 * 
 * Este script identifica y elimina valores simulados, fallbacks y 
 * valores normales hardcodeados que puedan generar falsos positivos.
 * 
 * REGLAS DE LIMPIEZA:
 * 1. Ningún return con valor numérico hardcodeado (excepto 0 para rechazo)
 * 2. Ningún valor fallback que no sea null/undefined
 * 3. Ningún valor "normal" o "típico" como default
 * 4. Todas las mediciones deben requerir evidencia biológica real
 * 5. Solo retornar valores cuando hay señal válida autorizada
 */

export interface CleanupReport {
  file: string;
  issues: Array<{
    line: number;
    type: 'HARDCODED_VALUE' | 'FALLBACK_VALUE' | 'NORMAL_RANGE' | 'SIMULATED_DATA';
    description: string;
    code: string;
    suggestion: string;
  }>;
  cleaned: boolean;
}

export class SimulatedValuesCleaner {
  private readonly PATTERNS = {
    // Valores hardcodeados que no sean 0 (para rechazo)
    HARDCODED_VALUES: [
      /return\s+[1-9]\d*;?/g,
      /return\s+\d+\.\d+;?/g,
      /=\s*[1-9]\d*;?/g,
      /=\s*\d+\.\d+;?/g,
    ],
    
    // Valores fallback o default
    FALLBACK_VALUES: [
      /default:\s*\d+/g,
      /fallback:\s*\d+/g,
      /\?\s*\d+/g,
      /\|\|\s*\d+/g,
      /\?\?\s*\d+/g,
    ],
    
    // Rangos normales o típicos
    NORMAL_RANGES: [
      /normal.*range/gi,
      /typical.*value/gi,
      /average.*adult/gi,
      /healthy.*range/gi,
    ],
    
    // Datos simulados
    SIMULATED_DATA: [
      /mock/gi,
      /fake/gi,
      /dummy/gi,
      /simulated/gi,
    ],
  };

  private readonly SAFE_VALUES = [
    'return 0',      // Rechazo explícito
    'return null',   // Sin medición
    'return undefined', // Sin medición
    '=== 0',         // Comparación con cero
    '< 0',           // Validación negativa
    '> 0',           // Validación positiva
  ];

  /**
   * Analizar un archivo en busca de valores problemáticos
   */
  analyzeFile(filePath: string, content: string): CleanupReport {
    const lines = content.split('\n');
    const issues: CleanupReport['issues'] = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      const trimmedLine = line.trim();

      // Ignorar comentarios y líneas vacías
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || !trimmedLine) {
        return;
      }

      // Buscar valores hardcodeados
      this.PATTERNS.HARDCODED_VALUES.forEach(pattern => {
        const matches = trimmedLine.match(pattern);
        if (matches) {
          matches.forEach(match => {
            // Verificar si es un valor seguro
            const isSafe = this.SAFE_VALUES.some(safe => trimmedLine.includes(safe));
            
            if (!isSafe) {
              issues.push({
                line: lineNumber,
                type: 'HARDCODED_VALUE',
                description: `Valor hardcodeado detectado: ${match}`,
                code: trimmedLine,
                suggestion: 'Reemplazar con valor calculado o return null/0 para rechazo'
              });
            }
          });
        }
      });

      // Buscar valores fallback
      this.PATTERNS.FALLBACK_VALUES.forEach(pattern => {
        const matches = trimmedLine.match(pattern);
        if (matches) {
          matches.forEach(match => {
            issues.push({
              line: lineNumber,
              type: 'FALLBACK_VALUE',
              description: `Valor fallback detectado: ${match}`,
              code: trimmedLine,
              suggestion: 'Reemplazar con null o undefined para indicar sin medición'
            });
          });
        }
      });

      // Buscar rangos normales
      this.PATTERNS.NORMAL_RANGES.forEach(pattern => {
        const matches = trimmedLine.match(pattern);
        if (matches) {
          matches.forEach(match => {
            issues.push({
              line: lineNumber,
              type: 'NORMAL_RANGE',
              description: `Rango normal detectado: ${match}`,
              code: trimmedLine,
              suggestion: 'Eliminar rangos normales hardcodeados - solo usar evidencia real'
            });
          });
        }
      });

      // Buscar datos simulados
      this.PATTERNS.SIMULATED_DATA.forEach(pattern => {
        const matches = trimmedLine.match(pattern);
        if (matches) {
          matches.forEach(match => {
            issues.push({
              line: lineNumber,
              type: 'SIMULATED_DATA',
              description: `Dato simulado detectado: ${match}`,
              code: trimmedLine,
              suggestion: 'Reemplazar con datos reales o eliminar simulación'
            });
          });
        }
      });
    });

    return {
      file: filePath,
      issues,
      cleaned: issues.length === 0,
    };
  }

  /**
   * Generar sugerencias de limpieza específicas para HeartBeatProcessor
   */
  generateHeartBeatProcessorCleanup(): string[] {
    return [
      '# LIMPIEZA DE HEARTBEATPROCESSOR',
      '',
      '## Problemas identificados:',
      '1. makeEmptyResult(bpm) - puede retornar BPM sin evidencia',
      '2. Valores hardcodeados en cálculos de confianza',
      '3. FPS default de 30 en estimateSampleRate()',
      '4. Umbrales fijos que pueden generar falsos positivos',
      '',
      '## Acciones requeridas:',
      '',
      '### 1. Modificar makeEmptyResult',
      '```typescript',
      'private makeEmptyResult(): HeartBeatResult {',
      '  return {',
      '    bpm: null,           // null en lugar de 0',
      '    bpmConfidence: 0,    // 0 es válido (confianza nula)',
      '    isPeak: false,',
      '    filteredValue: 0,',
      '    arrhythmiaCount: 0,',
      '    sqi: 0,             // 0 es válido (SQI nulo)',
      '    beatSQI: 0,',
      '    rrData: { intervals: [], lastPeakTime: null },',
      '    hypothesis: null,',
      '    detectorAgreement: 0,',
      '    rejectionReason: "NO_BIOLOGICAL_EVIDENCE",',
      '    beatFlags: null,',
      '    // ... resto de campos',
      '  };',
      '}',
      '```',
      '',
      '### 2. Eliminar FPS default',
      '```typescript',
      'private estimateSampleRate(): number {',
      '  if (this.timestampBuf.length < 10) return null; // null en lugar de 30',
      '  // ... resto del código',
      '}',
      '```',
      '',
      '### 3. Reemplazar retornos con BPM hardcodeados',
      'Todos los retornos de BPM deben basarse en evidencia:',
      '- return 0; → return null;',
      '- return 72; → return null;',
      '- return 60; → return null;',
      '',
      '### 4. Añadir validaciones estrictas',
      'Antes de retornar cualquier BPM, verificar:',
      '- Señal PPG válida',
      '- Calidad mínima (SQI > 0.85)',
      '- Evidencia de tejido vivo',
      '- Autorización del sistema',
    ];
  }

  /**
   * Generar script de limpieza automática
   */
  generateCleanupScript(): string {
    return `#!/usr/bin/env node

/**
 * SCRIPT DE LIMPIEZA AUTOMÁTICA
 * 
 * Ejecutar: npm run cleanup:simulated
 */

const fs = require('fs');
const path = require('path');

const FILES_TO_CLEAN = [
  'src/modules/HeartBeatProcessor.ts',
  'src/modules/signal-processing/*.ts',
  'src/hooks/useSignalProcessor.ts',
  'src/components/VitalSign.tsx',
];

const CLEANUP_RULES = [
  {
    pattern: /return\\s+([1-9]\\d*);?/g,
    replacement: 'return null;',
    description: 'Reemplazar retornos con valores hardcodeados'
  },
  {
    pattern: /return\\s+(\\d+\\.\\d+);?/g,
    replacement: 'return null;',
    description: 'Reemplazar retornos con valores decimales hardcodeados'
  },
  {
    pattern: /default:\\s*\\d+/g,
    replacement: 'default: null',
    description: 'Reemplazar valores default numéricos'
  },
  {
    pattern: /fallback:\\s*\\d+/g,
    replacement: 'fallback: null',
    description: 'Reemplazar valores fallback numéricos'
  },
  {
    pattern: /\\?\\s*\\d+/g,
    replacement: '?? null',
    description: 'Reemplazar operadores ternarios con valores numéricos'
  },
];

function cleanFile(filePath) {
  console.log(\`🧹 Limpiando: \${filePath}\`);
  
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  CLEANUP_RULES.forEach(rule => {
    const original = content;
    content = content.replace(rule.pattern, rule.replacement);
    
    if (original !== content) {
      console.log(\`  ✅ \${rule.description}\`);
      modified = true;
    }
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(\`  💾 Guardado: \${filePath}\`);
  } else {
    console.log(\`  ✅ Ya limpio: \${filePath}\`);
  }
}

// Ejecutar limpieza
console.log('🚀 Iniciando limpieza de valores simulados...');

FILES_TO_CLEAN.forEach(file => {
  if (fs.existsSync(file)) {
    cleanFile(file);
  } else {
    console.log(\`⚠️  Archivo no encontrado: \${file}\`);
  }
});

console.log('✨ Limpieza completada');
console.log('');
console.log('⚠️  REVISIÓN MANUAL REQUERIDA:');
console.log('1. Verificar que todos los retornos de BPM sean null sin evidencia');
console.log('2. Confirmar que no haya valores "normales" hardcodeados');
console.log('3. Asegurar que la UI maneje valores null correctamente');
console.log('4. Probar que no se generen falsos positivos');
`;
  }

  /**
   * Validar que un archivo esté limpio
   */
  validateFile(filePath: string, content: string): boolean {
    const report = this.analyzeFile(filePath, content);
    
    // Verificar problemas críticos
    const criticalIssues = report.issues.filter(issue => 
      issue.type === 'HARDCODED_VALUE' || 
      issue.type === 'SIMULATED_DATA'
    );
    
    return criticalIssues.length === 0;
  }

  /**
   * Generar reporte completo de limpieza
   */
  generateCleanupReport(reports: CleanupReport[]): string {
    let report = '# REPORTE DE LIMPIEZA - VALORES SIMULADOS\n\n';
    
    const totalFiles = reports.length;
    const cleanedFiles = reports.filter(r => r.cleaned).length;
    const totalIssues = reports.reduce((sum, r) => sum + r.issues.length, 0);
    
    report += `## Resumen\n`;
    report += `- Archivos analizados: ${totalFiles}\n`;
    report += `- Archivos limpios: ${cleanedFiles}\n`;
    report += `- Archivos con problemas: ${totalFiles - cleanedFiles}\n`;
    report += `- Problemas totales: ${totalIssues}\n\n`;
    
    // Agrupar problemas por tipo
    const issuesByType = reports.flatMap(r => r.issues).reduce((acc, issue) => {
      acc[issue.type] = (acc[issue.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    report += `## Problemas por tipo\n`;
    Object.entries(issuesByType).forEach(([type, count]) => {
      report += `- ${type}: ${count}\n`;
    });
    report += '\n';
    
    // Detalles por archivo
    reports.forEach(fileReport => {
      if (fileReport.issues.length > 0) {
        report += `## ${fileReport.file}\n`;
        fileReport.issues.forEach(issue => {
          report += `### Línea ${issue.line} - ${issue.type}\n`;
          report += `**Descripción:** ${issue.description}\n`;
          report += `**Código:** \`${issue.code}\`\n`;
          report += `**Sugerencia:** ${issue.suggestion}\n\n`;
        });
      }
    });
    
    // Recomendaciones
    report += `## Recomendaciones\n`;
    if (totalIssues > 0) {
      report += `⚠️ **SE REQUIERE LIMPIEZA** - Se encontraron ${totalIssues} problemas\n`;
      report += `1. Ejecutar el script de limpieza automática\n`;
      report += `2. Revisar manualmente los cambios\n`;
      report += `3. Probar que no se generen falsos positivos\n`;
      report += `4. Verificar manejo de valores null en la UI\n`;
    } else {
      report += `✅ **LIMPIO** - No se encontraron problemas críticos\n`;
    }
    
    return report;
  }
}

export default SimulatedValuesCleaner;
