import { BrowserView } from "electrobun/bun";
import {
  APP_EVENTS,
  type AppRpcError,
  type ConnectionProfile,
  cancelAgentRunSchema,
  connectionProfileSchema,
  executeSQLSchema,
  extractMetadataSchema,
  getEntitySchemaSchema,
  listExplorerNodesSchema,
  pickSQLiteFileSchema,
  readEntitySchema,
  resolveAgentSQLApprovalSchema,
  startAgentRunSchema,
  themeSettingsSchema,
  windowSettingsSchema,
} from "../shared/contracts";
import type { AppRPCSchema } from "../shared/rpc-schema";
import { events } from "./events";
import { AgentMCPService } from "./services/agent-mcp-service";
import { AgentService } from "./services/agent-service";
import { ConfigService } from "./services/config-service";
import { ConnectorGatewayService } from "./services/connector-gateway-service";
import { logger } from "./services/logger-service";
import { MetadataService } from "./services/metadata-service";
import { SessionService } from "./services/session-service";

export const configService = new ConfigService();
export const connectorService = new ConnectorGatewayService();
export const metadataService = new MetadataService(
  configService,
  connectorService,
);
export const sessionService = new SessionService();
export const agentMCPService = new AgentMCPService(events, connectorService);
export const agentService = new AgentService(
  events,
  agentMCPService,
  sessionService,
  connectorService,
);

export type WindowController = {
  isMaximised: () => boolean;
  maximise: () => void;
  unmaximise: () => void;
  readClipboardText: () => string;
  pickSQLiteFile: (currentPath: string) => Promise<string>;
};

function toRpcError(
  error: unknown,
  fallbackCode = "INTERNAL_ERROR",
): AppRpcError {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return error as AppRpcError;
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
    };
  }

  return {
    code: fallbackCode,
    message: String(error),
  };
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new Error("request payload must be an object");
  }

  return payload as Record<string, unknown>;
}

function assertActiveConnection(): {
  connectionId: string;
  profile: ConnectionProfile;
} {
  const { id, profile } = sessionService.ensureActiveConnection();
  return {
    connectionId: id,
    profile,
  };
}

async function getVersionForConnection(
  profile: ConnectionProfile,
): Promise<string> {
  return connectorService.getVersion(profile);
}

async function attachVersion(
  connectionId: string,
  metadata: Awaited<ReturnType<typeof metadataService.getMetadata>>,
): Promise<void> {
  if (sessionService.getActiveConnectionId() !== connectionId) {
    return;
  }

  const activeConnection = sessionService.getActiveConnection();
  if (!activeConnection) {
    return;
  }

  try {
    metadata.version = await getVersionForConnection(activeConnection);
  } catch (error) {
    logger.warn(`failed to get database version: ${String(error)}`);
  }
}

function requireConnectionId(inputConnectionId?: string): string {
  if (inputConnectionId && inputConnectionId.trim()) {
    return inputConnectionId;
  }

  const activeId = sessionService.getActiveConnectionId();
  if (activeId) {
    return activeId;
  }

  throw new Error("connection ID is required");
}

function disconnectCurrentSession(): void {
  agentService.cancelAllRuns();
  sessionService.clearActiveConnection();
  void events.emit(APP_EVENTS.connectionDisconnected, null);
}

export function createBunRPC(windowController: WindowController) {
  return BrowserView.defineRPC<AppRPCSchema>({
    handlers: {
      requests: {
        async testConnection(payload: unknown): Promise<boolean> {
          try {
            const input = asRecord(payload);
            const profile = connectionProfileSchema.parse(input.profile);
            return await connectorService.testConnection(profile);
          } catch (error) {
            throw toRpcError(error, "TEST_CONNECTION_FAILED");
          }
        },

        async connectUsingSaved(payload: unknown): Promise<ConnectionProfile> {
          try {
            const input = asRecord(payload);
            const connectionId = input.connectionId;
            if (typeof connectionId !== "string" || !connectionId.trim()) {
              throw new Error("connection ID cannot be empty");
            }

            const { profile, found } =
              configService.getConnection(connectionId);
            if (!found) {
              throw new Error(`saved connection '${connectionId}' not found`);
            }

            await connectorService.testConnection(profile);
            sessionService.setActiveConnection(connectionId, profile);
            configService.recordConnectionUsage(connectionId);

            try {
              const metadata = metadataService.loadMetadata(connectionId);
              if (metadata.lastExtracted) {
                await events.emit(
                  APP_EVENTS.metadataExtractionCompleted,
                  metadata,
                );
              }
            } catch (metadataError) {
              await events.emit(
                APP_EVENTS.metadataExtractionFailed,
                metadataError instanceof Error
                  ? metadataError.message
                  : String(metadataError),
              );
            }

            const activeProfile = sessionService.getActiveConnection();
            if (!activeProfile) {
              throw new Error("active connection is empty after connect");
            }

            return activeProfile;
          } catch (error) {
            throw toRpcError(error, "CONNECT_FAILED");
          }
        },

        async disconnect(_payload: unknown): Promise<void> {
          disconnectCurrentSession();
        },

        async getActiveConnection(
          _payload: unknown,
        ): Promise<ConnectionProfile | null> {
          return sessionService.getActiveConnection();
        },

        async listSavedConnections(
          _payload: unknown,
        ): Promise<Record<string, ConnectionProfile>> {
          return configService.getAllConnections();
        },

        async saveConnection(payload: unknown): Promise<string> {
          try {
            const input = asRecord(payload);
            const profile = connectionProfileSchema.parse(input.profile);
            return configService.addOrUpdateConnection(profile);
          } catch (error) {
            throw toRpcError(error, "SAVE_CONNECTION_FAILED");
          }
        },

        async deleteSavedConnection(payload: unknown): Promise<void> {
          try {
            const input = asRecord(payload);
            const connectionId = input.connectionId;
            if (typeof connectionId !== "string" || !connectionId.trim()) {
              throw new Error("connection ID cannot be empty");
            }

            configService.deleteConnection(connectionId);
            metadataService.deleteConnectionMetadata(connectionId);

            if (sessionService.getActiveConnectionId() === connectionId) {
              disconnectCurrentSession();
            }
          } catch (error) {
            throw toRpcError(error, "DELETE_CONNECTION_FAILED");
          }
        },

        async executeSQL(payload: unknown) {
          try {
            const input = executeSQLSchema.parse(payload);
            const { profile } = assertActiveConnection();
            return await connectorService.executeSQL(profile, input.query);
          } catch (error) {
            throw toRpcError(error, "EXECUTE_SQL_FAILED");
          }
        },

        async getVersion(_payload: unknown): Promise<string> {
          try {
            const { profile } = assertActiveConnection();
            return await getVersionForConnection(profile);
          } catch (error) {
            throw toRpcError(error, "GET_VERSION_FAILED");
          }
        },

        async getConnectionCapabilities(_payload: unknown) {
          try {
            const { profile } = assertActiveConnection();
            return connectorService.getConnectionCapabilities(profile);
          } catch (error) {
            throw toRpcError(error, "GET_CAPABILITIES_FAILED");
          }
        },

        async listConnectors(_payload: unknown) {
          try {
            return connectorService.listConnectors();
          } catch (error) {
            throw toRpcError(error, "LIST_CONNECTORS_FAILED");
          }
        },

        async listExplorerNodes(payload: unknown) {
          try {
            const input = listExplorerNodesSchema.parse(payload || {});
            const { profile } = assertActiveConnection();
            return await connectorService.listExplorerNodes(
              profile,
              input.parentNodeId ?? null,
            );
          } catch (error) {
            throw toRpcError(error, "LIST_EXPLORER_NODES_FAILED");
          }
        },

        async readEntity(payload: unknown) {
          try {
            const input = readEntitySchema.parse(payload);
            const { profile } = assertActiveConnection();
            return await connectorService.readEntity(profile, input);
          } catch (error) {
            throw toRpcError(error, "READ_ENTITY_FAILED");
          }
        },

        async getEntitySchema(payload: unknown) {
          try {
            const input = getEntitySchemaSchema.parse(payload);
            const { profile } = assertActiveConnection();
            return await connectorService.getEntitySchema(
              profile,
              input.entity,
            );
          } catch (error) {
            throw toRpcError(error, "GET_ENTITY_SCHEMA_FAILED");
          }
        },

        async getThemeSettings(_payload: unknown) {
          return configService.getThemeSettings();
        },

        async saveThemeSettings(payload: unknown): Promise<void> {
          try {
            const input = asRecord(payload);
            const settings = themeSettingsSchema.parse(input.settings);
            configService.saveThemeSettings(settings);
          } catch (error) {
            throw toRpcError(error, "SAVE_THEME_SETTINGS_FAILED");
          }
        },

        async getWindowSettings(_payload: unknown) {
          return configService.getWindowSettings();
        },

        async saveWindowSettings(payload: unknown): Promise<void> {
          try {
            const input = asRecord(payload);
            const settings = windowSettingsSchema.parse(input.settings);
            configService.saveWindowSettings(settings);
          } catch (error) {
            throw toRpcError(error, "SAVE_WINDOW_SETTINGS_FAILED");
          }
        },

        async getConnectionMetadata(_payload: unknown) {
          try {
            const { connectionId } = assertActiveConnection();
            return metadataService.getMetadata(connectionId);
          } catch (error) {
            throw toRpcError(error, "GET_METADATA_FAILED");
          }
        },

        async extractConnectionMetadata(payload: unknown) {
          try {
            const input = extractMetadataSchema.parse(payload || {});
            const connectionId = requireConnectionId(input.connectionId);

            let metadata;
            if (input.force) {
              metadata = await metadataService.extractMetadata(
                connectionId,
                input.scopeNodeId || "",
              );
              metadataService.saveMetadata(connectionId);
            } else {
              metadata = metadataService.getMetadata(connectionId);
            }

            await attachVersion(connectionId, metadata);
            await events.emit(APP_EVENTS.metadataExtractionCompleted, metadata);
            return metadata;
          } catch (error) {
            const rpcError = toRpcError(error, "EXTRACT_METADATA_FAILED");
            await events.emit(
              APP_EVENTS.metadataExtractionFailed,
              rpcError.message,
            );
            throw rpcError;
          }
        },

        async startAgentRun(payload: unknown): Promise<{ runId: string }> {
          try {
            const input = startAgentRunSchema.parse(payload);
            const runId = await agentService.startRun(input.prompt);
            return { runId };
          } catch (error) {
            throw toRpcError(error, "START_AGENT_RUN_FAILED");
          }
        },

        async cancelAgentRun(payload: unknown): Promise<void> {
          try {
            const input = cancelAgentRunSchema.parse(payload);
            const cancelled = agentService.cancelRun(input.runId);
            if (!cancelled) {
              throw new Error(`agent run '${input.runId}' not found`);
            }
          } catch (error) {
            throw toRpcError(error, "CANCEL_AGENT_RUN_FAILED");
          }
        },

        async resolveAgentSQLApproval(payload: unknown): Promise<void> {
          try {
            const input = resolveAgentSQLApprovalSchema.parse(payload);
            await agentService.resolveSQLApproval(input);
          } catch (error) {
            throw toRpcError(error, "RESOLVE_AGENT_SQL_APPROVAL_FAILED");
          }
        },

        async windowIsMaximised(_payload: unknown): Promise<boolean> {
          return windowController.isMaximised();
        },

        async windowMaximise(_payload: unknown): Promise<void> {
          windowController.maximise();
        },

        async windowUnmaximise(_payload: unknown): Promise<void> {
          windowController.unmaximise();
        },

        async clipboardGetText(_payload: unknown): Promise<string> {
          return windowController.readClipboardText();
        },

        async pickSQLiteFile(payload: unknown): Promise<string> {
          try {
            const input = pickSQLiteFileSchema.parse(payload || {});
            return await windowController.pickSQLiteFile(input.currentPath);
          } catch (error) {
            throw toRpcError(error, "PICK_SQLITE_FILE_FAILED");
          }
        },
      },
      messages: {},
    },
  });
}
