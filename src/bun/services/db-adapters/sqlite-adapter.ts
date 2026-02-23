import { Database } from "bun:sqlite";
import { basename } from "node:path";
import type {
  Column,
  ColumnSchema,
  ConnectionDetails,
  DatabaseMetadata,
  ForeignKey,
  GetTableDataInput,
  Index,
  NamespaceRef,
  SQLiteConnectionDetails,
  SQLResult,
  Table,
  TableColumn,
  TableDataResponse,
  TableRef,
  TableSchema,
} from "../../../shared/contracts";
import {
  buildWhereClause,
  coerceFiniteNumber,
  normalizeRow,
  quoteDoubleQuoteIdentifier,
  toNullString,
} from "./helpers";
import type { DatabaseAdapter } from "./types";

function ensureSQLiteConnection(
  details: ConnectionDetails,
): SQLiteConnectionDetails {
  if (details.kind !== "sqlite") {
    throw new Error(
      `sqlite adapter cannot handle '${details.kind}' connection`,
    );
  }
  return details;
}

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

function foreignKeyListSQL(namespaceName: string, tableName: string): string {
  const namespace = namespaceSelector(namespaceName);
  const table = quoteSQLiteStringLiteral(tableName);
  return `PRAGMA ${namespace}.foreign_key_list(${table});`;
}

function indexListSQL(namespaceName: string, tableName: string): string {
  const namespace = namespaceSelector(namespaceName);
  const table = quoteSQLiteStringLiteral(tableName);
  return `PRAGMA ${namespace}.index_list(${table});`;
}

function indexInfoSQL(namespaceName: string, indexName: string): string {
  const namespace = namespaceSelector(namespaceName);
  const index = quoteSQLiteStringLiteral(indexName);
  return `PRAGMA ${namespace}.index_info(${index});`;
}

function toBoolean(input: unknown): boolean {
  return Number(input) > 0;
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

export class SQLiteAdapter implements DatabaseAdapter {
  readonly kind = "sqlite" as const;

  readonly capabilities = {
    namespaceKind: "attached_db",
    supportsTransactions: true,
    supportsForeignKeys: true,
    supportsIndexes: true,
    supportsServerSideFilter: true,
  } as const;

  private async withDatabase<T>(
    details: SQLiteConnectionDetails,
    run: (db: Database) => Promise<T> | T,
  ): Promise<T> {
    const db = new Database(details.filePath, {
      readonly: details.readOnly ?? false,
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

  private attachDatabases(
    db: Database,
    details: SQLiteConnectionDetails,
  ): void {
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

  async testConnection(details: ConnectionDetails): Promise<void> {
    const sqliteDetails = ensureSQLiteConnection(details);
    await this.withDatabase(sqliteDetails, (db) => {
      db.query("SELECT 1").get();
    });
  }

  async executeSQL(
    details: ConnectionDetails,
    sql: string,
  ): Promise<SQLResult> {
    const sqliteDetails = ensureSQLiteConnection(details);
    const trimmedQuery = sql.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withDatabase(sqliteDetails, (db) => {
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

  async listNamespaces(details: ConnectionDetails): Promise<NamespaceRef[]> {
    const sqliteDetails = ensureSQLiteConnection(details);

    return this.withDatabase(sqliteDetails, (db) => {
      const rows = db.query("PRAGMA database_list;").all() as Record<
        string,
        unknown
      >[];
      return rows
        .map((row) => {
          const namespaceName = typeof row.name === "string" ? row.name : "";
          const filePath = typeof row.file === "string" ? row.file : "";
          return {
            namespaceName,
            namespaceKind: this.capabilities.namespaceKind,
            displayName: namespaceDisplayName(namespaceName, filePath),
          };
        })
        .filter((item) => item.namespaceName.length > 0);
    });
  }

  async listTables(
    details: ConnectionDetails,
    namespaceName: string,
  ): Promise<TableRef[]> {
    const sqliteDetails = ensureSQLiteConnection(details);
    const targetNamespace = namespaceName || "main";

    return this.withDatabase(sqliteDetails, (db) => {
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
          return {
            namespaceName: targetNamespace,
            tableName,
            tableType: type === "view" ? "view" : "table",
          } as TableRef;
        })
        .filter((item) => item.tableName.length > 0);
    });
  }

  async getTableSchema(
    details: ConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<TableSchema> {
    const sqliteDetails = ensureSQLiteConnection(details);
    const targetNamespace = namespaceName || "main";
    if (!tableName) {
      throw new Error("table name is required");
    }

    return this.withDatabase(sqliteDetails, (db) => {
      const tableExists = this.checkTableExists(db, targetNamespace, tableName);
      if (!tableExists) {
        throw new Error(`table '${targetNamespace}.${tableName}' not found`);
      }

      const rows = db
        .query(tableInfoSQL(targetNamespace, tableName))
        .all() as Record<string, unknown>[];

      const columns: ColumnSchema[] = rows.map((row) => {
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

  async getTableData(
    details: ConnectionDetails,
    input: GetTableDataInput,
  ): Promise<TableDataResponse> {
    const sqliteDetails = ensureSQLiteConnection(details);
    const targetNamespace = input.namespaceName || "main";
    if (!input.tableName) {
      throw new Error("table name is required");
    }

    const schema = await this.getTableSchema(
      sqliteDetails,
      targetNamespace,
      input.tableName,
    );

    const columns: TableColumn[] = schema.columns.map((column) => ({
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

    return this.withDatabase(sqliteDetails, (db) => {
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

  async extractMetadata(
    details: ConnectionDetails,
    namespaceName?: string,
  ): Promise<DatabaseMetadata> {
    const sqliteDetails = ensureSQLiteConnection(details);
    const targetNamespace = namespaceName || "main";

    const refs = await this.listTables(sqliteDetails, targetNamespace);

    const metadata: DatabaseMetadata = {
      name: targetNamespace,
      namespaceKind: this.capabilities.namespaceKind,
      tables: [],
      graph: {},
    };

    await this.withDatabase(sqliteDetails, async (db) => {
      for (const ref of refs) {
        const table = await this.extractSingleTableMetadata(
          db,
          targetNamespace,
          ref.tableName,
        );

        metadata.tables.push(table);

        for (const fk of table.foreignKeys || []) {
          if (fk.columnNames.length && fk.refColumnNames.length) {
            metadata.graph ||= {};
            metadata.graph[table.name] = metadata.graph[table.name] || [];
            metadata.graph[table.name].push({
              toTable: fk.refTableName,
              fromColumn: fk.columnNames[0],
              toColumn: fk.refColumnNames[0],
            });
          }
        }
      }
    });

    return metadata;
  }

  private async extractSingleTableMetadata(
    db: Database,
    namespaceName: string,
    tableName: string,
  ): Promise<Table> {
    const schemaRows = db
      .query(tableInfoSQL(namespaceName, tableName))
      .all() as Record<string, unknown>[];

    const primaryColumns = new Set(
      schemaRows
        .filter((row) => Number(row.pk) > 0)
        .map((row) => String(row.name || ""))
        .filter((name) => name.length > 0),
    );

    const columns: Column[] = schemaRows.map((row) => {
      const defaultValue = row.dflt_value;
      const type = typeof row.type === "string" ? row.type : "";
      return {
        name: String(row.name || ""),
        dataType: type,
        isNullable: Number(row.notnull) === 0,
        defaultValue: defaultValue === null ? undefined : defaultValue,
        isPrimaryKey: Number(row.pk) > 0,
        autoIncrement: Number(row.pk) > 0 && type.toUpperCase() === "INTEGER",
        dbComment: "",
      };
    });

    const foreignRows = db
      .query(foreignKeyListSQL(namespaceName, tableName))
      .all() as Record<string, unknown>[];

    const foreignKeyMap = new Map<number, ForeignKey>();
    for (const row of foreignRows) {
      const id = Number(row.id);
      const columnName = String(row.from || "");
      const refTableName = String(row.table || "");
      const refColumnName = String(row.to || "");

      const existing = foreignKeyMap.get(id);
      if (existing) {
        existing.columnNames.push(columnName);
        existing.refColumnNames.push(refColumnName);
      } else {
        foreignKeyMap.set(id, {
          name: `fk_${tableName}_${id}`,
          columnNames: [columnName],
          refTableName,
          refColumnNames: [refColumnName],
        });
      }
    }

    const indexRows = db
      .query(indexListSQL(namespaceName, tableName))
      .all() as Record<string, unknown>[];

    const indexes: Index[] = [];
    for (const row of indexRows) {
      const indexName = String(row.name || "");
      if (!indexName) {
        continue;
      }

      const indexInfoRows = db
        .query(indexInfoSQL(namespaceName, indexName))
        .all() as Record<string, unknown>[];

      const columnNames = indexInfoRows
        .map((item) => String(item.name || ""))
        .filter((item) => item.length > 0);

      indexes.push({
        name: indexName,
        columnNames,
        isUnique: toBoolean(row.unique),
      });
    }

    for (const column of columns) {
      if (primaryColumns.has(column.name)) {
        column.isPrimaryKey = true;
      }
    }

    return {
      name: tableName,
      columns,
      foreignKeys: Array.from(foreignKeyMap.values()),
      indexes,
    };
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
