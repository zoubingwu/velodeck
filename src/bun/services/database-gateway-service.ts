import type {
  AdapterCapabilities,
  Column,
  ConnectionDetails,
  DatabaseMetadata,
  GetTableDataInput,
  NamespaceRef,
  SQLResult,
  Table,
  TableColumn,
  TableDataResponse,
  TableRef,
  TableSchema,
} from "../../shared/contracts";
import { AdapterRegistry } from "./db-adapters/registry";

export class DatabaseGatewayService {
  private readonly registry: AdapterRegistry;

  constructor(registry?: AdapterRegistry) {
    this.registry = registry || new AdapterRegistry();
  }

  getCapabilities(details: ConnectionDetails): AdapterCapabilities {
    return this.registry.getByConnection(details).capabilities;
  }

  async testConnection(details: ConnectionDetails): Promise<boolean> {
    await this.registry.getByConnection(details).testConnection(details);
    return true;
  }

  async executeSQL(
    details: ConnectionDetails,
    query: string,
  ): Promise<SQLResult> {
    return this.registry.getByConnection(details).executeSQL(details, query);
  }

  async listNamespaces(details: ConnectionDetails): Promise<NamespaceRef[]> {
    return this.registry.getByConnection(details).listNamespaces(details);
  }

  async listTables(
    details: ConnectionDetails,
    namespaceName: string,
  ): Promise<TableRef[]> {
    return this.registry
      .getByConnection(details)
      .listTables(details, namespaceName);
  }

  async getTableData(
    details: ConnectionDetails,
    input: GetTableDataInput,
  ): Promise<TableDataResponse> {
    return this.registry.getByConnection(details).getTableData(details, input);
  }

  async getTableSchema(
    details: ConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<TableSchema> {
    return this.registry
      .getByConnection(details)
      .getTableSchema(details, namespaceName, tableName);
  }

  async extractMetadata(
    details: ConnectionDetails,
    namespaceName: string,
  ): Promise<DatabaseMetadata> {
    const adapter = this.registry.getByConnection(details);
    if (adapter.extractMetadata) {
      return adapter.extractMetadata(details, namespaceName);
    }

    const refs = await adapter.listTables(details, namespaceName);
    const tables: Table[] = [];

    for (const ref of refs) {
      const schema = await adapter.getTableSchema(
        details,
        namespaceName,
        ref.tableName,
      );
      const columns: Column[] = schema.columns.map((column) =>
        this.mapColumnFromSchema(column),
      );
      tables.push({
        name: ref.tableName,
        columns,
        foreignKeys: [],
        indexes: [],
      });
    }

    return {
      name: namespaceName,
      namespaceKind: adapter.capabilities.namespaceKind,
      tables,
      graph: {},
    };
  }

  private mapColumnFromSchema(column: {
    column_name: string;
    column_type: string;
    is_nullable: string;
    column_default: { String: string; Valid: boolean };
    extra: string;
    column_comment: string;
  }): Column {
    return {
      name: column.column_name,
      dataType: column.column_type,
      isNullable: String(column.is_nullable).toUpperCase() === "YES",
      defaultValue: column.column_default.Valid
        ? column.column_default.String
        : undefined,
      isPrimaryKey: false,
      autoIncrement: String(column.extra).toLowerCase() === "auto_increment",
      dbComment: column.column_comment,
    };
  }

  async getVersion(details: ConnectionDetails): Promise<string> {
    if (details.kind === "sqlite") {
      return this.extractVersion(
        await this.executeSQL(details, "SELECT sqlite_version() AS version;"),
      );
    }

    if (details.kind === "bigquery") {
      return "BigQuery";
    }

    return this.extractVersion(
      await this.executeSQL(details, "SELECT VERSION();"),
    );
  }

  private extractVersion(result: SQLResult): string {
    const firstRow = result.rows?.[0];
    if (!firstRow) {
      throw new Error("no version information returned from database");
    }

    for (const value of Object.values(firstRow)) {
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      if (value !== null && value !== undefined) {
        return String(value);
      }
    }

    throw new Error("version information is empty");
  }

  mapTableSchemaToColumns(schema: TableSchema): TableColumn[] {
    return schema.columns.map((column) => ({
      name: column.column_name,
      type: column.column_type,
    }));
  }
}
