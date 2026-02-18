import mysql, {
  type Connection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type {
  Column,
  ColumnSchema,
  ConnectionDetails,
  DatabaseMetadata,
  ForeignKey,
  GetTableDataInput,
  Index,
  MySQLConnectionDetails,
  NamespaceRef,
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
  quoteBacktickIdentifier,
  toNullString,
} from "./helpers";
import type { DatabaseAdapter } from "./types";

const DEFAULT_TIDB_PORT = "4000";

function ensureMySQLConnection(
  details: ConnectionDetails,
): MySQLConnectionDetails {
  if (details.kind !== "mysql") {
    throw new Error(`mysql adapter cannot handle '${details.kind}' connection`);
  }
  return details;
}

function toBoolFromYesNo(input: unknown): boolean {
  return String(input).toUpperCase() === "YES";
}

function toNumber(input: unknown): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : 0;
}

export class MySQLAdapter implements DatabaseAdapter {
  readonly kind = "mysql" as const;

  readonly capabilities = {
    namespaceKind: "database",
    supportsTransactions: true,
    supportsForeignKeys: true,
    supportsIndexes: true,
    supportsServerSideFilter: true,
  } as const;

  private getConnectionConfig(
    details: MySQLConnectionDetails,
  ): mysql.ConnectionOptions {
    const port = Number(details.port || DEFAULT_TIDB_PORT);
    const useTLS = details.useTLS || details.host.includes(".tidbcloud.com");

    return {
      host: details.host,
      port,
      user: details.user,
      password: details.password,
      database: details.dbName || undefined,
      ssl: useTLS
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
    details: MySQLConnectionDetails,
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

  async testConnection(details: ConnectionDetails): Promise<void> {
    const mysqlDetails = ensureMySQLConnection(details);
    await this.withConnection(mysqlDetails, async (conn) => {
      await conn.ping();
    });
  }

  async executeSQL(
    details: ConnectionDetails,
    query: string,
  ): Promise<SQLResult> {
    const mysqlDetails = ensureMySQLConnection(details);
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withConnection(mysqlDetails, async (conn) => {
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

  async listNamespaces(details: ConnectionDetails): Promise<NamespaceRef[]> {
    const mysqlDetails = ensureMySQLConnection(details);
    const result = await this.executeSQL(
      mysqlDetails,
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
        namespaceKind: this.capabilities.namespaceKind,
      }));
  }

  async listTables(
    details: ConnectionDetails,
    namespaceName: string,
  ): Promise<TableRef[]> {
    const mysqlDetails = ensureMySQLConnection(details);
    const targetNamespace = namespaceName || mysqlDetails.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }

    return this.withConnection(mysqlDetails, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME ASC;",
        [targetNamespace],
      );

      return rows
        .map((row) => {
          const name = typeof row.TABLE_NAME === "string" ? row.TABLE_NAME : "";
          const tableTypeRaw =
            typeof row.TABLE_TYPE === "string" ? row.TABLE_TYPE : "";
          const tableType = tableTypeRaw.toUpperCase().includes("VIEW")
            ? "view"
            : "table";

          return {
            namespaceName: targetNamespace,
            tableName: name,
            tableType,
          } as TableRef;
        })
        .filter((item) => item.tableName.length > 0);
    });
  }

  async getTableData(
    details: ConnectionDetails,
    input: GetTableDataInput,
  ): Promise<TableDataResponse> {
    const mysqlDetails = ensureMySQLConnection(details);
    const targetNamespace = input.namespaceName || mysqlDetails.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }
    if (!input.tableName) {
      throw new Error("table name is required");
    }

    const qNamespace = quoteBacktickIdentifier(targetNamespace);
    const qTable = quoteBacktickIdentifier(input.tableName);

    const descResult = await this.executeSQL(
      mysqlDetails,
      `DESCRIBE ${qNamespace}.${qTable};`,
    );
    const descRows = descResult.rows || [];
    if (!descRows.length) {
      const exists = await this.checkTableExists(
        mysqlDetails,
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

    const columns: TableColumn[] = descRows
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

    return this.withConnection(mysqlDetails, async (conn) => {
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

  async getTableSchema(
    details: ConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<TableSchema> {
    const mysqlDetails = ensureMySQLConnection(details);
    const targetNamespace = namespaceName || mysqlDetails.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }
    if (!tableName) {
      throw new Error("table name is required");
    }

    return this.withConnection(mysqlDetails, async (conn) => {
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
          mysqlDetails,
          targetNamespace,
          tableName,
        );
        if (!exists) {
          throw new Error(`table '${targetNamespace}.${tableName}' not found`);
        }
      }

      const columns: ColumnSchema[] = rows.map((row) => ({
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

  async extractMetadata(
    details: ConnectionDetails,
    namespaceName?: string,
  ): Promise<DatabaseMetadata> {
    const mysqlDetails = ensureMySQLConnection(details);
    const targetNamespace = namespaceName || mysqlDetails.dbName;
    if (!targetNamespace) {
      throw new Error("namespace name is required");
    }

    const tables = await this.listTables(mysqlDetails, targetNamespace);

    const dbMetadata: DatabaseMetadata = {
      name: targetNamespace,
      namespaceKind: this.capabilities.namespaceKind,
      tables: [],
      graph: {},
    };

    const escapedNamespace = targetNamespace.replace(/'/g, "''");
    const dbCommentResult = await this.executeSQL(
      mysqlDetails,
      `SELECT SCHEMA_COMMENT FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${escapedNamespace}';`,
    );

    const dbComment = dbCommentResult.rows?.[0]?.SCHEMA_COMMENT;
    if (typeof dbComment === "string" && dbComment.length > 0) {
      dbMetadata.dbComment = dbComment;
    }

    for (const ref of tables) {
      const table = await this.extractSingleTableMetadata(
        mysqlDetails,
        targetNamespace,
        ref.tableName,
      );
      dbMetadata.tables.push(table);

      for (const fk of table.foreignKeys || []) {
        if (fk.columnNames.length && fk.refColumnNames.length) {
          dbMetadata.graph ||= {};
          dbMetadata.graph[table.name] = dbMetadata.graph[table.name] || [];
          dbMetadata.graph[table.name].push({
            toTable: fk.refTableName,
            fromColumn: fk.columnNames[0],
            toColumn: fk.refColumnNames[0],
          });
        }
      }
    }

    return dbMetadata;
  }

  private async extractSingleTableMetadata(
    details: MySQLConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<Table> {
    const table: Table = {
      name: tableName,
      columns: [],
      foreignKeys: [],
      indexes: [],
    };

    const tableSchema = await this.getTableSchema(
      details,
      namespaceName,
      tableName,
    );

    const escapedNamespace = namespaceName.replace(/'/g, "''");
    const escapedTable = tableName.replace(/'/g, "''");

    const tableCommentResult = await this.executeSQL(
      details,
      `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${escapedNamespace}' AND TABLE_NAME = '${escapedTable}';`,
    );
    const tableComment = tableCommentResult.rows?.[0]?.TABLE_COMMENT;
    if (typeof tableComment === "string" && tableComment.length > 0) {
      table.dbComment = tableComment;
    }

    const columnCommentsResult = await this.executeSQL(
      details,
      `SELECT COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${escapedNamespace}' AND TABLE_NAME = '${escapedTable}';`,
    );

    const columnComments: Record<string, string> = {};
    for (const row of columnCommentsResult.rows || []) {
      const columnName = row.COLUMN_NAME;
      const columnComment = row.COLUMN_COMMENT;
      if (typeof columnName === "string" && typeof columnComment === "string") {
        columnComments[columnName] = columnComment;
      }
    }

    table.columns = tableSchema.columns.map(
      (col): Column => ({
        name: col.column_name,
        dataType: col.column_type,
        isNullable: toBoolFromYesNo(col.is_nullable),
        isPrimaryKey: false,
        autoIncrement:
          String(col.extra || "").toLowerCase() === "auto_increment",
        defaultValue: col.column_default.Valid
          ? col.column_default.String
          : undefined,
        dbComment: columnComments[col.column_name] || "",
      }),
    );

    const foreignKeysResult = await this.executeSQL(
      details,
      `
      SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = '${escapedNamespace}' AND TABLE_NAME = '${escapedTable}' AND REFERENCED_TABLE_NAME IS NOT NULL;
      `,
    );

    const fkMap = new Map<string, ForeignKey>();
    for (const row of foreignKeysResult.rows || []) {
      const constraintName = String(row.CONSTRAINT_NAME || "");
      const columnName = String(row.COLUMN_NAME || "");
      const refTableName = String(row.REFERENCED_TABLE_NAME || "");
      const refColumnName = String(row.REFERENCED_COLUMN_NAME || "");

      if (!constraintName) {
        continue;
      }

      const existing = fkMap.get(constraintName);
      if (existing) {
        existing.columnNames.push(columnName);
        existing.refColumnNames.push(refColumnName);
      } else {
        fkMap.set(constraintName, {
          name: constraintName,
          columnNames: [columnName],
          refTableName,
          refColumnNames: [refColumnName],
        });
      }
    }
    table.foreignKeys = Array.from(fkMap.values());

    const indexesResult = await this.executeSQL(
      details,
      `
      SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = '${escapedNamespace}' AND TABLE_NAME = '${escapedTable}'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX;
      `,
    );

    const indexMap = new Map<string, Index>();
    for (const row of indexesResult.rows || []) {
      const indexName = String(row.INDEX_NAME || "");
      const columnName = String(row.COLUMN_NAME || "");
      const nonUnique = toNumber(row.NON_UNIQUE);
      if (!indexName) {
        continue;
      }

      const existing = indexMap.get(indexName);
      if (existing) {
        existing.columnNames.push(columnName);
      } else {
        indexMap.set(indexName, {
          name: indexName,
          columnNames: [columnName],
          isUnique: nonUnique === 0,
        });
      }
    }

    table.indexes = Array.from(indexMap.values());

    const primaryKeySet = new Set(
      (table.indexes || [])
        .filter((idx) => idx.name === "PRIMARY")
        .flatMap((idx) => idx.columnNames),
    );
    for (const column of table.columns) {
      column.isPrimaryKey = primaryKeySet.has(column.name);
    }

    return table;
  }

  private async checkTableExists(
    details: MySQLConnectionDetails,
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
