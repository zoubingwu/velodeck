import { memo } from "react";
import {
  WindowIsMaximised,
  WindowMaximise,
  WindowUnmaximise,
} from "@/bridge";

function TitleBar({ title }: { title: string }) {
  const onDoubleClick = async () => {
    if (await WindowIsMaximised()) {
      WindowUnmaximise();
    } else {
      WindowMaximise();
    }
  };
  return (
    <div
      onDoubleClick={onDoubleClick}
      className="h-[28px] bg-[var(--card)] text-[var(--card-foreground)] flex justify-center items-center select-none text-xs border-b border-[var(--muted)]/30 flex-shrink-0 electrobun-webkit-app-region-drag"
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{title}</span>
      </div>
    </div>
  );
}

export default memo(TitleBar);
