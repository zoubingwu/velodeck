import type { NullString, ServerSideFilter } from "../../shared/contracts";

export type SQLConnectorKind =
  | "mysql"
  | "tidb"
  | "postgres"
  | "sqlite"
  | "bigquery";

export type SQLNamespaceKind =
  | "database"
  | "schema"
  | "attached_db"
  | "dataset";

interface BaseConnectionConfig {
  id?: string;
  name?: string;
  kind: SQLConnectorKind;
  lastUsed?: string;
}

export interface MySQLFamilyConnectionConfig extends BaseConnectionConfig {
  kind: "mysql" | "tidb";
  host: string;
  port: string;
  user: string;
  password: string;
  dbName: string;
  useTLS: boolean;
}

export interface PostgresConnectionConfig extends BaseConnectionConfig {
  kind: "postgres";
  host: string;
  port: string;
  user: string;
  password: string;
  dbName: string;
  useTLS: boolean;
}

export interface SQLiteAttachedDatabaseConfig {
  name: string;
  filePath: string;
}

export interface SQLiteConnectionConfig extends BaseConnectionConfig {
  kind: "sqlite";
  filePath: string;
  attachedDatabases?: SQLiteAttachedDatabaseConfig[];
}

export type BigQueryAuthMode =
  | "service_account_json"
  | "service_account_key_file"
  | "application_default_credentials";

export interface BigQueryConnectionConfig extends BaseConnectionConfig {
  kind: "bigquery";
  projectId: string;
  location?: string;
  authType: BigQueryAuthMode;
  serviceAccountJson?: string;
  serviceAccountKeyFile?: string;
}

export interface SQLNamespaceRef {
  namespaceName: string;
  namespaceKind: SQLNamespaceKind;
  displayName?: string;
}

export interface SQLTableRef {
  namespaceName: string;
  tableName: string;
  tableType: "table" | "view";
}

export interface SQLTableColumn {
  name: string;
  type: string;
}

export interface SQLTableDataPage {
  columns: SQLTableColumn[];
  rows: Record<string, unknown>[];
  totalRows?: number;
}

export interface SQLTableSchemaColumn {
  column_name: string;
  column_type: string;
  character_set_name: NullString;
  collation_name: NullString;
  is_nullable: string;
  column_default: NullString;
  extra: string;
  column_comment: string;
}

export interface SQLTableSchema {
  name: string;
  columns: SQLTableSchemaColumn[];
}

export interface SQLReadTableInput {
  namespaceName: string;
  tableName: string;
  limit: number;
  offset: number;
  filterParams?: {
    filters?: ServerSideFilter[];
  } | null;
}
