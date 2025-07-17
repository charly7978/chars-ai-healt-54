import { StressAnalyzer, StressLevel, StressMetrics } from '../analyzers/StressAnalyzer';

export class StressVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private stressHistory: StressMetrics[] = [];
  private maxHistoryLength: number = 120; // 20 minutos con actualizaciones cada 10 segundos
  private colors = {
    background: '#1e293b',
    grid: '#334155',
    text: '#f8fafc',
    stress: {
      muy_bajo: '#10b981',    // Verde
      bajo: '#a3e635',       // Verde lima
      moderado: '#f59e0b',   // Amarillo
      alto: '#f97316',       // Naranja
      muy_alto: '#ef4444'    // Rojo
    }
  };
  
  // Dimensiones del canvas
  private width: number;
  private height: number;
  private margin = { top: 20, right: 20, bottom: 40, left: 60 };
  
  // Escalas
  private xScale: (t: number) => number;
  private yScale: (v: number) => number;
  
  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!this.canvas) {
      throw new Error(`No se encontró el canvas con ID: ${canvasId}`);
    }
    
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No se pudo obtener el contexto 2D del canvas');
    }
    
    this.ctx = ctx;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    
    // Inicializar escalas
    this.xScale = (t: number) => 0;
    this.yScale = (v: number) => 0;
    
    // Configurar canvas
    this.setupCanvas();
  }
  
  /**
   * Configura el canvas para renderizado de alta calidad
   */
  private setupCanvas(): void {
    // Ajustar tamaño del canvas según DPI
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    
    this.ctx.scale(dpr, dpr);
    this.ctx.textBaseline = 'middle';
    this.ctx.textAlign = 'center';
    
    // Actualizar dimensiones internas
    this.width = rect.width;
    this.height = rect.height;
    
    // Actualizar escalas
    this.updateScales();
  }
  
  /**
   * Actualiza las escalas según las dimensiones actuales
   */
  private updateScales(): void {
    // Escala X: tiempo (últimos 20 minutos)
    const now = Date.now();
    const twentyMinutesAgo = now - (20 * 60 * 1000);
    
    this.xScale = (t: number) => {
      return this.margin.left + 
             ((t - twentyMinutesAgo) / (now - twentyMinutesAgo)) * 
             (this.width - this.margin.left - this.margin.right);
    };
    
    // Escala Y: puntuación de estrés (0-100)
    this.yScale = (v: number) => {
      return this.height - this.margin.bottom - 
             (v / 100) * (this.height - this.margin.top - this.margin.bottom);
    };
  }
  
  /**
   * Agrega una nueva métrica de estrés al historial
   */
  addData(metrics: StressMetrics): void {
    this.stressHistory.push(metrics);
    
    // Mantener solo el historial más reciente
    if (this.stressHistory.length > this.maxHistoryLength) {
      this.stressHistory.shift();
    }
    
    // Redibujar el gráfico
    this.render();
  }
  
  /**
   * Renderiza el gráfico de estrés
   */
  render(): void {
    // Limpiar canvas
    this.ctx.fillStyle = this.colors.background;
    this.ctx.fillRect(0, 0, this.width, this.height);
    
    // Dibujar cuadrícula
    this.drawGrid();
    
    // Dibujar datos
    if (this.stressHistory.length > 1) {
      this.drawStressLine();
      this.drawStressZones();
      this.drawCurrentStatus();
    } else {
      this.drawNoDataMessage();
    }
    
    // Dibujar ejes
    this.drawAxes();
  }
  
  /**
   * Dibuja la cuadrícula del gráfico
   */
  private drawGrid(): void {
    this.ctx.strokeStyle = this.colors.grid;
    this.ctx.lineWidth = 0.5;
    
    // Líneas verticales (tiempo)
    const timeSteps = 6;
    for (let i = 0; i <= timeSteps; i++) {
      const x = this.margin.left + (i / timeSteps) * (this.width - this.margin.left - this.margin.right);
      
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.margin.top);
      this.ctx.lineTo(x, this.height - this.margin.bottom);
      this.ctx.stroke();
      
      // Etiquetas de tiempo
      const minutesAgo = 20 - (i * (20 / timeSteps));
      this.ctx.fillStyle = this.colors.text;
      this.ctx.font = '10px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        `${minutesAgo.toFixed(0)} min`, 
        x, 
        this.height - this.margin.bottom / 2
      );
    }
    
    // Líneas horizontales (estrés)
    const stressLevels = [0, 25, 50, 75, 100];
    for (const level of stressLevels) {
      const y = this.yScale(level);
      
      this.ctx.beginPath();
      this.ctx.moveTo(this.margin.left, y);
      this.ctx.lineTo(this.width - this.margin.right, y);
      this.ctx.stroke();
      
      // Etiquetas de nivel de estrés
      this.ctx.fillStyle = this.colors.text;
      this.ctx.font = '10px Arial';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(
        level.toString(), 
        this.margin.left - 10, 
        y
      );
    }
  }
  
  /**
   * Dibuja la línea de estrés a lo largo del tiempo
   */
  private drawStressLine(): void {
    if (this.stressHistory.length < 2) return;
    
    this.ctx.beginPath();
    this.ctx.strokeStyle = '#3b82f6';
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = 'round';
    
    // Dibujar línea de estrés
    for (let i = 0; i < this.stressHistory.length; i++) {
      const point = this.stressHistory[i];
      const x = this.xScale(point.timestamp);
      const y = this.yScale(point.score);
      
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    
    this.ctx.stroke();
    
    // Resaltar el punto más reciente
    const lastPoint = this.stressHistory[this.stressHistory.length - 1];
    const x = this.xScale(lastPoint.timestamp);
    const y = this.yScale(lastPoint.score);
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, 4, 0, Math.PI * 2);
    this.ctx.fillStyle = this.getStressColor(lastPoint.level);
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }
  
  /**
   * Dibuja las zonas de estrés en el gráfico
   */
  private drawStressZones(): void {
    const zones: { level: StressLevel; y1: number; y2: number }[] = [
      { level: 'muy_bajo', y1: 80, y2: 100 },
      { level: 'bajo', y1: 60, y2: 80 },
      { level: 'moderado', y1: 40, y2: 60 },
      { level: 'alto', y1: 20, y2: 40 },
      { level: 'muy_alto', y1: 0, y2: 20 }
    ];
    
    for (const zone of zones) {
      const y1 = this.yScale(zone.y1);
      const y2 = this.yScale(zone.y2);
      const height = Math.abs(y2 - y1);
      
      this.ctx.fillStyle = this.getStressColor(zone.level) + '40'; // 25% de opacidad
      this.ctx.fillRect(
        this.margin.left,
        y1,
        this.width - this.margin.left - this.margin.right,
        height
      );
    }
  }
  
  /**
   * Muestra el estado actual de estrés
   */
  private drawCurrentStatus(): void {
    if (this.stressHistory.length === 0) return;
    
    const current = this.stressHistory[this.stressHistory.length - 1];
    const stressText = this.getStressLabel(current.level);
    const stressColor = this.getStressColor(current.level);
    
    // Fondo del indicador
    this.ctx.fillStyle = stressColor + '80'; // 50% de opacidad
    this.ctx.strokeStyle = stressColor;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.roundRect(
      this.width - 150, 20, 130, 60, 8
    );
    this.ctx.fill();
    this.ctx.stroke();
    
    // Texto del nivel de estrés
    this.ctx.fillStyle = this.colors.text;
    this.ctx.font = 'bold 14px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('ESTRÉS', this.width - 85, 40);
    
    // Nivel de estrés
    this.ctx.fillStyle = stressColor;
    this.ctx.font = 'bold 20px Arial';
    this.ctx.fillText(stressText, this.width - 85, 60);
    
    // Puntuación numérica
    this.ctx.fillStyle = this.colors.text;
    this.ctx.font = '12px Arial';
    this.ctx.fillText(
      `Puntuación: ${Math.round(current.score)}`, 
      this.width - 85, 
      80
    );
  }
  
  /**
   * Muestra un mensaje cuando no hay datos
   */
  private drawNoDataMessage(): void {
    this.ctx.fillStyle = this.colors.text;
    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      'Recopilando datos de estrés...', 
      this.width / 2, 
      this.height / 2
    );
  }
  
  /**
   * Dibuja los ejes del gráfico
   */
  private drawAxes(): void {
    this.ctx.strokeStyle = this.colors.text;
    this.ctx.lineWidth = 1;
    
    // Eje X
    this.ctx.beginPath();
    this.ctx.moveTo(this.margin.left, this.height - this.margin.bottom);
    this.ctx.lineTo(this.width - this.margin.right, this.height - this.margin.bottom);
    this.ctx.stroke();
    
    // Eje Y
    this.ctx.beginPath();
    this.ctx.moveTo(this.margin.left, this.margin.top);
    this.ctx.lineTo(this.margin.left, this.height - this.margin.bottom);
    this.ctx.stroke();
    
    // Etiqueta del eje Y
    this.ctx.save();
    this.ctx.translate(20, this.height / 2);
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.fillStyle = this.colors.text;
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('NIVEL DE ESTRÉS (0-100)', 0, 0);
    this.ctx.restore();
  }
  
  /**
   * Obtiene el color correspondiente a un nivel de estrés
   */
  private getStressColor(level: StressLevel): string {
    return this.colors.stress[level] || '#cccccc';
  }
  
  /**
   * Obtiene la etiqueta legible para un nivel de estrés
   */
  private getStressLabel(level: StressLevel): string {
    const labels: Record<StressLevel, string> = {
      'muy_bajo': 'MUY BAJO',
      'bajo': 'BAJO',
      'moderado': 'MODERADO',
      'alto': 'ALTO',
      'muy_alto': 'MUY ALTO'
    };
    
    return labels[level] || 'DESCONOCIDO';
  }
  
  /**
   * Maneja el redimensionamiento de la ventana
   */
  handleResize(): void {
    this.setupCanvas();
    this.render();
  }
  
  /**
   * Limpia el historial de estrés
   */
  clear(): void {
    this.stressHistory = [];
    this.render();
  }
}
