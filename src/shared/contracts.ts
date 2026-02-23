import { z } from "zod";

export const CONFIG_DIR_NAME = ".velodeck";
export const CONFIG_FILE_NAME = "config.json";
export const AGENT_DIR_NAME = ".agents";
export const AGENT_SKILLS_DIR_NAME = "skills";

export const DEFAULT_THEME_MODE = "system";
export const DEFAULT_BASE_THEME = "solar-dusk";
export const DEFAULT_WINDOW_WIDTH = 1024;
export const DEFAULT_WINDOW_HEIGHT = 768;
export const DEFAULT_WINDOW_X = -1;
export const DEFAULT_WINDOW_Y = -1;

export type ConnectorKind = string;
export type ConnectorCategory = "sql" | "analytics" | "nosql" | "file";
export type ExplorerNodeKind = "root" | "group" | "namespace" | "entity";
export type ConnectorFieldType =
  | "text"
  | "password"
  | "number"
  | "boolean"
  | "select"
  | "file"
  | "textarea";

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

export interface ConnectorFormFieldOption {
  label: string;
  value: string;
}

export interface ConnectorFormField {
  key: string;
  label: string;
  type: ConnectorFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  secret?: boolean;
  defaultValue?: string | number | boolean;
  options?: ConnectorFormFieldOption[];
}

export interface ConnectorCapabilities {
  supportsSqlExecution: boolean;
  supportsSchemaInspection: boolean;
  supportsServerSideFilter: boolean;
  supportsPagination: boolean;
  supportsMetadataExtraction: boolean;
}

export interface ConnectorManifest {
  kind: ConnectorKind;
  label: string;
  category: ConnectorCategory;
  capabilities: ConnectorCapabilities;
  formFields: ConnectorFormField[];
}

export interface ConnectionProfile {
  id?: string;
  name?: string;
  kind: ConnectorKind;
  options: Record<string, unknown>;
  lastUsed?: string;
}

export interface DataEntityRef {
  connectorKind: ConnectorKind;
  entityType: string;
  namespace?: string;
  name: string;
  nodeId?: string;
}

export interface ExplorerNode {
  nodeId: string;
  parentNodeId: string | null;
  kind: ExplorerNodeKind;
  label: string;
  expandable: boolean;
  description?: string;
  entityRef?: DataEntityRef;
}

export interface ServerSideFilter {
  columnId: string;
  operator: string;
  type: string;
  values: unknown[];
}

export interface EntitySort {
  columnId: string;
  direction: "asc" | "desc";
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

export interface RelationalTraits {
  namespace: string;
  tableType: "table" | "view";
  primaryKey?: string[];
  foreignKeys?: ForeignKey[];
  indexes?: Index[];
}

export interface EntityField {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  description?: string;
}

export interface EntitySchema {
  entity: DataEntityRef;
  fields: EntityField[];
  relationalTraits?: RelationalTraits;
}

export interface ReadEntityInput {
  entity: DataEntityRef;
  limit: number;
  offset?: number;
  cursor?: string;
  filters?: ServerSideFilter[];
  sort?: EntitySort[];
}

export interface EntityDataPage {
  entity: DataEntityRef;
  fields: EntityField[];
  rows: Record<string, unknown>[];
  totalRows?: number;
  nextCursor?: string;
}

export interface SQLResult {
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
  lastInsertId?: number;
  message?: string;
}

export interface EntityMetadata extends EntitySchema {
  key: string;
  label: string;
  dbComment?: string;
  aiDescription?: string;
}

export interface ConnectionMetadata {
  connectionId: string;
  connectionName: string;
  lastExtracted: string;
  version?: string;
  explorer: ExplorerNode[];
  entities: Record<string, EntityMetadata>;
}

export interface ConfigData {
  connections: Record<string, ConnectionProfile>;
  appearance?: ThemeSettings;
  window?: WindowSettings;
}

export interface DescriptionTarget {
  type: "entity" | "field";
  entityKey: string;
  fieldName?: string;
}

export interface ExtractMetadataInput {
  connectionId?: string;
  force?: boolean;
  scopeNodeId?: string;
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

export type AgentSQLClassification = "read" | "write";

export type AgentSQLApprovalDecision = "approved" | "rejected";

export interface AgentSQLApprovalRequestPayload {
  runId: string;
  approvalId: string;
  query: string;
  classification: AgentSQLClassification;
}

export interface AgentSQLApprovalResolvedPayload {
  runId: string;
  approvalId: string;
  decision: AgentSQLApprovalDecision;
  reason?: string;
}

export interface AgentSQLApprovalResolveInput {
  runId: string;
  approvalId: string;
  decision: AgentSQLApprovalDecision;
  reason?: string;
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
  agentSQLApprovalRequested: "agent:sql:approval:requested",
  agentSQLApprovalResolved: "agent:sql:approval:resolved",
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

export interface AppEventPayloadMap {
  "connection:established": ConnectionProfile;
  "connection:disconnected": null;
  "metadata:extraction:failed": string;
  "metadata:extraction:completed": ConnectionMetadata;
  "agent:run:event": AgentRunEventPayload;
  "agent:run:status": AgentRunStatusPayload;
  "agent:sql:approval:requested": AgentSQLApprovalRequestPayload;
  "agent:sql:approval:resolved": AgentSQLApprovalResolvedPayload;
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
  kind: z.string().min(1),
  options: z.record(z.unknown()),
});

export const connectionProfileSchema = baseConnectionSchema;

export const executeSQLSchema = z.object({
  query: z.string().min(1),
});

export const pickSQLiteFileSchema = z.object({
  currentPath: z.string().optional().default(""),
});

export const dataEntityRefSchema = z.object({
  connectorKind: z.string().min(1),
  entityType: z.string().min(1),
  namespace: z.string().optional(),
  name: z.string().min(1),
  nodeId: z.string().optional(),
});

export const tableFilterSchema = z.object({
  columnId: z.string(),
  operator: z.string(),
  type: z.string(),
  values: z.array(z.unknown()),
});

export const entitySortSchema = z.object({
  columnId: z.string(),
  direction: z.enum(["asc", "desc"]),
});

export const listExplorerNodesSchema = z.object({
  parentNodeId: z.string().nullable().optional().default(null),
});

export const readEntitySchema = z.object({
  entity: dataEntityRefSchema,
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative().optional(),
  cursor: z.string().optional(),
  filters: z.array(tableFilterSchema).optional(),
  sort: z.array(entitySortSchema).optional(),
});

export const getEntitySchemaSchema = z.object({
  entity: dataEntityRefSchema,
});

export const extractMetadataSchema = z.object({
  connectionId: z.string().optional(),
  force: z.boolean().optional().default(false),
  scopeNodeId: z.string().optional().default(""),
});

export const startAgentRunSchema = z.object({
  prompt: z.string().min(1),
});

export const cancelAgentRunSchema = z.object({
  runId: z.string().min(1),
});

export const resolveAgentSQLApprovalSchema = z.object({
  runId: z.string().min(1),
  approvalId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
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
    APP_EVENTS.agentSQLApprovalRequested,
    APP_EVENTS.agentSQLApprovalResolved,
  ]),
  payload: z.unknown().optional().nullable(),
});
