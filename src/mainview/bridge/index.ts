import {
  type AppEventName,
  type AppRpcError,
  appEventEnvelopeSchema,
  type CancelAgentRunInput,
  type ConnectionDetails,
  type ConnectionMetadata,
  type ExtractMetadataInput,
  type SQLResult,
  type StartAgentRunInput,
  type StartAgentRunOutput,
  type TableDataResponse,
  type TableSchema,
  type ThemeSettings,
  type WindowSettings,
} from "@shared/contracts";
import { Electroview } from "electrobun/view";

export type { services } from "./models";

type EventHandler = (payload?: any) => void;

const listeners = new Map<string, Set<EventHandler>>();

function emitLocal(eventName: string, payload?: unknown): void {
  const handlers = listeners.get(eventName);
  if (!handlers) {
    return;
  }

  for (const handler of handlers) {
    handler(payload);
  }
}

function toFriendlyErrorMessage(rawMessage: string): string {
  const message = rawMessage.trim();
  const lower = message.toLowerCase();

  if (
    lower.includes("rpc timeout") ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return "Connection timed out. Check host, port, network, TLS settings, or TiDB Cloud allowlist.";
  }

  if (lower.includes("econnrefused") || lower.includes("connection refused")) {
    return "Connection was refused by the server. Verify host/port and whether the database is reachable.";
  }

  if (
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("getaddrinfo")
  ) {
    return "Cannot resolve database host. Check the host name and DNS/network settings.";
  }

  if (lower.includes("access denied")) {
    return "Authentication failed. Check username/password and account permissions.";
  }

  if (
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("certificate")
  ) {
    return "TLS/SSL verification failed. Check TLS settings and certificates.";
  }

  return message;
}

function normalizeBridgeError(error: unknown): Error {
  if (error && typeof error === "object") {
    const candidate = error as Partial<AppRpcError> & {
      error?: Partial<AppRpcError>;
      message?: string;
    };

    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return new Error(toFriendlyErrorMessage(candidate.message));
    }

    if (candidate.error && typeof candidate.error.message === "string") {
      return new Error(toFriendlyErrorMessage(candidate.error.message));
    }
  }

  if (error instanceof Error) {
    return new Error(toFriendlyErrorMessage(error.message));
  }

  return new Error(toFriendlyErrorMessage(String(error)));
}

const webviewRPC = Electroview.defineRPC({
  handlers: {
    requests: {
      emitEvent(envelope: unknown): null {
        const parsed = appEventEnvelopeSchema.safeParse(envelope);
        if (!parsed.success) {
          return null;
        }

        const { eventName, payload } = parsed.data;
        emitLocal(eventName, payload);
        return null;
      },
    },
    messages: {},
  },
});

const electroview = new Electroview({
  rpc: webviewRPC,
});

async function rpcRequest<T>(method: string, payload?: unknown): Promise<T> {
  try {
    if (!electroview.rpc) {
      throw new Error("RPC bridge is not initialized");
    }

    const endpoint = (
      electroview.rpc.request as Record<
        string,
        (...args: unknown[]) => Promise<T>
      >
    )[method];
    if (typeof endpoint !== "function") {
      throw new Error(`RPC method '${method}' is not defined`);
    }

    if (payload === undefined) {
      return await endpoint();
    }

    return await endpoint(payload);
  } catch (error) {
    throw normalizeBridgeError(error);
  }
}

export function EventsOn(
  eventName: AppEventName | string,
  callback: EventHandler,
): () => void {
  const handlers = listeners.get(eventName) || new Set<EventHandler>();
  handlers.add(callback);
  listeners.set(eventName, handlers);

  return () => {
    const existing = listeners.get(eventName);
    if (!existing) {
      return;
    }

    existing.delete(callback);
    if (existing.size === 0) {
      listeners.delete(eventName);
    }
  };
}

export function EventsEmit(eventName: string, payload?: unknown): void {
  emitLocal(eventName, payload);
}

export async function ConnectUsingSaved(
  connectionId: string,
): Promise<ConnectionDetails> {
  return rpcRequest<ConnectionDetails>("ConnectUsingSaved", connectionId);
}

export async function DeleteSavedConnection(
  connectionId: string,
): Promise<void> {
  return rpcRequest<void>("DeleteSavedConnection", connectionId);
}

export async function Disconnect(): Promise<void> {
  return rpcRequest<void>("Disconnect");
}

export async function ExecuteSQL(query: string): Promise<SQLResult> {
  return rpcRequest<SQLResult>("ExecuteSQL", query);
}

export async function ExtractDatabaseMetadata(
  input: ExtractMetadataInput,
): Promise<ConnectionMetadata> {
  return rpcRequest<ConnectionMetadata>("ExtractDatabaseMetadata", input);
}

export async function GetActiveConnection(): Promise<ConnectionDetails | null> {
  return rpcRequest<ConnectionDetails | null>("GetActiveConnection");
}

export async function GetDatabaseMetadata(): Promise<ConnectionMetadata> {
  return rpcRequest<ConnectionMetadata>("GetDatabaseMetadata");
}

export async function GetTableData(
  dbName: string,
  tableName: string,
  limit: number,
  offset: number,
  filterParams: unknown,
): Promise<TableDataResponse> {
  return rpcRequest<TableDataResponse>("GetTableData", {
    dbName,
    tableName,
    limit,
    offset,
    filterParams,
  });
}

export async function GetTableSchema(
  dbName: string,
  tableName: string,
): Promise<TableSchema> {
  return rpcRequest<TableSchema>("GetTableSchema", {
    dbName,
    tableName,
  });
}

export async function GetThemeSettings(): Promise<ThemeSettings> {
  return rpcRequest<ThemeSettings>("GetThemeSettings");
}

export async function GetVersion(): Promise<string> {
  return rpcRequest<string>("GetVersion");
}

export async function GetWindowSettings(): Promise<WindowSettings> {
  return rpcRequest<WindowSettings>("GetWindowSettings");
}

export async function ListDatabases(): Promise<string[]> {
  return rpcRequest<string[]>("ListDatabases");
}

export async function ListSavedConnections(): Promise<
  Record<string, ConnectionDetails>
> {
  return rpcRequest<Record<string, ConnectionDetails>>("ListSavedConnections");
}

export async function ListTables(dbName: string): Promise<string[]> {
  return rpcRequest<string[]>("ListTables", dbName);
}

export async function SaveConnection(
  details: ConnectionDetails,
): Promise<string> {
  return rpcRequest<string>("SaveConnection", details);
}

export async function SaveThemeSettings(
  settings: ThemeSettings,
): Promise<void> {
  return rpcRequest<void>("SaveThemeSettings", settings);
}

export async function SaveWindowSettings(
  settings: WindowSettings,
): Promise<void> {
  return rpcRequest<void>("SaveWindowSettings", settings);
}

export async function TestConnection(
  details: ConnectionDetails,
): Promise<boolean> {
  return rpcRequest<boolean>("TestConnection", details);
}

export async function StartAgentRun(
  input: StartAgentRunInput,
): Promise<StartAgentRunOutput> {
  return rpcRequest<StartAgentRunOutput>("StartAgentRun", input);
}

export async function CancelAgentRun(
  input: CancelAgentRunInput,
): Promise<void> {
  return rpcRequest<void>("CancelAgentRun", input);
}

export async function WindowIsMaximised(): Promise<boolean> {
  return rpcRequest<boolean>("WindowIsMaximised");
}

export async function WindowMaximise(): Promise<void> {
  return rpcRequest<void>("WindowMaximise");
}

export async function WindowUnmaximise(): Promise<void> {
  return rpcRequest<void>("WindowUnmaximise");
}

export async function ClipboardGetText(): Promise<string> {
  return rpcRequest<string>("ClipboardGetText");
}
