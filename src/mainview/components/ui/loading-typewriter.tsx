import { cn } from "@/lib/utils";

export const LoadingTypewriter = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div className={cn("flex items-center", className)}>
      {children}
      <span className="relative w-[max-content] before:absolute before:inset-0 before:bg-background before:animate-typewriter">
        ...
      </span>
    </div>
  );
};
