import type {
  AIProviderSettings as SharedAIProviderSettings,
  AnthropicSettings as SharedAnthropicSettings,
  Column as SharedColumn,
  ColumnSchema as SharedColumnSchema,
  ConnectionDetails as SharedConnectionDetails,
  ConnectionMetadata as SharedConnectionMetadata,
  DatabaseMetadata as SharedDatabaseMetadata,
  Edge as SharedEdge,
  ForeignKey as SharedForeignKey,
  Index as SharedIndex,
  NullString as SharedNullString,
  OpenAISettings as SharedOpenAISettings,
  OpenRouterSettings as SharedOpenRouterSettings,
  SQLResult as SharedSQLResult,
  Table as SharedTable,
  TableColumn as SharedTableColumn,
  TableDataResponse as SharedTableDataResponse,
  TableSchema as SharedTableSchema,
  ThemeSettings as SharedThemeSettings,
  WindowSettings as SharedWindowSettings,
} from "@shared/contracts";

export namespace services {
  export type OpenRouterSettings = SharedOpenRouterSettings;
  export type AnthropicSettings = SharedAnthropicSettings;
  export type OpenAISettings = SharedOpenAISettings;
  export type AIProviderSettings = SharedAIProviderSettings;

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
  export type TableColumn = SharedTableColumn;
  export type TableDataResponse = SharedTableDataResponse;
  export type TableSchema = SharedTableSchema;
  export type ThemeSettings = SharedThemeSettings;
  export type WindowSettings = SharedWindowSettings;
}

export namespace sql {
  export type NullString = SharedNullString;
}
