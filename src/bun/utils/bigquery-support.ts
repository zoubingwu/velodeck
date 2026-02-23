import { normalizeRow } from "./sql-utils";

export interface BigQueryServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface BigQueryFieldSchema {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: BigQueryFieldSchema[];
}

export type BigQueryRow = { f: Array<{ v: unknown }> };

export interface BigQueryQueryResponse {
  jobComplete?: boolean;
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

const BIGQUERY_SCOPE =
  "https://www.googleapis.com/auth/bigquery https://www.googleapis.com/auth/cloud-platform";

export function ensureIdentifierSegment(input: string, label: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${label} cannot be empty`);
  }
  if (!/^[A-Za-z0-9_\-]+$/.test(trimmed)) {
    throw new Error(`unsafe ${label}: ${trimmed}`);
  }
  return trimmed;
}

export function buildTableReference(
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

export async function createSignedJWT(
  sa: BigQueryServiceAccount,
): Promise<string> {
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

export function parseServiceAccount(raw: string): BigQueryServiceAccount {
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
    const raw = value as { f?: Array<{ v: unknown }> };
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

export function rowsToObjects(
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
