import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Progress } from './ui/progress';

interface ValidationMetric {
  name: string;
  value: number;
  target: number;
  unit?: string;
}

interface ModelValidationProps {
  modelName: string;
  metrics: ValidationMetric[];
  onValidate?: () => Promise<boolean>;
  onImprove?: () => void;
  className?: string;
}

const ModelValidation: React.FC<ModelValidationProps> = ({
  modelName,
  metrics,
  onValidate,
  onImprove,
  className = ''
}) => {
  const [isValidating, setIsValidating] = useState(false);
  const [validationProgress, setValidationProgress] = useState(0);
  const [validationComplete, setValidationComplete] = useState(false);
  const [validationResult, setValidationResult] = useState<boolean | null>(null);
  const [lastValidated, setLastValidated] = useState<Date | null>(null);

  // Efecto para simular la validación
  useEffect(() => {
    if (!isValidating) return;

    const timer = setInterval(() => {
      setValidationProgress((prev) => {
        const newProgress = prev + Math.random() * 20;
        if (newProgress >= 100) {
          clearInterval(timer);
          setIsValidating(false);
          setValidationComplete(true);
          return 100;
        }
        return newProgress;
      });
    }, 300);

    return () => clearInterval(timer);
  }, [isValidating]);

  const handleValidate = async () => {
    if (isValidating) return;
    
    setIsValidating(true);
    setValidationProgress(0);
    setValidationComplete(false);
    
    try {
      let result = true;
      if (onValidate) {
        result = await onValidate();
      }
      
      setValidationResult(result);
      setLastValidated(new Date());
    } catch (error) {
      console.error('Error during validation:', error);
      setValidationResult(false);
    } finally {
      setIsValidating(false);
      setValidationComplete(true);
    }
  };

  // Calcular puntuación general
  const overallScore = metrics.length > 0
    ? metrics.reduce((sum, metric) => sum + (metric.value / metric.target), 0) / metrics.length * 100
    : 0;

  const isModelValid = overallScore >= 90; // Umbral de validación del 90%

  return (
    <Card className={`bg-gray-800/80 backdrop-blur-sm border-gray-700 ${className}`}>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="text-white">Validación del Modelo</CardTitle>
            <CardDescription className="text-gray-400">
              {modelName} • Última validación: {lastValidated ? lastValidated.toLocaleString() : 'Nunca'}
            </CardDescription>
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            validationComplete 
              ? isModelValid 
                ? 'bg-green-900/30 text-green-400' 
                : 'bg-red-900/30 text-red-400'
              : 'bg-blue-900/30 text-blue-400'
          }`}>
            {validationComplete 
              ? isModelValid ? 'Válido' : 'Requiere Mejoras'
              : 'No Validado'}
          </div>
        </div>
      </CardHeader>
      
      <CardContent>
        {isValidating ? (
          <div className="space-y-4">
            <div className="text-center text-blue-400 mb-2">
              Validando modelo...
            </div>
            <Progress value={validationProgress} className="h-2" />
            <div className="text-xs text-center text-gray-400">
              {Math.round(validationProgress)}% completado
            </div>
          </div>
        ) : validationComplete ? (
          <div className="space-y-4">
            {/* Puntuación general */}
            <div className="text-center mb-6">
              <div className="text-4xl font-bold mb-1" style={{
                color: overallScore >= 90 ? '#4ade80' : 
                       overallScore >= 70 ? '#facc15' : '#f87171'
              }}>
                {Math.round(overallScore)}%
              </div>
              <div className="text-sm text-gray-400">Puntuación General</div>
              <div className="text-xs text-gray-500 mt-1">
                {isModelValid 
                  ? 'El modelo cumple con los estándares de precisión.'
                  : 'Se recomienda mejorar el modelo antes de producción.'}
              </div>
            </div>

            {/* Métricas detalladas */}
            <div className="space-y-3">
              {metrics.map((metric, index) => (
                <div key={index} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-300">{metric.name}</span>
                    <span className="font-medium">
                      {metric.value.toFixed(2)}{metric.unit ? ` ${metric.unit}` : ''} 
                      <span className="text-gray-500"> / {metric.target}{metric.unit ? ` ${metric.unit}` : ''}</span>
                    </span>
                  </div>
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                    <div 
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(metric.value / metric.target) * 100}%`,
                        backgroundColor: metric.value >= metric.target * 0.9 
                          ? '#10B981' // green-500
                          : metric.value >= metric.target * 0.7 
                            ? '#F59E0B' // yellow-500
                            : '#EF4444' // red-500
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Acciones */}
            <div className="flex justify-between pt-4">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleValidate}
                disabled={isValidating}
              >
                Revalidar
              </Button>
              {!isModelValid && onImprove && (
                <Button 
                  variant="default" 
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={onImprove}
                >
                  Mejorar Modelo
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-6">
            <p className="text-gray-400 mb-4">
              Valide el modelo para evaluar su rendimiento y precisión.
            </p>
            <Button 
              onClick={handleValidate}
              disabled={isValidating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Iniciar Validación
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ModelValidation;
