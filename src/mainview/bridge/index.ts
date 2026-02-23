import {
  type AgentSQLApprovalResolveInput,
  APP_EVENTS,
  type AppEventName,
  type AppEventPayloadMap,
  type AppRpcError,
  type CancelAgentRunInput,
  type ConnectionProfile,
  type DataEntityRef,
  type ExtractMetadataInput,
  type ReadEntityInput,
  type StartAgentRunInput,
  type StartAgentRunOutput,
  type ThemeSettings,
  type WindowSettings,
} from "@shared/contracts";
import type { AppRPCSchema } from "@shared/rpc-schema";
import { Electroview } from "electrobun/view";

export { APP_EVENTS };
export type * from "@shared/contracts";

const CONNECTION_METHODS = new Set(["connectUsingSaved", "testConnection"]);

function isTimeoutError(message: string): boolean {
  return (
    message.includes("rpc timeout") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

function toFriendlyErrorMessage(rawMessage: string, method?: string): string {
  const message = rawMessage.trim();
  const lower = message.toLowerCase();

  if (isTimeoutError(lower)) {
    if (method === "pickSQLiteFile") {
      return "File picker timed out. Please try again.";
    }

    if (method && CONNECTION_METHODS.has(method)) {
      return "Connection timed out. Check host, port, network, TLS settings, or TiDB Cloud allowlist.";
    }

    return "Request timed out. Please try again.";
  }

  if (
    method &&
    CONNECTION_METHODS.has(method) &&
    (lower.includes("econnrefused") || lower.includes("connection refused"))
  ) {
    return "Connection was refused by the server. Verify host/port and whether the database is reachable.";
  }

  if (
    method &&
    CONNECTION_METHODS.has(method) &&
    (lower.includes("enotfound") ||
      lower.includes("eai_again") ||
      lower.includes("getaddrinfo"))
  ) {
    return "Cannot resolve database host. Check the host name and DNS/network settings.";
  }

  if (
    method &&
    CONNECTION_METHODS.has(method) &&
    lower.includes("access denied")
  ) {
    return "Authentication failed. Check username/password and account permissions.";
  }

  if (
    method &&
    CONNECTION_METHODS.has(method) &&
    (lower.includes("tls") ||
      lower.includes("ssl") ||
      lower.includes("certificate"))
  ) {
    return "TLS/SSL verification failed. Check TLS settings and certificates.";
  }

  return message;
}

function normalizeBridgeError(error: unknown, method?: string): Error {
  if (error && typeof error === "object") {
    const candidate = error as Partial<AppRpcError> & {
      error?: Partial<AppRpcError>;
      message?: string;
    };

    if (typeof candidate.message === "string" && candidate.message.length > 0) {
      return new Error(toFriendlyErrorMessage(candidate.message, method));
    }

    if (candidate.error && typeof candidate.error.message === "string") {
      return new Error(toFriendlyErrorMessage(candidate.error.message, method));
    }
  }

  if (error instanceof Error) {
    return new Error(toFriendlyErrorMessage(error.message, method));
  }

  return new Error(toFriendlyErrorMessage(String(error), method));
}

const webviewRPC = Electroview.defineRPC<AppRPCSchema>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {},
    messages: {},
  },
});

const electroview = new Electroview({
  rpc: webviewRPC,
});

function getRPC() {
  if (!electroview.rpc) {
    throw new Error("RPC bridge is not initialized");
  }

  return electroview.rpc;
}

async function callRPC<T>(method: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw normalizeBridgeError(error, method);
  }
}

export function onEvent<EventName extends AppEventName>(
  eventName: EventName,
  callback: (payload: AppEventPayloadMap[EventName]) => void,
): () => void {
  const rpc = getRPC();
  const listener = (payload: AppEventPayloadMap[EventName]) => {
    callback(payload);
  };

  rpc.addMessageListener(eventName, listener);

  return () => {
    rpc.removeMessageListener(eventName, listener);
  };
}

export const api = {
  connection: {
    connectUsingSaved: (input: { connectionId: string }) =>
      callRPC("connectUsingSaved", () =>
        getRPC().request.connectUsingSaved(input),
      ),
    deleteSavedConnection: (input: { connectionId: string }) =>
      callRPC("deleteSavedConnection", () =>
        getRPC().request.deleteSavedConnection(input),
      ),
    disconnect: () =>
      callRPC("disconnect", () => getRPC().request.disconnect({})),
    getActiveConnection: () =>
      callRPC("getActiveConnection", () =>
        getRPC().request.getActiveConnection({}),
      ),
    listSavedConnections: () =>
      callRPC("listSavedConnections", () =>
        getRPC().request.listSavedConnections({}),
      ),
    saveConnection: (input: { profile: ConnectionProfile }) =>
      callRPC("saveConnection", () => getRPC().request.saveConnection(input)),
    testConnection: (input: { profile: ConnectionProfile }) =>
      callRPC("testConnection", () => getRPC().request.testConnection(input)),
    getConnectionCapabilities: () =>
      callRPC("getConnectionCapabilities", () =>
        getRPC().request.getConnectionCapabilities({}),
      ),
    getVersion: () =>
      callRPC("getVersion", () => getRPC().request.getVersion({})),
  },
  query: {
    executeSQL: (input: { query: string }) =>
      callRPC("executeSQL", () => getRPC().request.executeSQL(input)),
    listConnectors: () =>
      callRPC("listConnectors", () => getRPC().request.listConnectors({})),
    listExplorerNodes: (input: { parentNodeId?: string | null }) =>
      callRPC("listExplorerNodes", () =>
        getRPC().request.listExplorerNodes(input),
      ),
    readEntity: (input: ReadEntityInput) =>
      callRPC("readEntity", () => getRPC().request.readEntity(input)),
    getEntitySchema: (input: { entity: DataEntityRef }) =>
      callRPC("getEntitySchema", () => getRPC().request.getEntitySchema(input)),
  },
  metadata: {
    getConnectionMetadata: () =>
      callRPC("getConnectionMetadata", () =>
        getRPC().request.getConnectionMetadata({}),
      ),
    extractConnectionMetadata: (input: ExtractMetadataInput) =>
      callRPC("extractConnectionMetadata", () =>
        getRPC().request.extractConnectionMetadata(input),
      ),
  },
  settings: {
    getThemeSettings: () =>
      callRPC("getThemeSettings", () => getRPC().request.getThemeSettings({})),
    saveThemeSettings: (input: { settings: ThemeSettings }) =>
      callRPC("saveThemeSettings", () =>
        getRPC().request.saveThemeSettings(input),
      ),
    getWindowSettings: () =>
      callRPC("getWindowSettings", () =>
        getRPC().request.getWindowSettings({}),
      ),
    saveWindowSettings: (input: { settings: WindowSettings }) =>
      callRPC("saveWindowSettings", () =>
        getRPC().request.saveWindowSettings(input),
      ),
  },
  window: {
    isMaximised: () =>
      callRPC("windowIsMaximised", () =>
        getRPC().request.windowIsMaximised({}),
      ),
    maximise: () =>
      callRPC("windowMaximise", () => getRPC().request.windowMaximise({})),
    unmaximise: () =>
      callRPC("windowUnmaximise", () => getRPC().request.windowUnmaximise({})),
    getClipboardText: () =>
      callRPC("clipboardGetText", () => getRPC().request.clipboardGetText({})),
    pickSQLiteFile: (input: { currentPath?: string }) =>
      callRPC("pickSQLiteFile", () => getRPC().request.pickSQLiteFile(input)),
  },
  agent: {
    startRun: (input: StartAgentRunInput): Promise<StartAgentRunOutput> =>
      callRPC("startAgentRun", () => getRPC().request.startAgentRun(input)),
    cancelRun: (input: CancelAgentRunInput) =>
      callRPC("cancelAgentRun", () => getRPC().request.cancelAgentRun(input)),
    resolveSqlApproval: (input: AgentSQLApprovalResolveInput) =>
      callRPC("resolveAgentSQLApproval", () =>
        getRPC().request.resolveAgentSQLApproval(input),
      ),
  },
};

export type AppAPI = typeof api;
