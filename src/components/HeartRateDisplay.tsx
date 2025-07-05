interface HeartRateDisplayProps {
  bpm: number;
  confidence: number;
}

import { HeartRate } from '@/components/HeartRate';

/*
 * @deprecated Use HeartRate component from '@/components/HeartRate' instead
 */
export default function HeartRateDisplay({ bpm, confidence }: HeartRateDisplayProps) {
  return <HeartRate bpm={bpm} confidence={confidence} animated={false} />;
}
