/**
 * Comprehensive Test Suite for PPG Signal Processing Algorithms
 * 
 * Tests all advanced algorithms:
 * - CHROM
 * - POS
 * - Wavelet Transform
 * - LMS/RLS Adaptive Filters
 * - ICA
 * - Kalman Filter
 * - Bayesian Fusion
 * - EMD
 */

import { CHROMProcessor } from '../CHROMProcessor';
import { POSProcessor } from '../POSProcessor';
import { WaveletFilter } from '../WaveletFilter';
import { LMSAdaptiveFilter } from '../LMSAdaptiveFilter';
import { RLSAdaptiveFilter } from '../RLSAdaptiveFilter';
import { ICAProcessor } from '../ICAProcessor';
import { KalmanFilter } from '../KalmanFilter';
import { BayesianFusion, ParticleFilter } from '../BayesianFusion';
import { EMDProcessor } from '../EMDProcessor';

export class AlgorithmTestSuite {
  private results: Map<string, boolean> = new Map();

  /**
   * Run all tests
   */
  runAllTests(): {
    passed: number;
    failed: number;
    results: Map<string, boolean>;
  } {
    console.log('🧪 Starting PPG Algorithm Test Suite...\n');

    this.testCHROM();
    this.testPOS();
    this.testWavelet();
    this.testLMS();
    this.testRLS();
    this.testICA();
    this.testKalman();
    this.testBayesianFusion();
    this.testParticleFilter();
    this.testEMD();

    let passed = 0;
    let failed = 0;

    for (const [name, result] of this.results) {
      if (result) passed++;
      else failed++;
    }

    console.log('\n📊 Test Results:');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Success Rate: ${(passed / (passed + failed) * 100).toFixed(1)}%`);

    return { passed, failed, results: this.results };
  }

  /**
   * Test CHROM Processor
   */
  testCHROM(): void {
    console.log('Testing CHROM Processor...');
    try {
      const chrom = new CHROMProcessor(100);

      // Test with synthetic PPG signal
      for (let i = 0; i < 120; i++) {
        const r = 150 + Math.sin(i * 0.1) * 20;
        const g = 100 + Math.sin(i * 0.1) * 10;
        const b = 80 + Math.sin(i * 0.1) * 8;
        chrom.processFrame(r, g, b);
      }

      const metrics = chrom.getQualityMetrics();
      const signal = chrom.getSignal();

      const passed = metrics.snr > 0 && signal.length === 100;
      this.results.set('CHROM', passed);

      console.log(`  ${passed ? '✅' : '❌'} CHROM: SNR=${metrics.snr.toFixed(2)}, Stability=${metrics.stability.toFixed(2)}`);
    } catch (error) {
      this.results.set('CHROM', false);
      console.log(`  ❌ CHROM: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test POS Processor
   */
  testPOS(): void {
    console.log('Testing POS Processor...');
    try {
      const pos = new POSProcessor(100);

      for (let i = 0; i < 120; i++) {
        const r = 150 + Math.sin(i * 0.1) * 20;
        const g = 100 + Math.sin(i * 0.1) * 10;
        const b = 80 + Math.sin(i * 0.1) * 8;
        pos.processFrame(r, g, b);
      }

      const metrics = pos.getQualityMetrics();
      const passed = metrics.snr > 0;

      this.results.set('POS', passed);
      console.log(`  ${passed ? '✅' : '❌'} POS: SNR=${metrics.snr.toFixed(2)}`);
    } catch (error) {
      this.results.set('POS', false);
      console.log(`  ❌ POS: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test Wavelet Filter
   */
  testWavelet(): void {
    console.log('Testing Wavelet Filter...');
    try {
      const wavelet = new WaveletFilter(30, 6);

      // Create noisy signal
      const signal = new Float64Array(100);
      for (let i = 0; i < 100; i++) {
        signal[i] = Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.5;
      }

      const denoised = wavelet.denoise(signal, 0.15);
      const baselineRemoved = wavelet.removeBaselineWander(signal);

      const passed = denoised.length === signal.length && baselineRemoved.length === signal.length;
      this.results.set('Wavelet', passed);
      console.log(`  ${passed ? '✅' : '❌'} Wavelet: Denoised length=${denoised.length}`);
    } catch (error) {
      this.results.set('Wavelet', false);
      console.log(`  ❌ Wavelet: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test LMS Adaptive Filter
   */
  testLMS(): void {
    console.log('Testing LMS Adaptive Filter...');
    try {
      const lms = new LMSAdaptiveFilter(16, 0.01, true);

      // Create signal with noise
      const primary = new Float64Array(50);
      const reference = new Float64Array(50);

      for (let i = 0; i < 50; i++) {
        primary[i] = Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.3;
        reference[i] = (Math.random() - 0.5) * 0.5;
      }

      const result = lms.processBatch(primary, reference);
      const metrics = lms.getConvergenceMetrics();

      const passed = result.output.length === 50;
      this.results.set('LMS', passed);
      console.log(`  ${passed ? '✅' : '❌'} LMS: Converged=${metrics.converged}, Error=${metrics.steadyStateError.toFixed(4)}`);
    } catch (error) {
      this.results.set('LMS', false);
      console.log(`  ❌ LMS: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test RLS Adaptive Filter
   */
  testRLS(): void {
    console.log('Testing RLS Adaptive Filter...');
    try {
      const rls = new RLSAdaptiveFilter(16, 0.99, 0.01);

      const primary = new Float64Array(50);
      const reference = new Float64Array(50);

      for (let i = 0; i < 50; i++) {
        primary[i] = Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.3;
        reference[i] = (Math.random() - 0.5) * 0.5;
      }

      const result = rls.processBatch(primary, reference);
      const metrics = rls.getConvergenceMetrics();

      const passed = result.output.length === 50;
      this.results.set('RLS', passed);
      console.log(`  ${passed ? '✅' : '❌'} RLS: Converged=${metrics.converged}, Error=${metrics.steadyStateError.toFixed(4)}`);
    } catch (error) {
      this.results.set('RLS', false);
      console.log(`  ❌ RLS: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test ICA Processor
   */
  testICA(): void {
    console.log('Testing ICA Processor...');
    try {
      const ica = new ICAProcessor(3, 50, 1e-6, 'tanh');

      // Create mixed signals
      const signal1 = new Float64Array(100);
      const signal2 = new Float64Array(100);
      const signal3 = new Float64Array(100);

      for (let i = 0; i < 100; i++) {
        signal1[i] = Math.sin(i * 0.1) + (Math.random() - 0.5) * 0.2;
        signal2[i] = Math.cos(i * 0.15) + (Math.random() - 0.5) * 0.2;
        signal3[i] = Math.sin(i * 0.05) + (Math.random() - 0.5) * 0.2;
      }

      const result = ica.process([signal1, signal2, signal3]);

      const passed = result.components.length === 3 && result.convergenceIterations > 0;
      this.results.set('ICA', passed);
      console.log(`  ${passed ? '✅' : '❌'} ICA: Components=${result.components.length}, Iterations=${result.convergenceIterations}`);
    } catch (error) {
      this.results.set('ICA', false);
      console.log(`  ❌ ICA: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test Kalman Filter
   */
  testKalman(): void {
    console.log('Testing Kalman Filter...');
    try {
      const kalman = new KalmanFilter(72, 1/30, 0.1, 5.0);

      // Update with noisy measurements
      for (let i = 0; i < 30; i++) {
        const measurement = 72 + (Math.random() - 0.5) * 10;
        kalman.update(measurement);
      }

      const state = kalman.getState();
      const passed = Math.abs(state.heartRate - 72) < 5;

      this.results.set('Kalman', passed);
      console.log(`  ${passed ? '✅' : '❌'} Kalman: HR=${state.heartRate.toFixed(1)}, Derivative=${state.heartRateDerivative.toFixed(2)}`);
    } catch (error) {
      this.results.set('Kalman', false);
      console.log(`  ❌ Kalman: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test Bayesian Fusion
   */
  testBayesianFusion(): void {
    console.log('Testing Bayesian Fusion...');
    try {
      const fusion = new BayesianFusion(72, 15);

      const measurements = [
        { value: 70, uncertainty: 3, reliability: 0.9 },
        { value: 74, uncertainty: 4, reliability: 0.8 },
        { value: 72, uncertainty: 2, reliability: 0.95 }
      ];

      const result = fusion.fuse(measurements);

      const passed = Math.abs(result.fusedValue - 72) < 3 && result.confidence > 0.5;
      this.results.set('BayesianFusion', passed);
      console.log(`  ${passed ? '✅' : '❌'} Bayesian: Fused=${result.fusedValue.toFixed(1)}, Confidence=${result.confidence.toFixed(2)}`);
    } catch (error) {
      this.results.set('BayesianFusion', false);
      console.log(`  ❌ Bayesian: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test Particle Filter
   */
  testParticleFilter(): void {
    console.log('Testing Particle Filter...');
    try {
      const pf = new ParticleFilter(100, 0.5, 2.0);

      for (let i = 0; i < 30; i++) {
        const measurement = 72 + (Math.random() - 0.5) * 10;
        pf.update(measurement, 3);
      }

      const stats = pf.getStatistics();
      const passed = Math.abs(stats.mean - 72) < 5;

      this.results.set('ParticleFilter', passed);
      console.log(`  ${passed ? '✅' : '❌'} Particle Filter: Mean=${stats.mean.toFixed(1)}, Std=${stats.std.toFixed(2)}`);
    } catch (error) {
      this.results.set('ParticleFilter', false);
      console.log(`  ❌ Particle Filter: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Test EMD Processor
   */
  testEMD(): void {
    console.log('Testing EMD Processor...');
    try {
      const emd = new EMDProcessor(8, 10, 0.05);

      const signal = new Float64Array(200);
      for (let i = 0; i < 200; i++) {
        signal[i] = Math.sin(i * 0.1) + 0.5 * Math.sin(i * 0.05) + (Math.random() - 0.5) * 0.3;
      }

      const result = emd.decompose(signal);
      const denoised = emd.denoise(signal, 3);

      const passed = result.imfs.length > 0 && denoised.length === signal.length;
      this.results.set('EMD', passed);
      console.log(`  ${passed ? '✅' : '❌'} EMD: IMFs=${result.imfs.length}, Denoised length=${denoised.length}`);
    } catch (error) {
      this.results.set('EMD', false);
      console.log(`  ❌ EMD: Error - ${(error as Error).message}`);
    }
  }

  /**
   * Get test results
   */
  getResults(): Map<string, boolean> {
    return this.results;
  }
}

/**
 * Run tests when executed directly
 */
if (typeof window === 'undefined') {
  const suite = new AlgorithmTestSuite();
  suite.runAllTests();
}
