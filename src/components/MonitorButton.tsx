import React from 'react';

interface MonitorButtonProps {
  isMonitoring: boolean;
  onToggle: () => void;
  variant?: "monitor" | "reset";
  className?: string;
}

const MonitorButton = ({ 
  isMonitoring, 
  onToggle, 
  variant = "monitor",
  className = ""
}: MonitorButtonProps) => {
  // Para "monitor": azul menos vivo; para "reset": gris
  const baseClass = "px-4 py-2 rounded transition-colors duration-300 w-full text-white";
  const classes =
    variant === "monitor"
      ? `${baseClass} ${isMonitoring ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-400 hover:bg-blue-500'}`
      : `${baseClass} bg-gray-500 hover:bg-gray-600`;
      
  return (
    <button onClick={onToggle} className={`${classes} ${className}`}>
      {variant === "monitor" ? (isMonitoring ? 'Detener' : 'Iniciar') : 'Reset'}
    </button>
  );
};

export default MonitorButton;
