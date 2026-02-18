import { SQL } from "bun";
import type {
  Column,
  ColumnSchema,
  ConnectionDetails,
  DatabaseMetadata,
  ForeignKey,
  GetTableDataInput,
  Index,
  NamespaceRef,
  PostgresConnectionDetails,
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

const DEFAULT_POSTGRES_PORT = "5432";

function ensurePostgresConnection(
  details: ConnectionDetails,
): PostgresConnectionDetails {
  if (details.kind !== "postgres") {
    throw new Error(
      `postgres adapter cannot handle '${details.kind}' connection`,
    );
  }
  return details;
}

function isReadQuery(sql: string): boolean {
  return /^(SELECT|SHOW|EXPLAIN|WITH)\b/i.test(sql.trim());
}

function inferColumnType(row: Record<string, unknown>): string {
  const dataType = typeof row.data_type === "string" ? row.data_type : "";
  const udtName = typeof row.udt_name === "string" ? row.udt_name : "";
  if (dataType === "USER-DEFINED" && udtName) {
    return udtName;
  }
  return dataType || udtName || "text";
}

export class PostgresAdapter implements DatabaseAdapter {
  readonly kind = "postgres" as const;

  readonly capabilities = {
    namespaceKind: "schema",
    supportsTransactions: true,
    supportsForeignKeys: true,
    supportsIndexes: true,
    supportsServerSideFilter: true,
  } as const;

  private async withClient<T>(
    details: PostgresConnectionDetails,
    run: (client: SQL) => Promise<T>,
  ): Promise<T> {
    const port = Number(details.port || DEFAULT_POSTGRES_PORT);
    const client = new SQL({
      adapter: "postgres",
      hostname: details.host,
      port,
      username: details.user,
      password: details.password,
      database: details.dbName,
      tls: details.useTLS,
      max: 1,
    });

    try {
      await client.connect();
      return await run(client);
    } finally {
      await client.close({ timeout: 1 });
    }
  }

  async testConnection(details: ConnectionDetails): Promise<void> {
    const postgresDetails = ensurePostgresConnection(details);
    await this.withClient(postgresDetails, async (client) => {
      await client.unsafe("SELECT 1");
    });
  }

  async executeSQL(
    details: ConnectionDetails,
    sql: string,
  ): Promise<SQLResult> {
    const postgresDetails = ensurePostgresConnection(details);
    const trimmedQuery = sql.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withClient(postgresDetails, async (client) => {
      const rows = (await client.unsafe(trimmedQuery)) as Record<
        string,
        unknown
      >[];
      const normalizedRows = Array.isArray(rows)
        ? rows.map((row) => normalizeRow(row))
        : [];

      if (isReadQuery(trimmedQuery)) {
        const columns = normalizedRows[0] ? Object.keys(normalizedRows[0]) : [];
        return {
          columns,
          rows: normalizedRows,
        };
      }

      return {
        rowsAffected: Array.isArray(rows) ? rows.length : undefined,
        message: "Command executed successfully.",
      };
    });
  }

  async listNamespaces(details: ConnectionDetails): Promise<NamespaceRef[]> {
    const postgresDetails = ensurePostgresConnection(details);

    return this.withClient(postgresDetails, async (client) => {
      const rows = (await client.unsafe(
        `
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog')
          AND schema_name NOT LIKE 'pg_toast%'
          AND schema_name NOT LIKE 'pg_temp%'
        ORDER BY schema_name ASC;
        `,
      )) as Record<string, unknown>[];

      return rows
        .map((row) => {
          const namespaceName =
            typeof row.schema_name === "string" ? row.schema_name : "";
          return {
            namespaceName,
            namespaceKind: this.capabilities.namespaceKind,
          };
        })
        .filter((item) => item.namespaceName.length > 0);
    });
  }

  async listTables(
    details: ConnectionDetails,
    namespaceName: string,
  ): Promise<TableRef[]> {
    const postgresDetails = ensurePostgresConnection(details);
    const targetNamespace = namespaceName || "public";

    return this.withClient(postgresDetails, async (client) => {
      const rows = (await client.unsafe(
        `
        SELECT table_name, table_type
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY table_name ASC;
        `,
        [targetNamespace],
      )) as Record<string, unknown>[];

      return rows
        .map((row) => {
          const tableName =
            typeof row.table_name === "string" ? row.table_name : "";
          const tableTypeRaw =
            typeof row.table_type === "string" ? row.table_type : "";
          return {
            namespaceName: targetNamespace,
            tableName,
            tableType: tableTypeRaw.toUpperCase().includes("VIEW")
              ? "view"
              : "table",
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
    const postgresDetails = ensurePostgresConnection(details);
    if (!tableName) {
      throw new Error("table name is required");
    }

    const targetNamespace = namespaceName || "public";

    return this.withClient(postgresDetails, async (client) => {
      const rows = (await client.unsafe(
        `
        SELECT
          column_name,
          data_type,
          udt_name,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position;
        `,
        [targetNamespace, tableName],
      )) as Record<string, unknown>[];

      if (!rows.length) {
        throw new Error(`table '${targetNamespace}.${tableName}' not found`);
      }

      const columnCommentsRows = (await client.unsafe(
        `
        SELECT
          a.attname AS column_name,
          pgd.description AS column_comment
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
        JOIN pg_catalog.pg_namespace ns ON c.relnamespace = ns.oid
        LEFT JOIN pg_catalog.pg_description pgd
          ON pgd.objoid = c.oid AND pgd.objsubid = a.attnum
        WHERE ns.nspname = $1
          AND c.relname = $2
          AND a.attnum > 0
          AND NOT a.attisdropped;
        `,
        [targetNamespace, tableName],
      )) as Record<string, unknown>[];

      const commentsByColumn = new Map<string, string>();
      for (const row of columnCommentsRows) {
        const name = typeof row.column_name === "string" ? row.column_name : "";
        const comment =
          typeof row.column_comment === "string" ? row.column_comment : "";
        if (name) {
          commentsByColumn.set(name, comment);
        }
      }

      const columns: ColumnSchema[] = rows.map((row) => {
        const defaultValue = row.column_default;
        const columnName =
          typeof row.column_name === "string" ? row.column_name : "";

        return {
          column_name: columnName,
          column_type: inferColumnType(row),
          character_set_name: toNullString(null),
          collation_name: toNullString(null),
          is_nullable: String(row.is_nullable || "NO"),
          column_default: toNullString(defaultValue),
          extra:
            typeof defaultValue === "string" && defaultValue.includes("nextval")
              ? "auto_increment"
              : "",
          column_comment: commentsByColumn.get(columnName) || "",
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
    const postgresDetails = ensurePostgresConnection(details);
    const targetNamespace = input.namespaceName || "public";
    if (!input.tableName) {
      throw new Error("table name is required");
    }

    const schema = await this.getTableSchema(
      postgresDetails,
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

    let placeholderIndex = 0;
    const { clause, params } = buildWhereClause(
      input.filterParams?.filters || [],
      allowedColumns,
      quoteDoubleQuoteIdentifier,
      () => {
        placeholderIndex += 1;
        return `$${placeholderIndex}`;
      },
    );

    const limit = Math.max(1, Math.floor(input.limit || 100));
    const offset = Math.max(0, Math.floor(input.offset || 0));

    const limitPlaceholder = `$${params.length + 1}`;
    const offsetPlaceholder = `$${params.length + 2}`;

    return this.withClient(postgresDetails, async (client) => {
      const dataRows = (await client.unsafe(
        `SELECT * FROM ${qNamespace}.${qTable}${clause} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};`,
        [...params, limit, offset],
      )) as Record<string, unknown>[];

      const normalizedRows = dataRows.map((row) => normalizeRow(row));

      const countRows = (await client.unsafe(
        `SELECT COUNT(*)::bigint AS total FROM ${qNamespace}.${qTable}${clause};`,
        params,
      )) as Record<string, unknown>[];

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
    const postgresDetails = ensurePostgresConnection(details);
    const targetNamespace = namespaceName || "public";
    const refs = await this.listTables(postgresDetails, targetNamespace);

    const metadata: DatabaseMetadata = {
      name: targetNamespace,
      namespaceKind: this.capabilities.namespaceKind,
      tables: [],
      graph: {},
    };

    for (const ref of refs) {
      const table = await this.extractSingleTableMetadata(
        postgresDetails,
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

    return metadata;
  }

  private async extractSingleTableMetadata(
    details: PostgresConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<Table> {
    const schema = await this.getTableSchema(details, namespaceName, tableName);

    return this.withClient(details, async (client) => {
      const primaryRows = (await client.unsafe(
        `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
        WHERE tc.table_schema = $1
          AND tc.table_name = $2
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position;
        `,
        [namespaceName, tableName],
      )) as Record<string, unknown>[];

      const primarySet = new Set(
        primaryRows
          .map((row) =>
            typeof row.column_name === "string" ? row.column_name : "",
          )
          .filter((item) => item.length > 0),
      );

      const foreignRows = (await client.unsafe(
        `
        SELECT
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = $1
          AND tc.table_name = $2
          AND tc.constraint_type = 'FOREIGN KEY';
        `,
        [namespaceName, tableName],
      )) as Record<string, unknown>[];

      const foreignMap = new Map<string, ForeignKey>();
      for (const row of foreignRows) {
        const name =
          typeof row.constraint_name === "string" ? row.constraint_name : "";
        const columnName =
          typeof row.column_name === "string" ? row.column_name : "";
        const refTableName =
          typeof row.foreign_table_name === "string"
            ? row.foreign_table_name
            : "";
        const refColumnName =
          typeof row.foreign_column_name === "string"
            ? row.foreign_column_name
            : "";

        if (!name) {
          continue;
        }

        const existing = foreignMap.get(name);
        if (existing) {
          existing.columnNames.push(columnName);
          existing.refColumnNames.push(refColumnName);
        } else {
          foreignMap.set(name, {
            name,
            columnNames: [columnName],
            refTableName,
            refColumnNames: [refColumnName],
          });
        }
      }

      const indexRows = (await client.unsafe(
        `
        SELECT
          i.relname AS index_name,
          ix.indisunique AS is_unique,
          array_agg(a.attname ORDER BY ordinality) AS column_names
        FROM pg_class t
        JOIN pg_namespace ns ON ns.oid = t.relnamespace
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
          ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = keys.attnum
        WHERE ns.nspname = $1
          AND t.relname = $2
        GROUP BY i.relname, ix.indisunique
        ORDER BY i.relname;
        `,
        [namespaceName, tableName],
      )) as Record<string, unknown>[];

      const indexes: Index[] = indexRows
        .map((row) => {
          const indexName =
            typeof row.index_name === "string" ? row.index_name : "";
          const unique =
            row.is_unique === true ||
            String(row.is_unique).toLowerCase() === "t";
          const columnNames = Array.isArray(row.column_names)
            ? row.column_names
                .map((item) => (typeof item === "string" ? item : ""))
                .filter((item) => item.length > 0)
            : [];
          return {
            name: indexName,
            columnNames,
            isUnique: unique,
          };
        })
        .filter((item) => item.name.length > 0);

      const columns: Column[] = schema.columns.map((column) => ({
        name: column.column_name,
        dataType: column.column_type,
        isNullable: String(column.is_nullable).toUpperCase() === "YES",
        defaultValue: column.column_default.Valid
          ? column.column_default.String
          : undefined,
        isPrimaryKey: primarySet.has(column.column_name),
        autoIncrement:
          column.column_default.Valid &&
          column.column_default.String.includes("nextval"),
        dbComment: column.column_comment,
      }));

      return {
        name: tableName,
        columns,
        foreignKeys: Array.from(foreignMap.values()),
        indexes,
      };
    });
  }
}
