import { z } from "zod";

export const CONFIG_DIR_NAME = ".tidb-desktop";
export const CONFIG_FILE_NAME = "config.json";
export const METADATA_DIR_NAME = "metadata";
export const AGENT_DIR_NAME = ".agents";
export const AGENT_SKILLS_DIR_NAME = "skills";

export const DEFAULT_THEME_MODE = "system";
export const DEFAULT_BASE_THEME = "solar-dusk";
export const DEFAULT_WINDOW_WIDTH = 1024;
export const DEFAULT_WINDOW_HEIGHT = 768;
export const DEFAULT_WINDOW_X = -1;
export const DEFAULT_WINDOW_Y = -1;

export type DatabaseKind = "mysql" | "postgres" | "sqlite" | "bigquery";
export type NamespaceKind = "database" | "schema" | "attached_db" | "dataset";

export interface NullString {
  String: string;
  Valid: boolean;
}

export interface ThemeSettings {
  mode: string;
  baseTheme: string;
}

export interface WindowSettings {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

interface BaseConnectionDetails {
  id?: string;
  name?: string;
  kind: DatabaseKind;
  lastUsed?: string;
}

export interface MySQLConnectionDetails extends BaseConnectionDetails {
  kind: "mysql";
  host: string;
  port: string;
  user: string;
  password: string;
  dbName: string;
  useTLS: boolean;
}

export interface PostgresConnectionDetails extends BaseConnectionDetails {
  kind: "postgres";
  host: string;
  port: string;
  user: string;
  password: string;
  dbName: string;
  useTLS: boolean;
}

export interface SQLiteAttachedDatabase {
  name: string;
  filePath: string;
}

export interface SQLiteConnectionDetails extends BaseConnectionDetails {
  kind: "sqlite";
  filePath: string;
  readOnly?: boolean;
  attachedDatabases?: SQLiteAttachedDatabase[];
}

export type BigQueryAuthType =
  | "service_account_json"
  | "service_account_key_file"
  | "application_default_credentials";

export interface BigQueryConnectionDetails extends BaseConnectionDetails {
  kind: "bigquery";
  projectId: string;
  location?: string;
  authType: BigQueryAuthType;
  serviceAccountJson?: string;
  serviceAccountKeyFile?: string;
}

export type ConnectionDetails =
  | MySQLConnectionDetails
  | PostgresConnectionDetails
  | SQLiteConnectionDetails
  | BigQueryConnectionDetails;

export interface AdapterCapabilities {
  namespaceKind: NamespaceKind;
  supportsTransactions: boolean;
  supportsForeignKeys: boolean;
  supportsIndexes: boolean;
  supportsServerSideFilter: boolean;
}

export interface NamespaceRef {
  namespaceName: string;
  namespaceKind: NamespaceKind;
}

export interface TableRef {
  namespaceName: string;
  tableName: string;
  tableType: "table" | "view";
}

export interface SQLResult {
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
  lastInsertId?: number;
  message?: string;
}

export interface TableColumn {
  name: string;
  type: string;
}

export interface TableDataResponse {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totalRows?: number;
}

export interface ColumnSchema {
  column_name: string;
  column_type: string;
  character_set_name: NullString;
  collation_name: NullString;
  is_nullable: string;
  column_default: NullString;
  extra: string;
  column_comment: string;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
}

export interface Column {
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue?: unknown;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  dbComment?: string;
  aiDescription?: string;
}

export interface ForeignKey {
  name: string;
  columnNames: string[];
  refTableName: string;
  refColumnNames: string[];
}

export interface Index {
  name: string;
  columnNames: string[];
  isUnique: boolean;
}

export interface Edge {
  toTable: string;
  fromColumn: string;
  toColumn: string;
}

export interface Table {
  name: string;
  columns: Column[];
  foreignKeys?: ForeignKey[];
  indexes?: Index[];
  dbComment?: string;
  aiDescription?: string;
}

export interface DatabaseMetadata {
  name: string;
  namespaceKind: NamespaceKind;
  tables: Table[];
  graph?: Record<string, Edge[]>;
  dbComment?: string;
  aiDescription?: string;
}

export interface ConnectionMetadata {
  connectionId: string;
  connectionName: string;
  lastExtracted: string;
  version?: string;
  namespaces: Record<string, DatabaseMetadata>;
}

export interface ConfigData {
  connections: Record<string, ConnectionDetails>;
  appearance?: ThemeSettings;
  window?: WindowSettings;
}

export interface DescriptionTarget {
  type: "database" | "table" | "column";
  tableName?: string;
  columnName?: string;
}

export interface ExtractMetadataInput {
  connectionId?: string;
  force?: boolean;
  namespaceName?: string;
}

export interface GetTableDataInput {
  namespaceName: string;
  tableName: string;
  limit: number;
  offset: number;
  filterParams?: {
    filters?: ServerSideFilter[];
  } | null;
}

export interface ServerSideFilter {
  columnId: string;
  operator: string;
  type: string;
  values: unknown[];
}

export interface AppRpcError {
  code: string;
  message: string;
  details?: unknown;
}

export interface StartAgentRunInput {
  prompt: string;
}

export interface StartAgentRunOutput {
  runId: string;
}

export interface CancelAgentRunInput {
  runId: string;
}

export type AgentRunEventSource = "stdout" | "stderr";

export interface AgentRunEventPayload {
  runId: string;
  source: AgentRunEventSource;
  raw: string;
  parsed?: unknown;
}

export type AgentRunStatus = "started" | "completed" | "failed" | "cancelled";

export interface AgentRunStatusPayload {
  runId: string;
  status: AgentRunStatus;
  exitCode?: number | null;
  signalCode?: number | null;
  error?: string;
}

export const APP_EVENTS = {
  connectionEstablished: "connection:established",
  connectionDisconnected: "connection:disconnected",
  metadataExtractionFailed: "metadata:extraction:failed",
  metadataExtractionCompleted: "metadata:extraction:completed",
  agentRunEvent: "agent:run:event",
  agentRunStatus: "agent:run:status",
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

export interface AppEventPayloadMap {
  "connection:established": ConnectionDetails;
  "connection:disconnected": null;
  "metadata:extraction:failed": string;
  "metadata:extraction:completed": ConnectionMetadata;
  "agent:run:event": AgentRunEventPayload;
  "agent:run:status": AgentRunStatusPayload;
}

export const themeSettingsSchema = z.object({
  mode: z.string(),
  baseTheme: z.string(),
});

export const windowSettingsSchema = z.object({
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  isMaximized: z.boolean().optional(),
});

const baseConnectionSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  lastUsed: z.string().optional(),
});

export const mysqlConnectionDetailsSchema = baseConnectionSchema.extend({
  kind: z.literal("mysql"),
  host: z.string(),
  port: z.string(),
  user: z.string(),
  password: z.string(),
  dbName: z.string(),
  useTLS: z.boolean(),
});

export const postgresConnectionDetailsSchema = baseConnectionSchema.extend({
  kind: z.literal("postgres"),
  host: z.string(),
  port: z.string(),
  user: z.string(),
  password: z.string(),
  dbName: z.string(),
  useTLS: z.boolean(),
});

export const sqliteConnectionDetailsSchema = baseConnectionSchema.extend({
  kind: z.literal("sqlite"),
  filePath: z.string(),
  readOnly: z.boolean().optional(),
  attachedDatabases: z
    .array(
      z.object({
        name: z.string(),
        filePath: z.string(),
      }),
    )
    .optional(),
});

export const bigqueryConnectionDetailsSchema = baseConnectionSchema.extend({
  kind: z.literal("bigquery"),
  projectId: z.string(),
  location: z.string().optional(),
  authType: z.enum([
    "service_account_json",
    "service_account_key_file",
    "application_default_credentials",
  ]),
  serviceAccountJson: z.string().optional(),
  serviceAccountKeyFile: z.string().optional(),
});

export const connectionDetailsSchema = z.discriminatedUnion("kind", [
  mysqlConnectionDetailsSchema,
  postgresConnectionDetailsSchema,
  sqliteConnectionDetailsSchema,
  bigqueryConnectionDetailsSchema,
]);

export const executeSQLSchema = z.object({
  query: z.string().min(1),
});

export const listTablesSchema = z.object({
  namespaceName: z.string().optional().default(""),
});

export const tableFilterSchema = z.object({
  columnId: z.string(),
  operator: z.string(),
  type: z.string(),
  values: z.array(z.unknown()),
});

export const getTableDataSchema = z.object({
  namespaceName: z.string(),
  tableName: z.string(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  filterParams: z
    .object({
      filters: z.array(tableFilterSchema).optional(),
    })
    .nullable()
    .optional(),
});

export const getTableSchemaSchema = z.object({
  namespaceName: z.string(),
  tableName: z.string(),
});

export const extractMetadataSchema = z.object({
  connectionId: z.string().optional(),
  force: z.boolean().optional().default(false),
  namespaceName: z.string().optional().default(""),
});

export const startAgentRunSchema = z.object({
  prompt: z.string().min(1),
});

export const cancelAgentRunSchema = z.object({
  runId: z.string().min(1),
});

export const rpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const appEventEnvelopeSchema = z.object({
  eventName: z.enum([
    APP_EVENTS.connectionEstablished,
    APP_EVENTS.connectionDisconnected,
    APP_EVENTS.metadataExtractionFailed,
    APP_EVENTS.metadataExtractionCompleted,
    APP_EVENTS.agentRunEvent,
    APP_EVENTS.agentRunStatus,
  ]),
  payload: z.unknown().optional().nullable(),
});
