import { cn } from "@/lib/utils";
import styles from './HeartShape.module.css';

interface HeartShapeProps {
  isBeating: boolean;
  className?: string;
}

const HeartShape = ({ isBeating, className }: HeartShapeProps) => {
  return (
    <div
      className={cn(
        styles.heartContainer,
        isBeating && styles.animateHeartBeat,
        className
      )}
    >
      <div className={styles.heartLeft} />
      <div className={styles.heartRight} />
    </div>
  );
};

export default HeartShape;