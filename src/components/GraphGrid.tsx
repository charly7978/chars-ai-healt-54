
import React, { useRef, useEffect } from 'react';

interface GraphGridProps {
	width?: number;
	height?: number;
	cellSize?: number;
}

const GraphGrid: React.FC<GraphGridProps> = ({ width = 1000, height = 900, cellSize = 20 }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas) {
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (ctx) {
				ctx.clearRect(0, 0, width, height);
				// Fondo crema con un sutil tono azulado
				ctx.fillStyle = '#F0F5FA'; // Crema con un muy sutil tono azulado
				ctx.fillRect(0, 0, width, height);
				ctx.beginPath();
				ctx.strokeStyle = 'rgba(60,60,60,0.3)';
				ctx.lineWidth = 0.5;
				// Líneas verticales
				for (let x = 0; x <= width; x += cellSize) {
					ctx.moveTo(x, 0);
					ctx.lineTo(x, height);
				}
				// Líneas horizontales
				for (let y = 0; y <= height; y += cellSize) {
					ctx.moveTo(0, y);
					ctx.lineTo(width, y);
				}
				ctx.stroke();
			}
		}
	}, [width, height, cellSize]);

	return (
		<canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
	);
};

export default GraphGrid;
