import { existsSync, readFileSync } from "node:fs";
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
  type BigQueryFieldSchema,
  type BigQueryQueryResponse,
  type BigQueryServiceAccount,
  buildTableReference,
  createSignedJWT,
  ensureIdentifierSegment,
  parseServiceAccount,
  rowsToObjects,
} from "../utils/bigquery-support";
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
  BigQueryAuthMode,
  BigQueryConnectionConfig,
  SQLNamespaceRef,
  SQLReadTableInput,
  SQLTableColumn,
  SQLTableDataPage,
  SQLTableRef,
  SQLTableSchema,
  SQLTableSchemaColumn,
} from "../utils/sql-types";
import { coerceFiniteNumber, toNullString } from "../utils/sql-utils";

const BIGQUERY_MANIFEST: ConnectorManifest = {
  kind: "bigquery",
  label: "BigQuery",
  category: "analytics",
  capabilities: {
    supportsSqlExecution: true,
    supportsSchemaInspection: true,
    supportsServerSideFilter: false,
    supportsPagination: true,
    supportsMetadataExtraction: true,
  },
  formFields: [
    {
      key: "projectId",
      label: "Project ID",
      type: "text",
      required: true,
    },
    {
      key: "location",
      label: "Location",
      type: "text",
      defaultValue: "US",
    },
    {
      key: "authType",
      label: "Auth Type",
      type: "select",
      defaultValue: "application_default_credentials",
      options: [
        {
          label: "Application Default Credentials",
          value: "application_default_credentials",
        },
        {
          label: "Service Account JSON",
          value: "service_account_json",
        },
        {
          label: "Service Account Key File",
          value: "service_account_key_file",
        },
      ],
    },
    {
      key: "serviceAccountJson",
      label: "Service Account JSON",
      type: "textarea",
      secret: true,
      description: "Required when authType = service_account_json",
    },
    {
      key: "serviceAccountKeyFile",
      label: "Service Account Key File",
      type: "text",
      description: "Required when authType = service_account_key_file",
    },
  ],
};

export class BigQueryConnector implements SQLConnector {
  readonly manifest = BIGQUERY_MANIFEST;

  validateOptions(options: Record<string, unknown>): void {
    ensureRequiredString(readStringOption(options, "projectId"), "projectId");

    const authType = this.readAuthType(options);
    if (authType === "service_account_json") {
      ensureRequiredString(
        readStringOption(options, "serviceAccountJson"),
        "serviceAccountJson",
      );
    }

    if (authType === "service_account_key_file") {
      ensureRequiredString(
        readStringOption(options, "serviceAccountKeyFile"),
        "serviceAccountKeyFile",
      );
    }
  }

  async testConnection(profile: ConnectionProfile): Promise<void> {
    await this.listNamespaces(this.toDetails(profile));
  }

  async getVersion(_profile: ConnectionProfile): Promise<string> {
    return "BigQuery";
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
      const datasets = await this.listNamespaces(details);
      return datasets.map((item) => ({
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
      "dataset",
    );

    const result = await this.getTableData(details, {
      namespaceName,
      tableName: input.entity.name,
      limit: input.limit,
      offset: input.offset || 0,
      filterParams: null,
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
      "dataset",
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

  private readAuthType(options: Record<string, unknown>): BigQueryAuthMode {
    const raw = readStringOption(
      options,
      "authType",
      "application_default_credentials",
    );

    if (
      raw === "service_account_json" ||
      raw === "service_account_key_file" ||
      raw === "application_default_credentials"
    ) {
      return raw;
    }

    return "application_default_credentials";
  }

  private toDetails(profile: ConnectionProfile): BigQueryConnectionConfig {
    this.validateOptions(profile.options);

    return {
      id: profile.id,
      name: profile.name,
      lastUsed: profile.lastUsed,
      kind: "bigquery",
      projectId: readStringOption(profile.options, "projectId"),
      location:
        readStringOption(profile.options, "location", "US") || undefined,
      authType: this.readAuthType(profile.options),
      serviceAccountJson:
        readStringOption(profile.options, "serviceAccountJson") || undefined,
      serviceAccountKeyFile:
        readStringOption(profile.options, "serviceAccountKeyFile") || undefined,
    };
  }

  private async executeSQLWithDetails(
    details: BigQueryConnectionConfig,
    sql: string,
  ): Promise<SQLResult> {
    const trimmedQuery = sql.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    const response = await this.runQuery(details, trimmedQuery, {
      maxResults: 1000,
    });

    const fields = response.schema?.fields || [];
    const rows = rowsToObjects(response.rows, fields);
    if (fields.length > 0) {
      return {
        columns: fields.map((field) => field.name),
        rows,
      };
    }

    return {
      rowsAffected:
        coerceFiniteNumber(response.numDmlAffectedRows) ?? undefined,
      message: "Command executed successfully.",
    };
  }

  private async listNamespaces(
    details: BigQueryConnectionConfig,
  ): Promise<SQLNamespaceRef[]> {
    const response = await this.request<{
      datasets?: Array<{ datasetReference?: { datasetId?: string } }>;
    }>(
      details,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(details.projectId)}/datasets?all=true`,
    );

    return (response.datasets || [])
      .map((dataset) => dataset.datasetReference?.datasetId || "")
      .filter((datasetId) => datasetId.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map((namespaceName) => ({
        namespaceName,
        namespaceKind: "dataset",
      }));
  }

  private async listTables(
    details: BigQueryConnectionConfig,
    namespaceName: string,
  ): Promise<SQLTableRef[]> {
    const datasetId = ensureIdentifierSegment(namespaceName, "dataset");

    const response = await this.request<{
      tables?: Array<{ tableReference?: { tableId?: string }; type?: string }>;
    }>(
      details,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(details.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables?maxResults=1000`,
    );

    return (response.tables || [])
      .map((table) => {
        const tableName = table.tableReference?.tableId || "";
        const rawType = String(table.type || "TABLE").toUpperCase();
        const tableType: SQLTableRef["tableType"] = rawType.includes("VIEW")
          ? "view"
          : "table";
        return {
          namespaceName: datasetId,
          tableName,
          tableType,
        };
      })
      .filter((item) => item.tableName.length > 0)
      .sort((a, b) => a.tableName.localeCompare(b.tableName));
  }

  private async getTableSchema(
    details: BigQueryConnectionConfig,
    namespaceName: string,
    tableName: string,
  ): Promise<SQLTableSchema> {
    const datasetId = ensureIdentifierSegment(namespaceName, "dataset");
    const safeTableName = ensureIdentifierSegment(tableName, "table name");

    const response = await this.request<{
      schema?: { fields?: BigQueryFieldSchema[] };
    }>(
      details,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(details.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(safeTableName)}`,
    );

    const fields = response.schema?.fields || [];
    const columns: SQLTableSchemaColumn[] = fields.map((field) => ({
      column_name: field.name,
      column_type: field.type,
      character_set_name: toNullString(null),
      collation_name: toNullString(null),
      is_nullable: field.mode === "REQUIRED" ? "NO" : "YES",
      column_default: toNullString(null),
      extra: field.mode === "REPEATED" ? "repeated" : "",
      column_comment: field.description || "",
    }));

    return {
      name: safeTableName,
      columns,
    };
  }

  private async getTableData(
    details: BigQueryConnectionConfig,
    input: SQLReadTableInput,
  ): Promise<SQLTableDataPage> {
    const datasetId = ensureIdentifierSegment(input.namespaceName, "dataset");
    const safeTableName = ensureIdentifierSegment(
      input.tableName,
      "table name",
    );

    const limit = Math.max(1, Math.floor(input.limit || 100));
    const offset = Math.max(0, Math.floor(input.offset || 0));

    const tableRef = buildTableReference(
      details.projectId,
      datasetId,
      safeTableName,
    );

    const dataQuery = `SELECT * FROM ${tableRef} LIMIT ${limit} OFFSET ${offset}`;
    const dataResult = await this.runQuery(details, dataQuery, {
      maxResults: limit,
    });

    const fields = dataResult.schema?.fields || [];
    const rows = rowsToObjects(dataResult.rows, fields);

    const countResult = await this.runQuery(
      details,
      `SELECT COUNT(*) AS total FROM ${tableRef}`,
      { maxResults: 1 },
    );

    const totalRowsData = rowsToObjects(
      countResult.rows,
      countResult.schema?.fields || [],
    );
    const totalRows = coerceFiniteNumber(totalRowsData[0]?.total) ?? undefined;

    const columns: SQLTableColumn[] = fields.map((field) => ({
      name: field.name,
      type: field.type,
    }));

    return {
      columns,
      rows,
      totalRows,
    };
  }

  private async request<T>(
    details: BigQueryConnectionConfig,
    url: string,
    init?: RequestInit,
  ): Promise<T> {
    const accessToken = await this.getAccessToken(details);

    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`BigQuery API ${response.status}: ${text}`);
    }

    return (await response.json()) as T;
  }

  private async getAccessToken(
    details: BigQueryConnectionConfig,
  ): Promise<string> {
    if (details.authType === "service_account_json") {
      if (!details.serviceAccountJson) {
        throw new Error(
          "serviceAccountJson is required for service_account_json auth",
        );
      }
      const serviceAccount = parseServiceAccount(details.serviceAccountJson);
      return this.exchangeServiceAccountToken(serviceAccount);
    }

    if (details.authType === "service_account_key_file") {
      if (!details.serviceAccountKeyFile) {
        throw new Error(
          "serviceAccountKeyFile is required for service_account_key_file auth",
        );
      }
      const raw = readFileSync(details.serviceAccountKeyFile, "utf8");
      const serviceAccount = parseServiceAccount(raw);
      return this.exchangeServiceAccountToken(serviceAccount);
    }

    return this.getADCAccessToken();
  }

  private async exchangeServiceAccountToken(
    serviceAccount: BigQueryServiceAccount,
  ): Promise<string> {
    const assertion = await createSignedJWT(serviceAccount);
    const tokenUri =
      serviceAccount.token_uri || "https://oauth2.googleapis.com/token";

    const body = new URLSearchParams();
    body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
    body.set("assertion", assertion);

    const response = await fetch(tokenUri, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`failed to fetch BigQuery access token: ${text}`);
    }

    const tokenPayload = (await response.json()) as {
      access_token?: string;
    };

    if (!tokenPayload.access_token) {
      throw new Error("BigQuery token response missing access_token");
    }

    return tokenPayload.access_token;
  }

  private async getADCAccessToken(): Promise<string> {
    const envToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
    if (envToken && envToken.trim()) {
      return envToken.trim();
    }

    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credentialsPath && existsSync(credentialsPath)) {
      const raw = readFileSync(credentialsPath, "utf8");
      const serviceAccount = parseServiceAccount(raw);
      return this.exchangeServiceAccountToken(serviceAccount);
    }

    const command = Bun.spawnSync(
      ["gcloud", "auth", "application-default", "print-access-token"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    if (command.exitCode === 0) {
      const token = Buffer.from(command.stdout).toString("utf8").trim();
      if (token) {
        return token;
      }
    }

    const errorText = Buffer.from(command.stderr).toString("utf8").trim();
    throw new Error(
      errorText ||
        "unable to resolve ADC token; set GOOGLE_OAUTH_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS",
    );
  }

  private async runQuery(
    details: BigQueryConnectionConfig,
    query: string,
    options?: {
      maxResults?: number;
    },
  ): Promise<BigQueryQueryResponse> {
    const startPayload = {
      query,
      useLegacySql: false,
      timeoutMs: 20_000,
      maxResults: options?.maxResults || 1000,
      location: details.location || undefined,
    };

    let response = await this.request<BigQueryQueryResponse>(
      details,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(details.projectId)}/queries`,
      {
        method: "POST",
        body: JSON.stringify(startPayload),
      },
    );

    if (response.jobComplete) {
      return response;
    }

    const projectId = response.jobReference?.projectId || details.projectId;
    const jobId = response.jobReference?.jobId;
    const location =
      response.jobReference?.location || details.location || "US";

    if (!jobId) {
      return response;
    }

    for (let i = 0; i < 30; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      response = await this.request<BigQueryQueryResponse>(
        details,
        `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries/${encodeURIComponent(jobId)}?location=${encodeURIComponent(location)}&maxResults=${encodeURIComponent(String(options?.maxResults || 1000))}`,
      );

      if (response.jobComplete) {
        return response;
      }
    }

    throw new Error("BigQuery query timed out before completion");
  }
}
