import React, { useState } from "react";

const Index = () => {
  const [isMonitoring, setIsMonitoring] = useState(false);

  return (
    <div className="fixed inset-0 flex flex-col bg-black" style={{ 
      height: '100svh',
      width: '100vw',
      maxWidth: '100vw',
      maxHeight: '100svh',
      overflow: 'hidden',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)'
    }}>
      {/* Header simple */}
      <div className="px-4 py-2 flex justify-around items-center bg-black/20">
        <div className="text-white text-lg">
          HealthPulse Captain
        </div>
        <div className="text-white text-lg">
          Estado: {isMonitoring ? "Monitoreando" : "Inactivo"}
        </div>
      </div>

      {/* Contenido principal */}
      <div className="flex-1 flex flex-col justify-center items-center text-white">
        <h1 className="text-2xl font-bold mb-4">Aplicación Funcionando</h1>
        <p className="text-center mb-8">
          Si puedes ver este mensaje, la aplicación está cargando correctamente.<br/>
          Los componentes complejos han sido deshabilitados temporalmente para diagnóstico.
        </p>
        
        <div className="grid grid-cols-3 gap-4 place-items-center mb-8">
          <div className="text-center">
            <div className="text-3xl font-bold">--</div>
            <div className="text-sm">FRECUENCIA CARDÍACA</div>
            <div className="text-xs">BPM</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">--</div>
            <div className="text-sm">SPO2</div>
            <div className="text-xs">%</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">--/--</div>
            <div className="text-sm">PRESIÓN ARTERIAL</div>
            <div className="text-xs">mmHg</div>
          </div>
        </div>

        {/* Botones de control */}
        <div className="flex gap-4">
          <button 
            onClick={() => setIsMonitoring(!isMonitoring)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {isMonitoring ? "Detener" : "Iniciar"} Monitoreo
          </button>
          <button 
            onClick={() => alert('Función de reset funcionando')}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 text-center text-white text-sm bg-black/20">
        Versión de diagnóstico - Componentes simplificados
      </div>
    </div>
  );
};

export default Index;
