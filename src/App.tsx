import React from "react";

// Componente principal simplificado
const App = () => {
  return (
    <div style={{ 
      backgroundColor: '#000', 
      color: '#fff', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      justifyContent: 'center', 
      alignItems: 'center',
      padding: '20px',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
        HealthPulse Captain
      </h1>
      
      <div style={{ 
        backgroundColor: '#1a1a1a', 
        padding: '2rem', 
        borderRadius: '10px',
        textAlign: 'center',
        maxWidth: '500px'
      }}>
        <h2 style={{ color: '#00ff88', marginBottom: '1rem' }}>
          ¡Aplicación Funcionando!
        </h2>
        
        <p style={{ marginBottom: '1rem', lineHeight: '1.6' }}>
          La aplicación está cargando correctamente. 
          Ahora vamos a restaurar todas las funcionalidades paso a paso.
        </p>
        
        <div style={{ 
          backgroundColor: '#333', 
          padding: '1rem', 
          borderRadius: '5px',
          marginBottom: '1rem'
        }}>
          <p><strong>Estado:</strong> ✅ Cargado correctamente</p>
          <p><strong>Timestamp:</strong> {new Date().toLocaleString()}</p>
          <p><strong>Versión:</strong> 1.0.0</p>
        </div>
        
        <button 
          onClick={() => window.location.reload()}
          style={{
            backgroundColor: '#007bff',
            color: '#fff',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '5px',
            cursor: 'pointer',
            fontSize: '1rem'
          }}
        >
          Recargar Aplicación
        </button>
      </div>
    </div>
  );
};

export default App;
