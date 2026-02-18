import mysql, {
  type Connection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type {
  ColumnSchema,
  ConnectionDetails,
  SQLResult,
  ServerSideFilter,
  TableColumn,
  TableDataResponse,
  TableSchema,
} from "../../shared/contracts";

const DEFAULT_TIDB_PORT = "4000";

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = normalizeValue(value);
  }
  return out;
}

function toNullString(value: unknown): { String: string; Valid: boolean } {
  if (value === null || value === undefined) {
    return { String: "", Valid: false };
  }
  return { String: String(value), Valid: true };
}

function quoteIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("identifier cannot be empty");
  }

  if (!/^[A-Za-z0-9_$-]+$/.test(trimmed)) {
    throw new Error(`unsafe identifier: ${trimmed}`);
  }

  return `\`${trimmed}\``;
}

function coerceFiniteNumber(input: unknown): number | null {
  const n = Number(input);
  if (Number.isFinite(n)) {
    return n;
  }
  return null;
}

function flattenOptionValues(values: unknown[]): string[] {
  if (!values.length) {
    return [];
  }

  if (Array.isArray(values[0])) {
    return (values[0] as unknown[])
      .map((item) => String(item))
      .filter((item) => item.length > 0);
  }

  return values.map((item) => String(item)).filter((item) => item.length > 0);
}

export class DatabaseService {
  private getConnectionConfig(details: ConnectionDetails): mysql.ConnectionOptions {
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
    details: ConnectionDetails,
    run: (conn: Connection) => Promise<T>,
  ): Promise<T> {
    const conn = await mysql.createConnection(this.getConnectionConfig(details));
    try {
      return await run(conn);
    } finally {
      await conn.end();
    }
  }

  async testConnection(details: ConnectionDetails): Promise<boolean> {
    return this.withConnection(details, async (conn) => {
      await conn.ping();
      return true;
    });
  }

  async executeSQL(details: ConnectionDetails, query: string): Promise<SQLResult> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withConnection(details, async (conn) => {
      const [rows, fields] = await conn.query(trimmedQuery);

      if (Array.isArray(rows)) {
        const normalizedRows = rows.map((row) => normalizeRow(row as RowDataPacket));
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

  async listDatabases(details: ConnectionDetails): Promise<string[]> {
    const result = await this.executeSQL(
      details,
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME ASC;",
    );

    const rows = result.rows || [];
    return rows
      .map((row) => {
        const value = row.SCHEMA_NAME;
        return typeof value === "string" ? value : "";
      })
      .filter((name) => name.length > 0);
  }

  async listTables(details: ConnectionDetails, dbName: string): Promise<string[]> {
    const targetDB = dbName || details.dbName;
    if (!targetDB) {
      throw new Error("no database specified or configured in the connection details");
    }

    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME ASC;",
        [targetDB],
      );

      return rows
        .map((row) => row.TABLE_NAME)
        .map((name) => (typeof name === "string" ? name : ""))
        .filter((name) => name.length > 0);
    });
  }

  private buildWhereClause(
    filters: ServerSideFilter[],
    allowedColumns: Set<string>,
  ): { clause: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    for (const filter of filters) {
      if (!allowedColumns.has(filter.columnId)) {
        continue;
      }

      const col = quoteIdentifier(filter.columnId);
      const operator = filter.operator;
      const type = filter.type;
      const values = filter.values || [];

      if (!values.length) {
        continue;
      }

      if (type === "text") {
        const value = String(values[0] ?? "");
        if (operator === "contains") {
          clauses.push(`${col} LIKE ?`);
          params.push(`%${value}%`);
        }
        if (operator === "does not contain") {
          clauses.push(`${col} NOT LIKE ?`);
          params.push(`%${value}%`);
        }
        continue;
      }

      if (type === "number") {
        const first = coerceFiniteNumber(values[0]);
        const second = coerceFiniteNumber(values[1]);

        if (operator === "is" && first !== null) {
          clauses.push(`${col} = ?`);
          params.push(first);
        }
        if (operator === "is not" && first !== null) {
          clauses.push(`${col} != ?`);
          params.push(first);
        }
        if (operator === "is greater than" && first !== null) {
          clauses.push(`${col} > ?`);
          params.push(first);
        }
        if (operator === "is greater than or equal to" && first !== null) {
          clauses.push(`${col} >= ?`);
          params.push(first);
        }
        if (operator === "is less than" && first !== null) {
          clauses.push(`${col} < ?`);
          params.push(first);
        }
        if (operator === "is less than or equal to" && first !== null) {
          clauses.push(`${col} <= ?`);
          params.push(first);
        }
        if (operator === "is between" && first !== null && second !== null) {
          clauses.push(`${col} BETWEEN ? AND ?`);
          params.push(first, second);
        }
        if (operator === "is not between" && first !== null && second !== null) {
          clauses.push(`${col} NOT BETWEEN ? AND ?`);
          params.push(first, second);
        }
        continue;
      }

      if (type === "date") {
        const first = values[0];
        const second = values[1];

        if (operator === "is") {
          clauses.push(`DATE(${col}) = DATE(?)`);
          params.push(first);
        }
        if (operator === "is not") {
          clauses.push(`DATE(${col}) != DATE(?)`);
          params.push(first);
        }
        if (operator === "is between" && second !== undefined) {
          clauses.push(`DATE(${col}) BETWEEN DATE(?) AND DATE(?)`);
          params.push(first, second);
        }
        if (operator === "is not between" && second !== undefined) {
          clauses.push(`DATE(${col}) NOT BETWEEN DATE(?) AND DATE(?)`);
          params.push(first, second);
        }
        continue;
      }

      if (type === "option" || type === "multiOption") {
        const flattened = flattenOptionValues(values);
        if (!flattened.length) {
          continue;
        }

        const placeholders = flattened.map(() => "?").join(", ");
        if (
          operator === "is" ||
          operator === "is any of" ||
          operator === "include" ||
          operator === "include any of"
        ) {
          clauses.push(`${col} IN (${placeholders})`);
          params.push(...flattened);
        }

        if (
          operator === "is not" ||
          operator === "is none of" ||
          operator === "exclude" ||
          operator === "exclude if any of"
        ) {
          clauses.push(`${col} NOT IN (${placeholders})`);
          params.push(...flattened);
        }
      }
    }

    if (!clauses.length) {
      return { clause: "", params: [] };
    }

    return {
      clause: ` WHERE ${clauses.join(" AND ")}`,
      params,
    };
  }

  async getTableData(
    details: ConnectionDetails,
    dbName: string,
    tableName: string,
    limit: number,
    offset: number,
    filterParams?: { filters?: ServerSideFilter[] } | null,
  ): Promise<TableDataResponse> {
    const targetDB = dbName || details.dbName;
    if (!targetDB) {
      throw new Error("database name is required either explicitly or in connection details");
    }
    if (!tableName) {
      throw new Error("table name is required");
    }

    const qDB = quoteIdentifier(targetDB);
    const qTable = quoteIdentifier(tableName);

    const descResult = await this.executeSQL(details, `DESCRIBE ${qDB}.${qTable};`);
    const descRows = descResult.rows || [];
    if (!descRows.length) {
      const exists = await this.checkTableExists(details, targetDB, tableName);
      if (!exists) {
        throw new Error(`table '${targetDB}.${tableName}' not found`);
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

    const sanitizedLimit = Math.max(1, Math.floor(limit || 100));
    const sanitizedOffset = Math.max(0, Math.floor(offset || 0));

    const { clause, params } = this.buildWhereClause(
      filterParams?.filters || [],
      allowedColumns,
    );

    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT * FROM ${qDB}.${qTable}${clause} LIMIT ? OFFSET ?;`,
        [...params, sanitizedLimit, sanitizedOffset],
      );

      const normalizedRows = rows.map((row) => normalizeRow(row));

      const [countRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM ${qDB}.${qTable}${clause};`,
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
    dbName: string,
    tableName: string,
  ): Promise<TableSchema> {
    const targetDB = dbName || details.dbName;
    if (!targetDB) {
      throw new Error("database name is required either explicitly or in connection details");
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
        [targetDB, tableName],
      );

      if (!rows.length) {
        const exists = await this.checkTableExists(details, targetDB, tableName);
        if (!exists) {
          throw new Error(`table '${targetDB}.${tableName}' not found`);
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

  async checkTableExists(
    details: ConnectionDetails,
    dbName: string,
    tableName: string,
  ): Promise<boolean> {
    return this.withConnection(details, async (conn) => {
      const [rows] = await conn.execute<RowDataPacket[]>(
        "SELECT 1 AS found FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1;",
        [dbName, tableName],
      );
      return rows.length > 0;
    });
  }
}
