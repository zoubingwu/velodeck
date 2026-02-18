import type {
  AdapterCapabilities as SharedAdapterCapabilities,
  AgentRunEventPayload as SharedAgentRunEventPayload,
  AgentRunStatusPayload as SharedAgentRunStatusPayload,
  Column as SharedColumn,
  ColumnSchema as SharedColumnSchema,
  ConnectionDetails as SharedConnectionDetails,
  ConnectionMetadata as SharedConnectionMetadata,
  DatabaseMetadata as SharedDatabaseMetadata,
  Edge as SharedEdge,
  ForeignKey as SharedForeignKey,
  Index as SharedIndex,
  NamespaceRef as SharedNamespaceRef,
  NullString as SharedNullString,
  SQLResult as SharedSQLResult,
  Table as SharedTable,
  TableColumn as SharedTableColumn,
  TableDataResponse as SharedTableDataResponse,
  TableRef as SharedTableRef,
  TableSchema as SharedTableSchema,
  ThemeSettings as SharedThemeSettings,
  WindowSettings as SharedWindowSettings,
} from "@shared/contracts";

export namespace services {
  export type AdapterCapabilities = SharedAdapterCapabilities;
  export type Column = SharedColumn;
  export type ColumnSchema = SharedColumnSchema;
  export type ConnectionDetails = SharedConnectionDetails;
  export type Index = SharedIndex;
  export type ForeignKey = SharedForeignKey;
  export type Table = SharedTable;
  export type DatabaseMetadata = SharedDatabaseMetadata;
  export type ConnectionMetadata = SharedConnectionMetadata;
  export type Edge = SharedEdge;

  export type SQLResult = SharedSQLResult;
  export type NamespaceRef = SharedNamespaceRef;
  export type TableRef = SharedTableRef;
  export type TableColumn = SharedTableColumn;
  export type TableDataResponse = SharedTableDataResponse;
  export type TableSchema = SharedTableSchema;
  export type ThemeSettings = SharedThemeSettings;
  export type WindowSettings = SharedWindowSettings;
  export type AgentRunEventPayload = SharedAgentRunEventPayload;
  export type AgentRunStatusPayload = SharedAgentRunStatusPayload;
}

export namespace sql {
  export type NullString = SharedNullString;
}
