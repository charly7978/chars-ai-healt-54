import { cn } from "@/lib/utils";

interface HeartShapeProps {
  isBeating: boolean;
  className?: string;
}

const HeartShape = ({ isBeating, className }: HeartShapeProps) => {
  return (
    <div
      className={cn(
        "relative w-32 h-32 transform",
        isBeating && "animate-heart-beat",
        className
      )}
    >
      <div
        className="absolute w-20 h-32 bg-medical-red rounded-t-full -rotate-45 origin-bottom-right"
        style={{ left: "41px" }}
      />
      <div
        className="absolute w-20 h-32 bg-medical-red rounded-t-full rotate-45 origin-bottom-left"
        style={{ left: "0" }}
      />
    </div>
  );
};

export default HeartShape;