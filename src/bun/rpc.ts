import { BrowserView } from "electrobun/bun";
import {
  APP_EVENTS,
  type AppRpcError,
  type ConnectionDetails,
  cancelAgentRunSchema,
  connectionDetailsSchema,
  executeSQLSchema,
  extractMetadataSchema,
  getTableDataSchema,
  getTableSchemaSchema,
  listTablesSchema,
  startAgentRunSchema,
  themeSettingsSchema,
  windowSettingsSchema,
} from "../shared/contracts";
import { events } from "./events";
import { AgentBridgeService } from "./services/agent-bridge-service";
import { AgentService } from "./services/agent-service";
import { ConfigService } from "./services/config-service";
import { DatabaseGatewayService } from "./services/database-gateway-service";
import { logger } from "./services/logger-service";
import { MetadataService } from "./services/metadata-service";
import { SessionService } from "./services/session-service";

export const configService = new ConfigService();
export const databaseService = new DatabaseGatewayService();
export const metadataService = new MetadataService(
  configService,
  databaseService,
);
export const sessionService = new SessionService();
export const agentBridgeService = new AgentBridgeService(
  sessionService,
  databaseService,
);
export const agentService = new AgentService(
  events,
  agentBridgeService,
  sessionService,
);

export type WindowController = {
  isMaximised: () => boolean;
  maximise: () => void;
  unmaximise: () => void;
  readClipboardText: () => string;
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

function assertActiveConnection(): {
  connectionId: string;
  details: ConnectionDetails;
} {
  const { id, details } = sessionService.ensureActiveConnection();
  return {
    connectionId: id,
    details,
  };
}

async function getVersionForConnection(
  details: ConnectionDetails,
): Promise<string> {
  return databaseService.getVersion(details);
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
  return BrowserView.defineRPC({
    handlers: {
      requests: {
        async TestConnection(payload: unknown): Promise<boolean> {
          try {
            const details = connectionDetailsSchema.parse(payload);
            return await databaseService.testConnection(details);
          } catch (error) {
            throw toRpcError(error, "TEST_CONNECTION_FAILED");
          }
        },

        async ConnectUsingSaved(
          connectionId: unknown,
        ): Promise<ConnectionDetails> {
          try {
            if (typeof connectionId !== "string" || !connectionId.trim()) {
              throw new Error("connection ID cannot be empty");
            }

            const { details, found } =
              configService.getConnection(connectionId);
            if (!found) {
              throw new Error(`saved connection '${connectionId}' not found`);
            }

            await databaseService.testConnection(details);
            sessionService.setActiveConnection(connectionId, details);
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

            const activeDetails = sessionService.getActiveConnection();
            if (!activeDetails) {
              throw new Error("active connection is empty after connect");
            }

            return activeDetails;
          } catch (error) {
            throw toRpcError(error, "CONNECT_FAILED");
          }
        },

        async Disconnect(): Promise<void> {
          disconnectCurrentSession();
        },

        async GetActiveConnection(): Promise<ConnectionDetails | null> {
          return sessionService.getActiveConnection();
        },

        async ListSavedConnections(): Promise<
          Record<string, ConnectionDetails>
        > {
          return configService.getAllConnections();
        },

        async SaveConnection(payload: unknown): Promise<string> {
          try {
            const details = connectionDetailsSchema.parse(payload);
            return configService.addOrUpdateConnection(details);
          } catch (error) {
            throw toRpcError(error, "SAVE_CONNECTION_FAILED");
          }
        },

        async DeleteSavedConnection(connectionId: unknown): Promise<void> {
          try {
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

        async ExecuteSQL(payload: unknown) {
          try {
            const input = executeSQLSchema.parse({ query: payload });
            const { details } = assertActiveConnection();
            return await databaseService.executeSQL(details, input.query);
          } catch (error) {
            throw toRpcError(error, "EXECUTE_SQL_FAILED");
          }
        },

        async GetVersion(): Promise<string> {
          try {
            const { details } = assertActiveConnection();
            return await getVersionForConnection(details);
          } catch (error) {
            throw toRpcError(error, "GET_VERSION_FAILED");
          }
        },

        async GetConnectionCapabilities() {
          try {
            const { details } = assertActiveConnection();
            return databaseService.getCapabilities(details);
          } catch (error) {
            throw toRpcError(error, "GET_CAPABILITIES_FAILED");
          }
        },

        async ListNamespaces() {
          try {
            const { details } = assertActiveConnection();
            return await databaseService.listNamespaces(details);
          } catch (error) {
            throw toRpcError(error, "LIST_NAMESPACES_FAILED");
          }
        },

        async ListTables(payload: unknown) {
          try {
            const input = listTablesSchema.parse({ namespaceName: payload });
            const { details } = assertActiveConnection();
            return await databaseService.listTables(
              details,
              input.namespaceName,
            );
          } catch (error) {
            throw toRpcError(error, "LIST_TABLES_FAILED");
          }
        },

        async GetTableData(payload: unknown) {
          try {
            const input = getTableDataSchema.parse(payload);
            const { details } = assertActiveConnection();
            return await databaseService.getTableData(details, input);
          } catch (error) {
            throw toRpcError(error, "GET_TABLE_DATA_FAILED");
          }
        },

        async GetTableSchema(payload: unknown) {
          try {
            const input = getTableSchemaSchema.parse(payload);
            const { details } = assertActiveConnection();
            return await databaseService.getTableSchema(
              details,
              input.namespaceName,
              input.tableName,
            );
          } catch (error) {
            throw toRpcError(error, "GET_TABLE_SCHEMA_FAILED");
          }
        },

        async GetThemeSettings() {
          return configService.getThemeSettings();
        },

        async SaveThemeSettings(payload: unknown): Promise<void> {
          try {
            const settings = themeSettingsSchema.parse(payload);
            configService.saveThemeSettings(settings);
          } catch (error) {
            throw toRpcError(error, "SAVE_THEME_SETTINGS_FAILED");
          }
        },

        async GetWindowSettings() {
          return configService.getWindowSettings();
        },

        async SaveWindowSettings(payload: unknown): Promise<void> {
          try {
            const settings = windowSettingsSchema.parse(payload);
            configService.saveWindowSettings(settings);
          } catch (error) {
            throw toRpcError(error, "SAVE_WINDOW_SETTINGS_FAILED");
          }
        },

        async GetDatabaseMetadata() {
          try {
            const { connectionId } = assertActiveConnection();
            return metadataService.getMetadata(connectionId);
          } catch (error) {
            throw toRpcError(error, "GET_METADATA_FAILED");
          }
        },

        async ExtractDatabaseMetadata(payload: unknown) {
          try {
            const input = extractMetadataSchema.parse(payload || {});
            const connectionId = requireConnectionId(input.connectionId);

            let metadata;
            if (input.force) {
              metadata = await metadataService.extractMetadata(
                connectionId,
                input.namespaceName || "",
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

        async StartAgentRun(payload: unknown): Promise<{ runId: string }> {
          try {
            const input = startAgentRunSchema.parse(payload);
            const runId = await agentService.startRun(input.prompt);
            return { runId };
          } catch (error) {
            throw toRpcError(error, "START_AGENT_RUN_FAILED");
          }
        },

        async CancelAgentRun(payload: unknown): Promise<void> {
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

        async WindowIsMaximised(): Promise<boolean> {
          return windowController.isMaximised();
        },

        async WindowMaximise(): Promise<void> {
          windowController.maximise();
        },

        async WindowUnmaximise(): Promise<void> {
          windowController.unmaximise();
        },

        async ClipboardGetText(): Promise<string> {
          return windowController.readClipboardText();
        },
      },
      messages: {},
    },
  });
}
