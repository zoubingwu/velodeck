import { existsSync, readFileSync } from "node:fs";
import type {
  BigQueryConnectionDetails,
  Column,
  ColumnSchema,
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
} from "../../../shared/contracts";
import { coerceFiniteNumber, normalizeRow, toNullString } from "./helpers";
import type { DatabaseAdapter } from "./types";

interface BigQueryServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface BigQueryFieldSchema {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: BigQueryFieldSchema[];
}

interface BigQueryRowCell {
  v: unknown;
}

interface BigQueryRow {
  f: BigQueryRowCell[];
}

interface BigQueryQueryResponse {
  jobComplete?: boolean;
  totalRows?: string;
  schema?: {
    fields?: BigQueryFieldSchema[];
  };
  rows?: BigQueryRow[];
  pageToken?: string;
  jobReference?: {
    projectId?: string;
    jobId?: string;
    location?: string;
  };
  numDmlAffectedRows?: string;
}

interface BigQueryDatasetsResponse {
  datasets?: Array<{
    datasetReference?: {
      datasetId?: string;
    };
  }>;
}

interface BigQueryTablesResponse {
  tables?: Array<{
    tableReference?: {
      tableId?: string;
    };
    type?: string;
  }>;
}

interface BigQueryTableDetailResponse {
  schema?: {
    fields?: BigQueryFieldSchema[];
  };
  description?: string;
}

const BIGQUERY_SCOPE =
  "https://www.googleapis.com/auth/bigquery https://www.googleapis.com/auth/cloud-platform";

function ensureBigQueryConnection(
  details: ConnectionDetails,
): BigQueryConnectionDetails {
  if (details.kind !== "bigquery") {
    throw new Error(
      `bigquery adapter cannot handle '${details.kind}' connection`,
    );
  }
  return details;
}

function ensureIdentifierSegment(input: string, label: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (!/^[A-Za-z0-9_\-]+$/.test(trimmed)) {
    throw new Error(`unsafe ${label}: ${trimmed}`);
  }
  return trimmed;
}

function buildTableReference(
  projectId: string,
  datasetId: string,
  tableName: string,
): string {
  const project = ensureIdentifierSegment(projectId, "project id");
  const dataset = ensureIdentifierSegment(datasetId, "dataset id");
  const table = ensureIdentifierSegment(tableName, "table name");
  return `\`${project}.${dataset}.${table}\``;
}

function base64UrlEncode(input: Uint8Array | string): string {
  const buffer =
    typeof input === "string"
      ? Buffer.from(input, "utf8")
      : Buffer.from(input.buffer, input.byteOffset, input.byteLength);

  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

async function createSignedJWT(sa: BigQueryServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: BIGQUERY_SCOPE,
    aud: sa.token_uri || "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encodedSignature}`;
}

function parseServiceAccount(raw: string): BigQueryServiceAccount {
  const parsed = JSON.parse(raw) as Partial<BigQueryServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("invalid service account key JSON");
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri,
  };
}

function decodeBigQueryValue(
  value: unknown,
  field?: BigQueryFieldSchema,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (!field) {
    return value;
  }

  if (field.mode === "REPEATED" && Array.isArray(value)) {
    return value.map((item) =>
      decodeBigQueryValue(item, { ...field, mode: "NULLABLE" }),
    );
  }

  if (field.type === "RECORD" && value && typeof value === "object") {
    const raw = value as { f?: BigQueryRowCell[] };
    const nestedFields = field.fields || [];
    const nested: Record<string, unknown> = {};

    if (Array.isArray(raw.f)) {
      for (let i = 0; i < nestedFields.length; i += 1) {
        nested[nestedFields[i].name] = decodeBigQueryValue(
          raw.f[i]?.v,
          nestedFields[i],
        );
      }
    }

    return nested;
  }

  if (
    ["INT64", "INTEGER", "FLOAT64", "FLOAT", "NUMERIC", "BIGNUMERIC"].includes(
      field.type,
    )
  ) {
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }

  if (field.type === "BOOL" || field.type === "BOOLEAN") {
    return value === true || value === "true";
  }

  return value;
}

function rowsToObjects(
  rows: BigQueryRow[] | undefined,
  fields: BigQueryFieldSchema[],
): Record<string, unknown>[] {
  if (!rows || !rows.length) {
    return [];
  }

  return rows.map((row) => {
    const result: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i += 1) {
      result[fields[i].name] = decodeBigQueryValue(row.f[i]?.v, fields[i]);
    }
    return normalizeRow(result);
  });
}

export class BigQueryAdapter implements DatabaseAdapter {
  readonly kind = "bigquery" as const;

  readonly capabilities = {
    namespaceKind: "dataset",
    supportsTransactions: false,
    supportsForeignKeys: false,
    supportsIndexes: false,
    supportsServerSideFilter: false,
  } as const;

  async testConnection(details: ConnectionDetails): Promise<void> {
    const bigqueryDetails = ensureBigQueryConnection(details);
    await this.listNamespaces(bigqueryDetails);
  }

  async executeSQL(
    details: ConnectionDetails,
    sql: string,
  ): Promise<SQLResult> {
    const bigqueryDetails = ensureBigQueryConnection(details);
    const trimmedQuery = sql.trim();
    if (!trimmedQuery) {
      throw new Error("query cannot be empty");
    }

    const response = await this.runQuery(bigqueryDetails, trimmedQuery, {
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

  async listNamespaces(details: ConnectionDetails): Promise<NamespaceRef[]> {
    const bigqueryDetails = ensureBigQueryConnection(details);

    const response = await this.request<BigQueryDatasetsResponse>(
      bigqueryDetails,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(bigqueryDetails.projectId)}/datasets?all=true`,
    );

    return (response.datasets || [])
      .map((dataset) => dataset.datasetReference?.datasetId || "")
      .filter((datasetId) => datasetId.length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map((namespaceName) => ({
        namespaceName,
        namespaceKind: this.capabilities.namespaceKind,
      }));
  }

  async listTables(
    details: ConnectionDetails,
    namespaceName: string,
  ): Promise<TableRef[]> {
    const bigqueryDetails = ensureBigQueryConnection(details);
    const datasetId = ensureIdentifierSegment(namespaceName, "dataset");

    const response = await this.request<BigQueryTablesResponse>(
      bigqueryDetails,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(bigqueryDetails.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables?maxResults=1000`,
    );

    return (response.tables || [])
      .map((table) => {
        const tableName = table.tableReference?.tableId || "";
        const rawType = String(table.type || "TABLE").toUpperCase();
        const tableType = rawType.includes("VIEW") ? "view" : "table";
        return {
          namespaceName: datasetId,
          tableName,
          tableType,
        } as TableRef;
      })
      .filter((item) => item.tableName.length > 0)
      .sort((a, b) => a.tableName.localeCompare(b.tableName));
  }

  async getTableSchema(
    details: ConnectionDetails,
    namespaceName: string,
    tableName: string,
  ): Promise<TableSchema> {
    const bigqueryDetails = ensureBigQueryConnection(details);
    const datasetId = ensureIdentifierSegment(namespaceName, "dataset");
    const safeTableName = ensureIdentifierSegment(tableName, "table name");

    const response = await this.request<BigQueryTableDetailResponse>(
      bigqueryDetails,
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(bigqueryDetails.projectId)}/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(safeTableName)}`,
    );

    const fields = response.schema?.fields || [];
    const columns: ColumnSchema[] = fields.map((field) => ({
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

  async getTableData(
    details: ConnectionDetails,
    input: GetTableDataInput,
  ): Promise<TableDataResponse> {
    const bigqueryDetails = ensureBigQueryConnection(details);
    const datasetId = ensureIdentifierSegment(input.namespaceName, "dataset");
    const safeTableName = ensureIdentifierSegment(
      input.tableName,
      "table name",
    );

    const limit = Math.max(1, Math.floor(input.limit || 100));
    const offset = Math.max(0, Math.floor(input.offset || 0));

    const tableRef = buildTableReference(
      bigqueryDetails.projectId,
      datasetId,
      safeTableName,
    );

    const dataQuery = `SELECT * FROM ${tableRef} LIMIT ${limit} OFFSET ${offset}`;
    const dataResult = await this.runQuery(bigqueryDetails, dataQuery, {
      maxResults: limit,
    });

    const fields = dataResult.schema?.fields || [];
    const rows = rowsToObjects(dataResult.rows, fields);

    const countResult = await this.runQuery(
      bigqueryDetails,
      `SELECT COUNT(*) AS total FROM ${tableRef}`,
      { maxResults: 1 },
    );

    const totalRowsData = rowsToObjects(
      countResult.rows,
      countResult.schema?.fields || [],
    );
    const totalRows = coerceFiniteNumber(totalRowsData[0]?.total) ?? undefined;

    const columns: TableColumn[] = fields.map((field) => ({
      name: field.name,
      type: field.type,
    }));

    return {
      columns,
      rows,
      totalRows,
    };
  }

  async extractMetadata(
    details: ConnectionDetails,
    namespaceName?: string,
  ): Promise<DatabaseMetadata> {
    const bigqueryDetails = ensureBigQueryConnection(details);
    const datasetId = ensureIdentifierSegment(namespaceName || "", "dataset");

    const refs = await this.listTables(bigqueryDetails, datasetId);

    const tables: Table[] = [];
    for (const ref of refs) {
      const schema = await this.getTableSchema(
        bigqueryDetails,
        datasetId,
        ref.tableName,
      );

      const columns: Column[] = schema.columns.map((column) => ({
        name: column.column_name,
        dataType: column.column_type,
        isNullable: column.is_nullable === "YES",
        defaultValue: undefined,
        isPrimaryKey: false,
        autoIncrement: false,
        dbComment: column.column_comment,
      }));

      tables.push({
        name: ref.tableName,
        columns,
        foreignKeys: [],
        indexes: [],
      });
    }

    return {
      name: datasetId,
      namespaceKind: this.capabilities.namespaceKind,
      tables,
      graph: {},
    };
  }

  private async request<T>(
    details: BigQueryConnectionDetails,
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
    details: BigQueryConnectionDetails,
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
    details: BigQueryConnectionDetails,
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
