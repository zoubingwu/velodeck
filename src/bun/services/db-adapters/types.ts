import type {
  AdapterCapabilities,
  ConnectionDetails,
  DatabaseKind,
  DatabaseMetadata,
  GetTableDataInput,
  NamespaceRef,
  SQLResult,
  TableDataResponse,
  TableRef,
  TableSchema,
} from "../../../shared/contracts";

export interface DatabaseAdapter {
  readonly kind: DatabaseKind;
  readonly capabilities: AdapterCapabilities;

  testConnection(conn: ConnectionDetails): Promise<void>;
  executeSQL(conn: ConnectionDetails, sql: string): Promise<SQLResult>;

  listNamespaces(conn: ConnectionDetails): Promise<NamespaceRef[]>;
  listTables(
    conn: ConnectionDetails,
    namespaceName: string,
  ): Promise<TableRef[]>;

  getTableSchema(
    conn: ConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<TableSchema>;

  getTableData(
    conn: ConnectionDetails,
    input: GetTableDataInput,
  ): Promise<TableDataResponse>;

  extractMetadata?(
    conn: ConnectionDetails,
    namespaceName?: string,
  ): Promise<DatabaseMetadata>;
}
