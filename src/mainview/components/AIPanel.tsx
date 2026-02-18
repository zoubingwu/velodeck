import { useMemoizedFn } from "ahooks";
import {
  EraserIcon,
  Loader,
  SendHorizonal,
  StopCircleIcon,
} from "lucide-react";
import React, {
  KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import TextareaAutosize from "react-textarea-autosize";
import type { services } from "@/bridge";
import { CancelAgentRun, EventsOn, StartAgentRun } from "@/bridge";
import { Button } from "@/components/ui/button";
import { LoadingTypewriter } from "@/components/ui/loading-typewriter";

type DisplayBlock = {
  id: string;
  type: "user" | "event" | "status" | "error" | "system";
  content: string;
  source?: "stdout" | "stderr";
};

interface AIPanelProps {
  opened?: boolean;
}

export const AIPanel = ({ opened }: AIPanelProps) => {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [maxRows, setMaxRows] = useState(2);
  const [displayBlocks, setDisplayBlocks] = useState<DisplayBlock[]>([]);
  const currentRunIdRef = useRef<string>("");
  const pendingStartRef = useRef(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId();

  const appendDisplayBlock = useMemoizedFn((block: DisplayBlock) => {
    setDisplayBlocks((prev) => [...prev, block]);
  });

  const clearMessages = useMemoizedFn(() => {
    setDisplayBlocks([
      {
        id: `${uniqueId}-${Date.now()}-session`,
        type: "system",
        content: "--- Started a new session ---",
      },
    ]);
  });

  const handleSubmit = useMemoizedFn(async () => {
    if (!inputValue.trim() || isLoading) {
      return;
    }

    const prompt = inputValue.trim();
    setInputValue("");

    appendDisplayBlock({
      id: `${uniqueId}-${Date.now()}-user`,
      type: "user",
      content: prompt,
    });

    try {
      pendingStartRef.current = true;
      setIsLoading(true);
      const { runId } = await StartAgentRun({ prompt });
      currentRunIdRef.current = runId;
      pendingStartRef.current = false;
      appendDisplayBlock({
        id: `${uniqueId}-${Date.now()}-status`,
        type: "status",
        content: `[run:${runId}] started`,
      });
    } catch (error) {
      pendingStartRef.current = false;
      setIsLoading(false);
      appendDisplayBlock({
        id: `${uniqueId}-${Date.now()}-error`,
        type: "error",
        content:
          error instanceof Error
            ? error.message
            : String(error ?? "unknown error"),
      });
    }
  });

  const handleStop = useMemoizedFn(async () => {
    const runId = currentRunIdRef.current;
    if (!runId) {
      return;
    }

    try {
      await CancelAgentRun({ runId });
    } catch (error) {
      appendDisplayBlock({
        id: `${uniqueId}-${Date.now()}-cancel-error`,
        type: "error",
        content:
          error instanceof Error
            ? error.message
            : String(error ?? "unknown error"),
      });
      setIsLoading(false);
    }
  });

  useEffect(() => {
    const cleanupEvent = EventsOn("agent:run:event", (payload) => {
      const eventPayload = payload as services.AgentRunEventPayload;

      if (!currentRunIdRef.current && pendingStartRef.current) {
        currentRunIdRef.current = eventPayload.runId;
      }

      if (eventPayload.runId !== currentRunIdRef.current) {
        return;
      }

      appendDisplayBlock({
        id: `${uniqueId}-${Date.now()}-event`,
        type: "event",
        source: eventPayload.source,
        content: eventPayload.raw,
      });
    });

    const cleanupStatus = EventsOn("agent:run:status", (payload) => {
      const statusPayload = payload as services.AgentRunStatusPayload;

      if (!currentRunIdRef.current && pendingStartRef.current) {
        currentRunIdRef.current = statusPayload.runId;
      }

      if (statusPayload.runId !== currentRunIdRef.current) {
        return;
      }

      appendDisplayBlock({
        id: `${uniqueId}-${Date.now()}-status`,
        type: "status",
        content: JSON.stringify(statusPayload),
      });

      if (
        statusPayload.status === "completed" ||
        statusPayload.status === "failed" ||
        statusPayload.status === "cancelled"
      ) {
        pendingStartRef.current = false;
        setIsLoading(false);
        currentRunIdRef.current = "";
      }
    });

    return () => {
      cleanupEvent();
      cleanupStatus();
    };
  }, [appendDisplayBlock, uniqueId]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const container = scrollAreaRef.current;
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    }
  }, [displayBlocks]);

  useEffect(() => {
    requestAnimationFrame(() => {
      setMaxRows(opened ? 10 : 2);
    });
  }, [opened]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const renderMessage = (message: DisplayBlock, index: number) => {
    let baseClasses = "rounded-md break-words text-sm w-full";
    if (index > 0) {
      baseClasses += " my-2";
    } else {
      baseClasses += " mb-2";
    }

    switch (message.type) {
      case "user":
        return (
          <div
            className={`user ${baseClasses} bg-muted mb-2 p-2 select-text! whitespace-pre-wrap`}
          >
            {message.content}
          </div>
        );
      case "event":
        return (
          <div
            className={`event ${baseClasses} text-xs p-2 bg-background border border-muted rounded`}
          >
            <div className="text-muted-foreground mb-1">{message.source}</div>
            <pre className="whitespace-pre-wrap break-words">
              {message.content}
            </pre>
          </div>
        );
      case "status":
        return (
          <div
            className={`status ${baseClasses} text-xs text-muted-foreground whitespace-pre-wrap`}
          >
            {message.content}
          </div>
        );
      case "error":
        return (
          <div
            className={`error ${baseClasses} text-destructive whitespace-pre-wrap`}
          >
            {message.content}
          </div>
        );
      case "system":
        return (
          <div className={`system ${baseClasses} my-4 text-muted text-xs`}>
            <div className="text-center">{message.content}</div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col bg-muted/50">
      <div ref={scrollAreaRef} className="flex-1 overflow-auto px-4 py-2">
        {displayBlocks.length > 0 && (
          <div>
            {displayBlocks.map((message, index) => (
              <React.Fragment key={message.id}>
                {renderMessage(message, index)}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pb-2 flex-shrink-0 mt-2">
        <div className="bg-background rounded-md overflow-hidden text-sm">
          <TextareaAutosize
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask Codex agent..."
            disabled={isLoading}
            className="w-full resize-none p-2 outline-0 placeholder:text-neutral-400"
            autoComplete="off"
            autoCorrect="off"
            minRows={2}
            maxRows={maxRows}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex justify-between border-t border-muted p-2">
            {isLoading ? (
              <div className="flex items-center gap-1 text-muted-foreground">
                <LoadingTypewriter className="text-xs">
                  Running Codex
                </LoadingTypewriter>
                <Loader className="size-3 animate-spin" />
              </div>
            ) : (
              <div className="flex items-center gap-1">
                {displayBlocks.length > 0 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={clearMessages}
                    aria-label="Clear messages"
                    className="size-6 text-muted-foreground hover:text-foreground"
                  >
                    <EraserIcon className="size-3" />
                  </Button>
                )}
              </div>
            )}

            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={!isLoading && !inputValue.trim()}
              aria-label="Send message"
              onClick={() => {
                if (isLoading) {
                  void handleStop();
                } else {
                  void handleSubmit();
                }
              }}
            >
              {isLoading ? (
                <StopCircleIcon className="size-3" />
              ) : (
                <SendHorizonal className="size-3" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
