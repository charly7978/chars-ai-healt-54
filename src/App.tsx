import React, { Suspense } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";

// Componente de fallback para mostrar mientras se cargan los componentes
const LoadingFallback = () => (
  <div style={{ 
    backgroundColor: '#000', 
    color: '#fff', 
    height: '100vh', 
    display: 'flex', 
    flexDirection: 'column', 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: '20px'
  }}>
    <h2>Cargando HealthPulse Captain...</h2>
    <p>Por favor espera mientras se inicializa la aplicación</p>
  </div>
);

// Componente de error para mostrar si algo falla
const ErrorFallback = ({ error }: { error: Error }) => (
  <div style={{ 
    backgroundColor: '#000', 
    color: '#fff', 
    height: '100vh', 
    display: 'flex', 
    flexDirection: 'column', 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: '20px'
  }}>
    <h2>Error en la aplicación</h2>
    <p>Ha ocurrido un error al cargar la aplicación:</p>
    <pre style={{ 
      backgroundColor: '#333', 
      padding: '10px', 
      borderRadius: '5px',
      maxWidth: '80%',
      overflow: 'auto'
    }}>
      {error.message}
    </pre>
    <button 
      onClick={() => window.location.reload()}
      style={{
        marginTop: '20px',
        padding: '10px 20px',
        backgroundColor: '#007bff',
        color: '#fff',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer'
      }}
    >
      Recargar Página
    </button>
  </div>
);

// Componente de prueba simple
const TestComponent = () => (
  <div style={{ 
    backgroundColor: '#000', 
    color: '#fff', 
    height: '100vh', 
    display: 'flex', 
    flexDirection: 'column', 
    justifyContent: 'center', 
    alignItems: 'center',
    padding: '20px'
  }}>
    <h1>HealthPulse Captain</h1>
    <p>¡La aplicación está funcionando correctamente!</p>
    <p>Timestamp: {new Date().toLocaleString()}</p>
  </div>
);

const App = () => {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <Router>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<TestComponent />} />
          </Routes>
        </Suspense>
      </Router>
    </ErrorBoundary>
  );
};

export default App;
