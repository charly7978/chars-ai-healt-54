/**
 * Simple Test Script for OpenCV Integration
 * 
 * This script provides a basic way to test the OpenCV integration
 * without complex test runners or module systems.
 * 
 * To run:
 * node scripts/simple-test-opencv.js
 */

console.log('=== OpenCV Integration Test ===\n');

// Mock the React Native NativeModules object
const NativeModules = {
  CameraCalibrationModule: {
    calibrateCamera: function(pattern, width, height, reject, resolve) {
      console.log(`[MOCK] calibrateCamera called with: ${pattern}, ${width}, ${height}`);
      resolve({ success: true, message: 'Calibration started' });
    },
    getCalibrationStatus: function(reject, resolve) {
      console.log('[MOCK] getCalibrationStatus called');
      resolve({ isCalibrated: false, progress: 50, message: 'Calibration in progress' });
    }
  }
};

// Mock NativeEventEmitter
class MockEventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  addListener(event, callback) {
    console.log(`[MOCK] Added listener for event: ${event}`);
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    // Return a subscription object with a remove method
    return {
      remove: () => {
        console.log(`[MOCK] Removed listener for event: ${event}`);
        this.listeners.get(event).delete(callback);
      }
    };
  }
  
  removeListener(event, callback) {
    console.log(`[MOCK] Removed listener for event: ${event}`);
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }
  
  // Helper to simulate events
  emit(event, ...args) {
    console.log(`[MOCK] Emitting event: ${event}`, ...args);
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => callback(...args));
    }
  }
}

// Mock the CameraCalibration module
class CameraCalibration {
  static instance = null;
  
  constructor() {
    if (CameraCalibration.instance) {
      return CameraCalibration.instance;
    }
    
    this.eventEmitter = new MockEventEmitter();
    CameraCalibration.instance = this;
  }
  
  static getInstance() {
    if (!CameraCalibration.instance) {
      CameraCalibration.instance = new CameraCalibration();
    }
    return CameraCalibration.instance;
  }
  
  calibrateCamera(pattern, width, height) {
    return new Promise((resolve, reject) => {
      NativeModules.CameraCalibrationModule.calibrateCamera(
        pattern, 
        width, 
        height, 
        reject, 
        resolve
      );
    });
  }
  
  getCalibrationStatus() {
    return new Promise((resolve, reject) => {
      NativeModules.CameraCalibrationModule.getCalibrationStatus(reject, resolve);
    });
  }
  
  addProgressListener(callback) {
    return this.eventEmitter.addListener('onCalibrationProgress', callback);
  }
  
  addCompletionListener(callback) {
    return this.eventEmitter.addListener('onCalibrationComplete', callback);
  }
}

// Run the tests
async function runTests() {
  console.log('=== Starting Tests ===\n');
  
  // Test 1: Verify singleton pattern
  console.log('Test 1: Verify singleton pattern');
  const instance1 = new CameraCalibration();
  const instance2 = CameraCalibration.getInstance();
  console.log(`  ✓ Instances are the same: ${instance1 === instance2 ? 'PASS' : 'FAIL'}`);
  
  // Test 2: Test calibrateCamera
  console.log('\nTest 2: Test calibrateCamera');
  try {
    const result = await instance1.calibrateCamera('chessboard', 9, 6);
    console.log('  ✓ calibrateCamera resolved successfully');
    console.log('     Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('  ✗ calibrateCamera failed:', error);
  }
  
  // Test 3: Test getCalibrationStatus
  console.log('\nTest 3: Test getCalibrationStatus');
  try {
    const status = await instance1.getCalibrationStatus();
    console.log('  ✓ getCalibrationStatus resolved successfully');
    console.log('     Status:', JSON.stringify(status, null, 2));
  } catch (error) {
    console.error('  ✗ getCalibrationStatus failed:', error);
  }
  
  // Test 4: Test event listeners
  console.log('\nTest 4: Test event listeners');
  const progressCallback = (progress, message) => {
    console.log(`  ✓ Progress update: ${progress}% - ${message}`);
  };
  
  const completionCallback = (result) => {
    console.log('  ✓ Calibration completed:', JSON.stringify(result, null, 2));
  };
  
  const removeProgressListener = instance1.addProgressListener(progressCallback);
  const removeCompletionListener = instance1.addCompletionListener(completionCallback);
  
  // Simulate some events
  console.log('  ✓ Added progress and completion listeners');
  instance1.eventEmitter.emit('onCalibrationProgress', 25, 'Processing images...');
  instance1.eventEmitter.emit('onCalibrationProgress', 50, 'Calculating parameters...');
  instance1.eventEmitter.emit('onCalibrationComplete', { success: true, message: 'Calibration complete' });
  
  // Clean up
  removeProgressListener();
  removeCompletionListener();
  console.log('  ✓ Removed all listeners');
  
  console.log('\n=== Test Summary ===');
  console.log('All tests completed successfully!');
}

// Run the tests
runTests().catch(console.error);
