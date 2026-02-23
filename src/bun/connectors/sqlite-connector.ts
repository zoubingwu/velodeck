import { Database } from "bun:sqlite";
import { basename } from "node:path";
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
  readStringOption,
} from "../utils/connector-options";
import type {
  SQLiteAttachedDatabaseConfig,
  SQLiteConnectionConfig,
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
  quoteDoubleQuoteIdentifier,
  toNullString,
} from "../utils/sql-utils";

const SQLITE_MANIFEST: ConnectorManifest = {
  kind: "sqlite",
  label: "SQLite",
  category: "file",
  capabilities: {
    supportsSqlExecution: true,
    supportsSchemaInspection: true,
    supportsServerSideFilter: true,
    supportsPagination: true,
    supportsMetadataExtraction: true,
  },
  formFields: [
    {
      key: "filePath",
      label: "File Path",
      type: "file",
      required: true,
      placeholder: "/path/to/database.sqlite",
    },
  ],
};

function quoteSQLiteStringLiteral(input: string): string {
  return `'${input.replace(/'/g, "''")}'`;
}

function namespaceSelector(namespaceName: string): string {
  const name = namespaceName || "main";
  return quoteDoubleQuoteIdentifier(name);
}

function namespaceDisplayName(namespaceName: string, filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/").trim();
  if (!normalizedPath) {
    return namespaceName;
  }

  const fileName = basename(normalizedPath);
  return fileName || namespaceName;
}

function tableInfoSQL(namespaceName: string, tableName: string): string {
  const namespace = namespaceSelector(namespaceName);
  const table = quoteSQLiteStringLiteral(tableName);
  return `PRAGMA ${namespace}.table_info(${table});`;
}

function toSQLiteBinding(
  value: unknown,
): string | number | bigint | boolean | null | Uint8Array {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export class SQLiteConnector implements SQLConnector {
  readonly manifest = SQLITE_MANIFEST;

  validateOptions(options: Record<string, unknown>): void {
    ensureRequiredString(readStringOption(options, "filePath"), "filePath");
  }

  async testConnection(profile: ConnectionProfile): Promise<void> {
    const details = this.toDetails(profile);
    await this.withDatabase(details, (db) => {
      db.query("SELECT 1").get();
    });
  }

  async getVersion(profile: ConnectionProfile): Promise<string> {
    const result = await this.executeSQL(
      profile,
      "SELECT sqlite_version() AS version;",
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
    const namespaceName = input.entity.namespace || "main";

    const result = await this.getTableData(details, {
      namespaceName,
      tableName: input.entity.name,
      limit: input.limit,
      offset: input.offset || 0,
      filterParams: input.filters?.length ? { filters: input.filters } : null,
    });

    return {
      entity: {
        ...input.entity,
        connectorKind: profile.kind,
      },
      fields: result.columns.map((column) => ({
        name: column.name,
        type: column.type,
      })),
      rows: result.rows,
      totalRows: result.totalRows,
    };
  }

  async getEntitySchema(
    profile: ConnectionProfile,
    entity: DataEntityRef,
  ): Promise<EntitySchema> {
    const details = this.toDetails(profile);
    const namespaceName = entity.namespace || "main";

    const schema = await this.getTableSchema(
      details,
      namespaceName,
      entity.name,
    );

    const fields: EntityField[] = schema.columns.map((column) => ({
      name: column.column_name,
      type: column.column_type,
      nullable: String(column.is_nullable).toUpperCase() === "YES",
      description: column.column_comment || undefined,
      primaryKey:
        String(column.extra || "")
          .toLowerCase()
          .includes("primary") ||
        String(column.extra || "")
          .toLowerCase()
          .includes("auto_increment"),
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

  private toDetails(profile: ConnectionProfile): SQLiteConnectionConfig {
    this.validateOptions(profile.options);

    const attachedRaw = profile.options.attachedDatabases;
    const attachedDatabases: SQLiteAttachedDatabaseConfig[] = [];

    if (Array.isArray(attachedRaw)) {
      for (const item of attachedRaw) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const record = item as Record<string, unknown>;
        const name = readStringOption(record, "name").trim();
        const filePath = readStringOption(record, "filePath").trim();
        if (!name || !filePath) {
          continue;
        }

        attachedDatabases.push({
          name,
          filePath,
        });
      }
    }

    return {
      id: profile.id,
      name: profile.name,
      lastUsed: profile.lastUsed,
      kind: "sqlite",
      filePath: readStringOption(profile.options, "filePath"),
      attachedDatabases,
    };
  }

  private async withDatabase<T>(
    details: SQLiteConnectionConfig,
    run: (db: Database) => Promise<T> | T,
  ): Promise<T> {
    const db = new Database(details.filePath, {
      readonly: false,
      create: false,
      strict: false,
    });

    try {
      this.attachDatabases(db, details);
      return await run(db);
    } finally {
      db.close();
    }
  }

  private attachDatabases(db: Database, details: SQLiteConnectionConfig): void {
    const attachments = details.attachedDatabases || [];
    for (const attachment of attachments) {
      if (!attachment.name || !attachment.filePath) {
        continue;
      }
      const alias = quoteDoubleQuoteIdentifier(attachment.name);
      const filePath = quoteSQLiteStringLiteral(attachment.filePath);
      db.run(`ATTACH DATABASE ${filePath} AS ${alias};`);
    }
  }

  private async executeSQLWithDetails(
    details: SQLiteConnectionConfig,
    sql: string,
  ): Promise<SQLResult> {
    const trimmedQuery = sql.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withDatabase(details, (db) => {
      const isRead = /^(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(trimmedQuery);

      if (isRead) {
        const rows = db.query(trimmedQuery).all() as Record<string, unknown>[];
        const normalizedRows = rows.map((row) => normalizeRow(row));
        const columns = normalizedRows[0] ? Object.keys(normalizedRows[0]) : [];
        return {
          columns,
          rows: normalizedRows,
        };
      }

      const changes = db.query(trimmedQuery).run();
      const insertIdRaw = changes.lastInsertRowid;
      const lastInsertId =
        typeof insertIdRaw === "bigint" ? Number(insertIdRaw) : insertIdRaw;

      return {
        rowsAffected: changes.changes,
        lastInsertId:
          Number.isFinite(lastInsertId) && lastInsertId > 0
            ? lastInsertId
            : undefined,
        message: "Command executed successfully.",
      };
    });
  }

  private async listNamespaces(
    details: SQLiteConnectionConfig,
  ): Promise<SQLNamespaceRef[]> {
    return this.withDatabase(details, (db) => {
      const rows = db.query("PRAGMA database_list;").all() as Record<
        string,
        unknown
      >[];
      return rows
        .map((row) => {
          const namespaceName = typeof row.name === "string" ? row.name : "";
          const filePath = typeof row.file === "string" ? row.file : "";
          const namespaceKind: SQLNamespaceRef["namespaceKind"] = "attached_db";
          return {
            namespaceName,
            namespaceKind,
            displayName: namespaceDisplayName(namespaceName, filePath),
          };
        })
        .filter((item) => item.namespaceName.length > 0);
    });
  }

  private async listTables(
    details: SQLiteConnectionConfig,
    namespaceName: string,
  ): Promise<SQLTableRef[]> {
    const targetNamespace = namespaceName || "main";

    return this.withDatabase(details, (db) => {
      const namespace = namespaceSelector(targetNamespace);
      const rows = db
        .query(
          `
          SELECT name, type
          FROM ${namespace}.sqlite_master
          WHERE type IN ('table', 'view')
            AND name NOT LIKE 'sqlite_%'
          ORDER BY name ASC;
          `,
        )
        .all() as Record<string, unknown>[];

      return rows
        .map((row) => {
          const tableName = typeof row.name === "string" ? row.name : "";
          const type = typeof row.type === "string" ? row.type : "table";
          const tableType: SQLTableRef["tableType"] =
            type === "view" ? "view" : "table";
          return {
            namespaceName: targetNamespace,
            tableName,
            tableType,
          };
        })
        .filter((item) => item.tableName.length > 0);
    });
  }

  private async getTableSchema(
    details: SQLiteConnectionConfig,
    namespaceName: string,
    tableName: string,
  ): Promise<SQLTableSchema> {
    const targetNamespace = namespaceName || "main";
    if (!tableName) {
      throw new Error("table name is required");
    }

    return this.withDatabase(details, (db) => {
      const tableExists = this.checkTableExists(db, targetNamespace, tableName);
      if (!tableExists) {
        throw new Error(`table '${targetNamespace}.${tableName}' not found`);
      }

      const rows = db
        .query(tableInfoSQL(targetNamespace, tableName))
        .all() as Record<string, unknown>[];

      const columns: SQLTableSchemaColumn[] = rows.map((row) => {
        const defaultValue = row.dflt_value;
        const nullable = Number(row.notnull) === 0;
        const type = typeof row.type === "string" ? row.type : "";

        return {
          column_name: String(row.name || ""),
          column_type: type,
          character_set_name: toNullString(null),
          collation_name: toNullString(null),
          is_nullable: nullable ? "YES" : "NO",
          column_default: toNullString(defaultValue),
          extra:
            Number(row.pk) > 0 && type.toUpperCase() === "INTEGER"
              ? "auto_increment"
              : "",
          column_comment: "",
        };
      });

      return {
        name: tableName,
        columns,
      };
    });
  }

  private async getTableData(
    details: SQLiteConnectionConfig,
    input: SQLReadTableInput,
  ): Promise<SQLTableDataPage> {
    const targetNamespace = input.namespaceName || "main";
    if (!input.tableName) {
      throw new Error("table name is required");
    }

    const schema = await this.getTableSchema(
      details,
      targetNamespace,
      input.tableName,
    );

    const columns: SQLTableColumn[] = schema.columns.map((column) => ({
      name: column.column_name,
      type: column.column_type,
    }));

    const allowedColumns = new Set(columns.map((column) => column.name));
    const qNamespace = quoteDoubleQuoteIdentifier(targetNamespace);
    const qTable = quoteDoubleQuoteIdentifier(input.tableName);

    const { clause, params } = buildWhereClause(
      input.filterParams?.filters || [],
      allowedColumns,
      quoteDoubleQuoteIdentifier,
      () => "?",
    );
    const sqliteParams = params.map((param) => toSQLiteBinding(param));

    const limit = Math.max(1, Math.floor(input.limit || 100));
    const offset = Math.max(0, Math.floor(input.offset || 0));

    return this.withDatabase(details, (db) => {
      const rows = db
        .query(
          `SELECT * FROM ${qNamespace}.${qTable}${clause} LIMIT ? OFFSET ?;`,
        )
        .all(...(sqliteParams as any[]), limit, offset) as Record<
        string,
        unknown
      >[];

      const normalizedRows = rows.map((row) => normalizeRow(row));

      const countRows = db
        .query(
          `SELECT COUNT(*) AS total FROM ${qNamespace}.${qTable}${clause};`,
        )
        .all(...(sqliteParams as any[])) as Record<string, unknown>[];

      const totalRaw = countRows[0]?.total;
      const totalRows = coerceFiniteNumber(totalRaw) ?? undefined;

      return {
        columns,
        rows: normalizedRows,
        totalRows,
      };
    });
  }

  private checkTableExists(
    db: Database,
    namespaceName: string,
    tableName: string,
  ): boolean {
    const namespace = namespaceSelector(namespaceName);
    const rows = db
      .query(
        `
        SELECT 1 AS found
        FROM ${namespace}.sqlite_master
        WHERE name = ? AND type IN ('table', 'view')
        LIMIT 1;
        `,
      )
      .all(tableName) as Record<string, unknown>[];

    return rows.length > 0;
  }
}
