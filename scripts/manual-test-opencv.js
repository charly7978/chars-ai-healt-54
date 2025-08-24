/**
 * Manual Test Script for OpenCV Integration
 * 
 * This script provides a simple way to test the OpenCV integration
 * without requiring a full test runner setup.
 * 
 * To run:
 * node scripts/manual-test-opencv.js
 */

// Mock the native module for testing (ES module version)
const mockModule = {
  calibrateCamera: jest.fn((pattern, width, height, reject, resolve) => {
    console.log(`[MOCK] calibrateCamera called with:`, { pattern, width, height });
    resolve({ success: true, message: 'Calibration started' });
  }),
  getCalibrationStatus: jest.fn((reject, resolve) => {
    console.log('[MOCK] getCalibrationStatus called');
    resolve({ isCalibrated: false, progress: 0, message: 'Calibration in progress' });
  })
};

// Mock the NativeModules object
jest.mock('react-native', () => ({
  NativeModules: {
    CameraCalibrationModule: mockModule
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn((event, callback) => {
      console.log(`[MOCK] Added listener for event: ${event}`);
      return { remove: () => console.log(`[MOCK] Removed listener for event: ${event}`) };
    }),
    removeListener: jest.fn((event, callback) => {
      console.log(`[MOCK] Removed listener for event: ${event}`);
    })
  }))
}));

// Import the module we want to test (using dynamic import for ES modules)
import CameraCalibration from '../src/native-modules/CameraCalibration.ts';

// Test cases
async function runTests() {
  console.log('=== Starting OpenCV Integration Tests ===\n');
  
  // Test 1: Verify singleton pattern
  console.log('Test 1: Verify singleton pattern');
  const module1 = await import('../src/native-modules/CameraCalibration.ts');
  const module2 = await import('../src/native-modules/CameraCalibration.ts');
  const instance1 = module1.default;
  const instance2 = module2.default;
  console.log(`  ✓ Instances are the same: ${instance1 === instance2 ? 'PASS' : 'FAIL'}`);
  
  // Test 2: Test calibrateCamera
  console.log('\nTest 2: Test calibrateCamera');
  try {
    const result = await CameraCalibration.calibrateCamera('chessboard', 9, 6);
    console.log('  ✓ calibrateCamera resolved successfully');
    console.log('     Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('  ✗ calibrateCamera failed:', error);
  }
  
  // Test 3: Test getCalibrationStatus
  console.log('\nTest 3: Test getCalibrationStatus');
  try {
    const status = await CameraCalibration.getCalibrationStatus();
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
  
  const removeProgressListener = CameraCalibration.addProgressListener(progressCallback);
  const removeCompletionListener = CameraCalibration.addCompletionListener(completionCallback);
  
  // Simulate some events
  console.log('  ✓ Added progress and completion listeners');
  
  // Clean up
  removeProgressListener();
  removeCompletionListener();
  console.log('  ✓ Removed all listeners');
  
  console.log('\n=== Test Summary ===');
  console.log('All manual tests completed. Check the output above for any failures.');
}

// Run the tests
runTests().catch(console.error);
