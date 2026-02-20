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
import ReactMarkdown from "react-markdown";
import TextareaAutosize from "react-textarea-autosize";
import remarkGfm from "remark-gfm";
import { type AgentSQLApprovalRequestPayload, api, onEvent } from "@/bridge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { LoadingTypewriter } from "@/components/ui/loading-typewriter";

type DisplayBlock = {
  id: string;
  type: "user" | "assistant" | "status" | "error" | "system";
  content: string;
};

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  return input as Record<string, unknown>;
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");
}

function extractTextFromPart(part: unknown): string[] {
  const record = asRecord(part);
  if (!record) {
    return [];
  }

  const results: string[] = [];
  if (typeof record.text === "string" && record.text.trim()) {
    results.push(record.text.trim());
  }
  if (typeof record.markdown === "string" && record.markdown.trim()) {
    results.push(record.markdown.trim());
  }

  const content = record.content;
  if (Array.isArray(content)) {
    for (const entry of content) {
      results.push(...extractTextFromPart(entry));
    }
  }

  const message = record.message;
  if (message) {
    results.push(...extractTextFromPart(message));
  }

  return results;
}

function extractAssistantMarkdown(parsed: unknown): string {
  const payload = asRecord(parsed);
  if (!payload) {
    return "";
  }

  const type = typeof payload.type === "string" ? payload.type : "";

  if (type === "item.completed") {
    const item = asRecord(payload.item);
    if (!item) {
      return "";
    }

    if (item.type === "reasoning") {
      return "";
    }

    return Array.from(new Set(extractTextFromPart(item)))
      .join("\n\n")
      .trim();
  }

  if (type === "response.completed") {
    const response = asRecord(payload.response);
    if (!response || !Array.isArray(response.output)) {
      return "";
    }

    const chunks: string[] = [];
    for (const outputItem of response.output) {
      const item = asRecord(outputItem);
      if (item?.type === "reasoning") {
        continue;
      }
      chunks.push(...extractTextFromPart(item));
    }
    return Array.from(new Set(chunks)).join("\n\n").trim();
  }

  return "";
}

function extractUserFacingError(raw: string, parsed: unknown): string {
  const payload = asRecord(parsed);

  const errorNode = payload ? asRecord(payload.error) : null;
  if (errorNode && typeof errorNode.message === "string") {
    return stripAnsi(errorNode.message).trim();
  }

  if (payload && typeof payload.message === "string") {
    return stripAnsi(payload.message).trim();
  }

  const clean = stripAnsi(raw).trim();
  if (!clean) {
    return "";
  }

  if (
    /^Usage:/i.test(clean) ||
    /^For more information/i.test(clean) ||
    /^tip:/i.test(clean)
  ) {
    return "";
  }

  return clean
    .replace(/^\[[^\]]+\]\s*/g, "")
    .replace(/\b(ERROR|WARN|INFO)\b[: ]*/gi, "")
    .trim();
}

interface AIPanelProps {
  opened?: boolean;
}

export const AIPanel = ({ opened }: AIPanelProps) => {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [maxRows, setMaxRows] = useState(2);
  const [displayBlocks, setDisplayBlocks] = useState<DisplayBlock[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<
    AgentSQLApprovalRequestPayload[]
  >([]);
  const [isResolvingApproval, setIsResolvingApproval] = useState(false);
  const currentRunIdRef = useRef<string>("");
  const lastAssistantMessageRef = useRef<string>("");
  const pendingStartRef = useRef(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId();

  const appendDisplayBlock = useMemoizedFn((block: DisplayBlock) => {
    setDisplayBlocks((prev) => [...prev, block]);
  });

  const clearMessages = useMemoizedFn(() => {
    lastAssistantMessageRef.current = "";
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
    lastAssistantMessageRef.current = "";

    appendDisplayBlock({
      id: `${uniqueId}-${Date.now()}-user`,
      type: "user",
      content: prompt,
    });

    try {
      pendingStartRef.current = true;
      setIsLoading(true);
      const { runId } = await api.agent.startRun({ prompt });
      currentRunIdRef.current = runId;
      pendingStartRef.current = false;
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
      await api.agent.cancelRun({ runId });
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

  const activeApproval = pendingApprovals[0] || null;

  const resolveActiveApproval = useMemoizedFn(
    async (decision: "approved" | "rejected") => {
      const approval = pendingApprovals[0];
      if (!approval || isResolvingApproval) {
        return;
      }

      setIsResolvingApproval(true);
      try {
        await api.agent.resolveSqlApproval({
          runId: approval.runId,
          approvalId: approval.approvalId,
          decision,
          reason:
            decision === "rejected" ? "rejected by user" : "approved by user",
        });
      } catch (error) {
        appendDisplayBlock({
          id: `${uniqueId}-${Date.now()}-approval-error`,
          type: "error",
          content:
            error instanceof Error
              ? error.message
              : String(error ?? "failed to resolve SQL approval"),
        });
      } finally {
        setIsResolvingApproval(false);
      }
    },
  );

  useEffect(() => {
    const cleanupEvent = onEvent("agent:run:event", (eventPayload) => {
      if (!currentRunIdRef.current && pendingStartRef.current) {
        currentRunIdRef.current = eventPayload.runId;
      }

      if (eventPayload.runId !== currentRunIdRef.current) {
        return;
      }

      const assistantMarkdown = extractAssistantMarkdown(eventPayload.parsed);
      if (assistantMarkdown) {
        if (assistantMarkdown === lastAssistantMessageRef.current) {
          return;
        }
        lastAssistantMessageRef.current = assistantMarkdown;
        appendDisplayBlock({
          id: `${uniqueId}-${Date.now()}-assistant`,
          type: "assistant",
          content: assistantMarkdown,
        });
        return;
      }

      if (eventPayload.source === "stderr") {
        const message = extractUserFacingError(
          eventPayload.raw,
          eventPayload.parsed,
        );
        if (message) {
          appendDisplayBlock({
            id: `${uniqueId}-${Date.now()}-stderr`,
            type: "error",
            content: message,
          });
        }
      }
    });

    const cleanupStatus = onEvent("agent:run:status", (statusPayload) => {
      if (!currentRunIdRef.current && pendingStartRef.current) {
        currentRunIdRef.current = statusPayload.runId;
      }

      if (statusPayload.runId !== currentRunIdRef.current) {
        return;
      }

      if (statusPayload.status === "failed") {
        appendDisplayBlock({
          id: `${uniqueId}-${Date.now()}-status-failed`,
          type: "error",
          content:
            statusPayload.error ||
            `Agent run failed (exit code ${statusPayload.exitCode ?? "unknown"})`,
        });
      }

      if (
        statusPayload.status === "completed" ||
        statusPayload.status === "failed" ||
        statusPayload.status === "cancelled"
      ) {
        pendingStartRef.current = false;
        setIsLoading(false);
        setPendingApprovals((prev) =>
          prev.filter((item) => item.runId !== statusPayload.runId),
        );
        lastAssistantMessageRef.current = "";
        currentRunIdRef.current = "";
      }
    });

    const cleanupApprovalRequested = onEvent(
      "agent:sql:approval:requested",
      (approvalPayload) => {
        if (!currentRunIdRef.current && pendingStartRef.current) {
          currentRunIdRef.current = approvalPayload.runId;
        }

        if (approvalPayload.runId !== currentRunIdRef.current) {
          return;
        }

        setPendingApprovals((prev) => [...prev, approvalPayload]);
      },
    );

    const cleanupApprovalResolved = onEvent(
      "agent:sql:approval:resolved",
      (resolvedPayload) => {
        setPendingApprovals((prev) =>
          prev.filter((item) => item.approvalId !== resolvedPayload.approvalId),
        );

        if (resolvedPayload.runId !== currentRunIdRef.current) {
          return;
        }
      },
    );

    return () => {
      cleanupEvent();
      cleanupStatus();
      cleanupApprovalRequested();
      cleanupApprovalResolved();
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
      case "assistant":
        return (
          <div
            className={`assistant ${baseClasses} bg-background border border-muted rounded p-3 prose prose-sm max-w-none`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
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

      <AlertDialog
        open={Boolean(activeApproval)}
        onOpenChange={() => {
          /* approval dialog is controlled by backend state */
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve write SQL?</AlertDialogTitle>
            <AlertDialogDescription>
              This statement was classified as write SQL and requires your
              confirmation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="max-h-64 overflow-auto rounded border p-2 text-xs whitespace-pre-wrap break-words">
            {activeApproval?.query || ""}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isResolvingApproval}
              onClick={(event) => {
                event.preventDefault();
                void resolveActiveApproval("rejected");
              }}
            >
              Reject
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isResolvingApproval}
              onClick={(event) => {
                event.preventDefault();
                void resolveActiveApproval("approved");
              }}
            >
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
