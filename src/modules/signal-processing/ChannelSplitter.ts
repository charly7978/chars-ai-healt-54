import { CameraSample } from '@/types';

/**
 * ChannelSplitter
 * - Divide la señal en canales exclusivos optimizados (R, G, mixtos/antimovimiento)
 * - Mantiene estado interno (DC removal por canal, derivada, pesos adaptativos)
 * - Recibe feedback de procesadores (quality, snr, preferencia) para microafinación
 */
export type ChannelFeedback = {
	preferred?: 'red' | 'green' | 'mixed';
	quality?: number; // 0..100
	snr?: number;     // relativo
};

export default class ChannelSplitter {
	private dcRed = 0;
	private dcGreen = 0;
	private lastMixed = 0;
	private weights = { wR: 0.6, wG: 0.4 };
	private readonly alpha = 0.97; // tiempo ~1s para DC removal

	constructor(private readonly nChannels: number = 6) {}

	public split(sample: CameraSample): number[] {
		// DC removal por canal
		this.dcRed = this.alpha * this.dcRed + (1 - this.alpha) * sample.rMean;
		this.dcGreen = this.alpha * this.dcGreen + (1 - this.alpha) * sample.gMean;
		let acR = sample.rMean - this.dcRed;
		let acG = sample.gMean - this.dcGreen;

		// Limitación de derivada en la mezcla para suprimir artefactos de movimiento
		const mixedRaw = (acR + acG) * 0.5;
		const maxDelta = Math.max(1.5, (sample.brightnessStd ?? 6) * 0.8);
		const delta = mixedRaw - this.lastMixed;
		let mixed = mixedRaw;
		if (Math.abs(delta) > maxDelta) {
			const sign = delta > 0 ? 1 : -1;
			mixed = this.lastMixed + sign * maxDelta;
		}
		this.lastMixed = mixed;

		// Ponderación adaptativa R/G por condiciones
		const coverage = sample.coverageRatio ?? 0;
		const motion = sample.frameDiff ?? 0;
		const rgRatio = sample.rgRatio ?? (sample.gMean > 1 ? sample.rMean / sample.gMean : 2);
		const saturation = sample.saturationRatio ?? 0;
		const coverageW = Math.max(0, Math.min(1, (coverage - 0.12) / 0.28));
		const motionW = 1 / (1 + 0.6 * motion);
		const skinW = Math.max(0, Math.min(1, (rgRatio - 1.0) / 2.5));
		const satW = Math.max(0, 1 - saturation * 1.6);
		const qR = coverageW * motionW * skinW * satW;
		const qG = coverageW * motionW * Math.max(0.4, 1 - Math.abs(rgRatio - 0.9));
		const denom = Math.max(1e-3, qR + qG);
		const mixedWeighted = (qR * acR + qG * acG) / denom;

		// Canales exclusivos
		const channels = new Array<number>(this.nChannels).fill(0);
		channels[0] = acR;                 // R puro
		channels[1] = acG;                 // G puro
		channels[2] = mixedWeighted;       // mezcla ponderada
		channels[3] = mixed;               // mezcla antimo-derivada
		channels[4] = acR * 0.6 + acG * 0.4; // referencia básica
		channels[5] = acR * this.weights.wR + acG * this.weights.wG; // mezcla con pesos feedback
		return channels;
	}

	public updateFeedback(feedback: ChannelFeedback) {
		if (feedback.preferred === 'red') {
			this.weights.wR = Math.min(0.9, this.weights.wR + 0.05);
			this.weights.wG = 1 - this.weights.wR;
		} else if (feedback.preferred === 'green') {
			this.weights.wG = Math.min(0.9, this.weights.wG + 0.05);
			this.weights.wR = 1 - this.weights.wG;
		}
		if ((feedback.quality ?? 0) > 70 && (feedback.snr ?? 0) > 1.3) {
			// Congelar levemente pesos si la calidad es alta
			this.weights.wR = this.weights.wR * 0.98 + this.weights.wR * 0.02;
			this.weights.wG = 1 - this.weights.wR;
		}
	}
}
