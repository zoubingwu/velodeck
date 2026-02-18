import { memo, useEffect, useRef, useState } from "react";

const ROW_HEIGHT_PX = 36;

const TablePlaceholder = ({
  animate,
  striped = "odd",
}: { animate?: boolean; striped?: "odd" | "even" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numberOfRows, setNumberOfRows] = useState(10); // Start with a default

  useEffect(() => {
    const calculateRows = () => {
      if (containerRef.current) {
        const containerHeight = containerRef.current.clientHeight;
        const calculatedRows = Math.ceil(containerHeight / ROW_HEIGHT_PX);
        setNumberOfRows(calculatedRows > 0 ? calculatedRows : 1); // Ensure at least 1 row
      }
    };

    calculateRows(); // Initial calculation

    // Recalculate on resize
    window.addEventListener("resize", calculateRows);

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener("resize", calculateRows);
    };
  }, []); // Empty dependency array ensures this runs once on mount and cleans up on unmount

  // Create an array based on the calculated number of rows
  const rows = Array.from({ length: numberOfRows }, (_, i) => i);

  return (
    // Add the ref to the container
    <div
      ref={containerRef}
      id="table-placeholder"
      className={`h-full w-full overflow-hidden flex-grow absolute z-0`}
      aria-hidden="true"
    >
      <div className="flex h-full w-full flex-col">
        {rows.map((index) => (
          <div
            key={index}
            className={`w-full flex-shrink-0 ${
              animate ? "animate-pulse" : ""
            } ${
              (index + (striped === "odd" ? 0 : 1)) % 2 !== 0
                ? "bg-muted/25"
                : ""
            }`}
            style={{ height: `${ROW_HEIGHT_PX}px` }}
          ></div>
        ))}
      </div>
    </div>
  );
};

export default memo(TablePlaceholder);
