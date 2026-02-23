import { SQL } from "bun";
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
  PostgresConnectionConfig,
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

const POSTGRES_MANIFEST: ConnectorManifest = {
  kind: "postgres",
  label: "PostgreSQL",
  category: "sql",
  capabilities: {
    supportsSqlExecution: true,
    supportsSchemaInspection: true,
    supportsServerSideFilter: true,
    supportsPagination: true,
    supportsMetadataExtraction: true,
  },
  formFields: [
    {
      key: "host",
      label: "Host",
      type: "text",
      required: true,
      placeholder: "127.0.0.1",
    },
    {
      key: "port",
      label: "Port",
      type: "text",
      required: true,
      defaultValue: "5432",
    },
    {
      key: "user",
      label: "User",
      type: "text",
      required: true,
    },
    {
      key: "password",
      label: "Password",
      type: "password",
    },
    {
      key: "dbName",
      label: "Database",
      type: "text",
      required: true,
    },
    {
      key: "useTLS",
      label: "Enable TLS/SSL",
      type: "boolean",
      defaultValue: false,
    },
  ],
};

const DEFAULT_POSTGRES_PORT = "5432";

function inferColumnType(row: Record<string, unknown>): string {
  const dataType = typeof row.data_type === "string" ? row.data_type : "";
  const udtName = typeof row.udt_name === "string" ? row.udt_name : "";
  if (dataType === "USER-DEFINED" && udtName) {
    return udtName;
  }
  return dataType || udtName || "text";
}

function isReadQuery(sql: string): boolean {
  return /^(SELECT|SHOW|EXPLAIN|WITH)\b/i.test(sql.trim());
}

export class PostgresConnector implements SQLConnector {
  readonly manifest = POSTGRES_MANIFEST;

  validateOptions(options: Record<string, unknown>): void {
    ensureRequiredString(readStringOption(options, "host"), "host");
    ensureRequiredString(readStringOption(options, "port", "5432"), "port");
    ensureRequiredString(readStringOption(options, "user"), "user");
    ensureRequiredString(readStringOption(options, "dbName"), "database");
  }

  async testConnection(profile: ConnectionProfile): Promise<void> {
    const details = this.toDetails(profile);
    await this.withClient(details, async (client) => {
      await client.unsafe("SELECT 1");
    });
  }

  async getVersion(profile: ConnectionProfile): Promise<string> {
    const result = await this.executeSQL(
      profile,
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
      const schemas = await this.listNamespaces(details);
      return schemas.map((item) => ({
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

  private toDetails(profile: ConnectionProfile): PostgresConnectionConfig {
    this.validateOptions(profile.options);

    return {
      id: profile.id,
      name: profile.name,
      lastUsed: profile.lastUsed,
      kind: "postgres",
      host: readStringOption(profile.options, "host"),
      port: readStringOption(profile.options, "port", "5432"),
      user: readStringOption(profile.options, "user"),
      password: readStringOption(profile.options, "password"),
      dbName: readStringOption(profile.options, "dbName"),
      useTLS: readBooleanOption(profile.options, "useTLS", false),
    };
  }

  private async withClient<T>(
    details: PostgresConnectionConfig,
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

  private async executeSQLWithDetails(
    details: PostgresConnectionConfig,
    sql: string,
  ): Promise<SQLResult> {
    const trimmedQuery = sql.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    return this.withClient(details, async (client) => {
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

  private async listNamespaces(
    details: PostgresConnectionConfig,
  ): Promise<SQLNamespaceRef[]> {
    return this.withClient(details, async (client) => {
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
          const namespaceKind: SQLNamespaceRef["namespaceKind"] = "schema";
          return {
            namespaceName,
            namespaceKind,
          };
        })
        .filter((item) => item.namespaceName.length > 0);
    });
  }

  private async listTables(
    details: PostgresConnectionConfig,
    namespaceName: string,
  ): Promise<SQLTableRef[]> {
    const targetNamespace = namespaceName || "public";

    return this.withClient(details, async (client) => {
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
          const tableType: SQLTableRef["tableType"] = tableTypeRaw
            .toUpperCase()
            .includes("VIEW")
            ? "view"
            : "table";

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
    details: PostgresConnectionConfig,
    namespaceName: string,
    tableName: string,
  ): Promise<SQLTableSchema> {
    if (!tableName) {
      throw new Error("table name is required");
    }

    const targetNamespace = namespaceName || "public";

    return this.withClient(details, async (client) => {
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

      const columns: SQLTableSchemaColumn[] = rows.map((row) => {
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

  private async getTableData(
    details: PostgresConnectionConfig,
    input: SQLReadTableInput,
  ): Promise<SQLTableDataPage> {
    const targetNamespace = input.namespaceName || "public";
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

    return this.withClient(details, async (client) => {
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
}
