import mysql, {
  type Connection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type {
  ConnectionProfile,
  ConnectorManifest,
  DataEntityRef,
  EntityDataPage,
  EntityField,
  EntitySchema,
  ExplorerNode,
  ReadEntityInput,
  SQLResult,
} from "../../shared/contracts";
import type { SQLConnector } from "../services/connector-types";
import {
  buildEntityNodeId,
  buildNamespaceNodeId,
  parseNamespaceNodeId,
} from "../utils/connector-node-id";
import {
  ensureRequiredString,
  readBooleanOption,
  readStringOption,
} from "../utils/connector-options";
import type {
  MySQLFamilyConnectionConfig,
  SQLNamespaceRef,
  SQLReadTableInput,
  SQLTableColumn,
  SQLTableDataPage,
  SQLTableRef,
  SQLTableSchema,
  SQLTableSchemaColumn,
} from "../utils/sql-types";
import {
  buildWhereClause,
  coerceFiniteNumber,
  normalizeRow,
  quoteBacktickIdentifier,
  toNullString,
} from "../utils/sql-utils";

type MySQLFamilyConfig = {
  manifest: ConnectorManifest;
  engineKind: "mysql" | "tidb";
  defaultPort: string;
  defaultTLS: boolean;
};

export class SQLMySQLFamilyBaseConnector implements SQLConnector {
  readonly manifest: ConnectorManifest;
  private readonly engineKind: "mysql" | "tidb";
  private readonly defaultPort: string;
  private readonly defaultTLS: boolean;

  constructor(config: MySQLFamilyConfig) {
    this.manifest = config.manifest;
    this.engineKind = config.engineKind;
    this.defaultPort = config.defaultPort;
    this.defaultTLS = config.defaultTLS;
  }

  validateOptions(options: Record<string, unknown>): void {
    ensureRequiredString(readStringOption(options, "host"), "host");
    ensureRequiredString(
      readStringOption(options, "port", this.defaultPort),
      "port",
    );
    ensureRequiredString(readStringOption(options, "user"), "user");
    ensureRequiredString(readStringOption(options, "dbName"), "database");
  }

  async testConnection(profile: ConnectionProfile): Promise<void> {
    const details = this.toDetails(profile);
    await this.withConnection(details, async (conn) => {
      await conn.ping();
    });
  }

  async getVersion(profile: ConnectionProfile): Promise<string> {
    const details = this.toDetails(profile);
    const result = await this.executeSQLWithDetails(
      details,
      "SELECT VERSION() AS version;",
    );
    const firstRow = result.rows?.[0];
    if (!firstRow) {
      return "";
    }
    const raw = firstRow.version ?? Object.values(firstRow)[0];
    return raw === undefined || raw === null ? "" : String(raw);
  }

  async executeSQL(
    profile: ConnectionProfile,
    sql: string,
  ): Promise<SQLResult> {
    return this.executeSQLWithDetails(this.toDetails(profile), sql);
  }

  async listExplorerNodes(
    profile: ConnectionProfile,
    parentNodeId: string | null,
  ): Promise<ExplorerNode[]> {
    const details = this.toDetails(profile);

    if (!parentNodeId) {
      const namespaces = await this.listNamespaces(details);
      return namespaces.map((item) => ({
        nodeId: buildNamespaceNodeId(item.namespaceName),
        parentNodeId: null,
        kind: "namespace",
        label: item.displayName || item.namespaceName,
        expandable: true,
      }));
    }

    const namespaceName = parseNamespaceNodeId(parentNodeId);
    if (!namespaceName) {
      return [];
    }

    const tables = await this.listTables(details, namespaceName);
    return tables.map((table) => ({
      nodeId: buildEntityNodeId(
        namespaceName,
        table.tableType,
        table.tableName,
      ),
      parentNodeId,
      kind: "entity",
      label: table.tableName,
      expandable: false,
      entityRef: {
        connectorKind: profile.kind,
        entityType: table.tableType,
        namespace: namespaceName,
        name: table.tableName,
      },
    }));
  }

  async readEntity(
    profile: ConnectionProfile,
    input: ReadEntityInput,
  ): Promise<EntityDataPage> {
    const details = this.toDetails(profile);
    const namespaceName = ensureRequiredString(
      input.entity.namespace || "",
      "namespace",
    );

    const result = await this.getTableData(details, {
      namespaceName,
      tableName: input.entity.name,
      limit: input.limit,
      offset: input.offset || 0,
      filterParams: input.filters?.length ? { filters: input.filters } : null,
    });

    const fields: EntityField[] = result.columns.map((column) => ({
      name: column.name,
      type: column.type,
    }));

    return {
      entity: {
        ...input.entity,
        connectorKind: profile.kind,
      },
      fields,
      rows: result.rows,
      totalRows: result.totalRows,
    };
  }

  async getEntitySchema(
    profile: ConnectionProfile,
    entity: DataEntityRef,
  ): Promise<EntitySchema> {
    const details = this.toDetails(profile);
    const namespaceName = ensureRequiredString(
      entity.namespace || "",
      "namespace",
    );

    const schema = await this.getTableSchema(
      details,
      namespaceName,
      entity.name,
    );

    const fields: EntityField[] = schema.columns.map((column) => ({
      name: column.column_name,
      type: column.column_type,
      nullable: String(column.is_nullable).toUpperCase() === "YES",
      primaryKey: String(column.extra || "")
        .toLowerCase()
        .includes("pri"),
      description: column.column_comment || undefined,
    }));

    return {
      entity: {
        ...entity,
        connectorKind: profile.kind,
      },
      fields,
      relationalTraits: {
        namespace: namespaceName,
        tableType: entity.entityType === "view" ? "view" : "table",
      },
    };
  }

  protected toDetails(profile: ConnectionProfile): MySQLFamilyConnectionConfig {
    this.validateOptions(profile.options);

    return {
      id: profile.id,
      name: profile.name,
      lastUsed: profile.lastUsed,
      kind: this.engineKind,
      host: readStringOption(profile.options, "host"),
      port: readStringOption(profile.options, "port", this.defaultPort),
      user: readStringOption(profile.options, "user"),
      password: readStringOption(profile.options, "password"),
      dbName: readStringOption(profile.options, "dbName"),
      useTLS: readBooleanOption(profile.options, "useTLS", this.defaultTLS),
    };
  }

  private getConnectionConfig(
    details: MySQLFamilyConnectionConfig,
  ): mysql.ConnectionOptions {
    const port = Number(details.port || this.defaultPort);

    return {
      host: details.host,
      port,
      user: details.user,
      password: details.password,
      database: details.dbName || undefined,
      ssl: details.useTLS
        ? {
            minVersion: "TLSv1.2",
            verifyIdentity: true,
          }
        : undefined,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
  }

  private async withConnection<T>(
    details: MySQLFamilyConnectionConfig,
    run: (conn: Connection) => Promise<T>,
  ): Promise<T> {
    const conn = await mysql.createConnection(
      this.getConnectionConfig(details),
    );
    try {
      return await run(conn);
    } finally {
      await conn.end();
    }
  }

  private async executeSQLWithDetails(
    details: MySQLFamilyConnectionConfig,
    query: string,
  ): Promise<SQLResult> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withConnection(details, async (conn) => {
      const [rows, fields] = await conn.query(trimmedQuery);

      if (Array.isArray(rows)) {
        const normalizedRows = rows.map((row) =>
          normalizeRow(row as RowDataPacket),
        );
        const columns = Array.isArray(fields)
          ? fields.map((field) => field.name)
          : normalizedRows[0]
            ? Object.keys(normalizedRows[0])
            : [];

        return {
          columns,
          rows: normalizedRows,
        };
      }

      const result = rows as ResultSetHeader;
      return {
        rowsAffected: result.affectedRows,
        lastInsertId: result.insertId > 0 ? result.insertId : undefined,
        message: "Command executed successfully.",
      };
    });
  }

  private async listNamespaces(
    details: MySQLFamilyConnectionConfig,
  ): Promise<SQLNamespaceRef[]> {
    const result = await this.executeSQLWithDetails(
      details,
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME ASC;",
    );

    const rows = result.rows || [];
    return rows
      .map((row) => {
        const value = row.SCHEMA_NAME;
        return typeof value === "string" ? value : "";
      })
      .filter((name) => name.length > 0)
      .map((namespaceName) => ({
        namespaceName,
        namespaceKind: "database",
      }));
  }

  private async listTables(
    details: MySQLFamilyConnectionConfig,
    namespaceName: string,
  ): Promise<SQLTableRef[]> {
    const targetNamespace = namespaceName || details.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }

    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME ASC;",
        [targetNamespace],
      );

      return rows
        .map((row) => {
          const name = typeof row.TABLE_NAME === "string" ? row.TABLE_NAME : "";
          const tableTypeRaw =
            typeof row.TABLE_TYPE === "string" ? row.TABLE_TYPE : "";
          const tableType: SQLTableRef["tableType"] = tableTypeRaw
            .toUpperCase()
            .includes("VIEW")
            ? "view"
            : "table";

          return {
            namespaceName: targetNamespace,
            tableName: name,
            tableType,
          };
        })
        .filter((item) => item.tableName.length > 0);
    });
  }

  private async getTableData(
    details: MySQLFamilyConnectionConfig,
    input: SQLReadTableInput,
  ): Promise<SQLTableDataPage> {
    const targetNamespace = input.namespaceName || details.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }
    if (!input.tableName) {
      throw new Error("table name is required");
    }

    const qNamespace = quoteBacktickIdentifier(targetNamespace);
    const qTable = quoteBacktickIdentifier(input.tableName);

    const descResult = await this.executeSQLWithDetails(
      details,
      `DESCRIBE ${qNamespace}.${qTable};`,
    );
    const descRows = descResult.rows || [];
    if (!descRows.length) {
      const exists = await this.checkTableExists(
        details,
        targetNamespace,
        input.tableName,
      );
      if (!exists) {
        throw new Error(
          `table '${targetNamespace}.${input.tableName}' not found`,
        );
      }
      return {
        columns: [],
        rows: [],
      };
    }

    const columns: SQLTableColumn[] = descRows
      .map((row) => {
        const name = typeof row.Field === "string" ? row.Field : "";
        const type = typeof row.Type === "string" ? row.Type : "";
        return { name, type };
      })
      .filter((item) => item.name.length > 0);

    const allowedColumns = new Set(columns.map((col) => col.name));
    const sanitizedLimit = Math.max(1, Math.floor(input.limit || 100));
    const sanitizedOffset = Math.max(0, Math.floor(input.offset || 0));

    const { clause, params } = buildWhereClause(
      input.filterParams?.filters || [],
      allowedColumns,
      quoteBacktickIdentifier,
      () => "?",
    );

    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM ${qNamespace}.${qTable}${clause} LIMIT ? OFFSET ?;`,
        [...params, sanitizedLimit, sanitizedOffset],
      );

      const normalizedRows = rows.map((row) => normalizeRow(row));

      const [countRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM ${qNamespace}.${qTable}${clause};`,
        params,
      );

      const totalRaw = countRows[0]?.total;
      const totalRows = coerceFiniteNumber(totalRaw) ?? undefined;

      return {
        columns,
        rows: normalizedRows,
        totalRows,
      };
    });
  }

  private async getTableSchema(
    details: MySQLFamilyConnectionConfig,
    namespaceName: string,
    tableName: string,
  ): Promise<SQLTableSchema> {
    const targetNamespace = namespaceName || details.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }
    if (!tableName) {
      throw new Error("table name is required");
    }

    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `
        SELECT
          COLUMN_NAME AS column_name,
          COLUMN_TYPE AS column_type,
          CHARACTER_SET_NAME AS character_set_name,
          COLLATION_NAME AS collation_name,
          IS_NULLABLE AS is_nullable,
          COLUMN_DEFAULT AS column_default,
          EXTRA AS extra,
          COLUMN_COMMENT AS column_comment
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION;
      `,
        [targetNamespace, tableName],
      );

      if (!rows.length) {
        const exists = await this.checkTableExists(
          details,
          targetNamespace,
          tableName,
        );
        if (!exists) {
          throw new Error(`table '${targetNamespace}.${tableName}' not found`);
        }
      }

      const columns: SQLTableSchemaColumn[] = rows.map((row) => ({
        column_name: String(row.column_name || ""),
        column_type: String(row.column_type || ""),
        character_set_name: toNullString(row.character_set_name),
        collation_name: toNullString(row.collation_name),
        is_nullable: String(row.is_nullable || "NO"),
        column_default: toNullString(row.column_default),
        extra: String(row.extra || ""),
        column_comment: String(row.column_comment || ""),
      }));

      return {
        name: tableName,
        columns,
      };
    });
  }

  private async checkTableExists(
    details: MySQLFamilyConnectionConfig,
    namespaceName: string,
    tableName: string,
  ): Promise<boolean> {
    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT 1 AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1;",
        [namespaceName, tableName],
      );
      return rows.length > 0;
    });
  }
}
