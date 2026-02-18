import { z } from "zod";

export const CONFIG_DIR_NAME = ".tidb-desktop";
export const CONFIG_FILE_NAME = "config.json";
export const METADATA_DIR_NAME = "metadata";

export const DEFAULT_OPENAI_MODEL = "gpt-4o";
export const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-latest";
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
export const DEFAULT_THEME_MODE = "system";
export const DEFAULT_BASE_THEME = "solar-dusk";
export const DEFAULT_AI_PROVIDER = "openai";
export const DEFAULT_WINDOW_WIDTH = 1024;
export const DEFAULT_WINDOW_HEIGHT = 768;
export const DEFAULT_WINDOW_X = -1;
export const DEFAULT_WINDOW_Y = -1;

export interface NullString {
  String: string;
  Valid: boolean;
}

export interface ThemeSettings {
  mode: string;
  baseTheme: string;
}

export interface OpenAISettings {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface AnthropicSettings {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface OpenRouterSettings {
  apiKey?: string;
  model?: string;
}

export interface WindowSettings {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

export interface AIProviderSettings {
  provider?: string;
  openai?: OpenAISettings;
  anthropic?: AnthropicSettings;
  openrouter?: OpenRouterSettings;
}

export interface ConnectionDetails {
  id?: string;
  name?: string;
  host: string;
  port: string;
  user: string;
  password: string;
  dbName: string;
  useTLS: boolean;
  lastUsed?: string;
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
  databases: Record<string, DatabaseMetadata>;
}

export interface ConfigData {
  connections: Record<string, ConnectionDetails>;
  appearance?: ThemeSettings;
  ai?: AIProviderSettings;
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
  dbName?: string;
}

export interface GetTableDataInput {
  dbName: string;
  tableName: string;
  limit: number;
  offset: number;
  filterParams?: {
    filters?: ServerSideFilter[];
  } | null;
}

export interface UpdateAIDescriptionInput {
  dbName: string;
  targetType: "database" | "table" | "column";
  tableName?: string;
  columnName?: string;
  description: string;
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

export const APP_EVENTS = {
  connectionEstablished: "connection:established",
  connectionDisconnected: "connection:disconnected",
  metadataExtractionFailed: "metadata:extraction:failed",
  metadataExtractionCompleted: "metadata:extraction:completed",
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

export interface AppEventPayloadMap {
  "connection:established": ConnectionDetails;
  "connection:disconnected": null;
  "metadata:extraction:failed": string;
  "metadata:extraction:completed": ConnectionMetadata;
}

export const themeSettingsSchema = z.object({
  mode: z.string(),
  baseTheme: z.string(),
});

export const openAISettingsSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
});

export const anthropicSettingsSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
});

export const openRouterSettingsSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

export const aiProviderSettingsSchema = z.object({
  provider: z.string().optional(),
  openai: openAISettingsSchema.optional(),
  anthropic: anthropicSettingsSchema.optional(),
  openrouter: openRouterSettingsSchema.optional(),
});

export const windowSettingsSchema = z.object({
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  isMaximized: z.boolean().optional(),
});

export const connectionDetailsSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  host: z.string(),
  port: z.string(),
  user: z.string(),
  password: z.string(),
  dbName: z.string(),
  useTLS: z.boolean(),
  lastUsed: z.string().optional(),
});

export const executeSQLSchema = z.object({
  query: z.string().min(1),
});

export const listTablesSchema = z.object({
  dbName: z.string().optional().default(""),
});

export const tableFilterSchema = z.object({
  columnId: z.string(),
  operator: z.string(),
  type: z.string(),
  values: z.array(z.unknown()),
});

export const getTableDataSchema = z.object({
  dbName: z.string(),
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
  dbName: z.string(),
  tableName: z.string(),
});

export const extractMetadataSchema = z.object({
  connectionId: z.string().optional(),
  force: z.boolean().optional().default(false),
  dbName: z.string().optional().default(""),
});

export const updateAIDescriptionSchema = z.object({
  dbName: z.string(),
  targetType: z.enum(["database", "table", "column"]),
  tableName: z.string().optional().default(""),
  columnName: z.string().optional().default(""),
  description: z.string(),
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
  ]),
  payload: z.unknown().optional().nullable(),
});
