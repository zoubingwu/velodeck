import type { ServerSideFilter } from "../../shared/contracts";

export function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function normalizeRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = normalizeValue(value);
  }
  return out;
}

export function toNullString(value: unknown): {
  String: string;
  Valid: boolean;
} {
  if (value === null || value === undefined) {
    return { String: "", Valid: false };
  }
  return { String: String(value), Valid: true };
}

export function coerceFiniteNumber(input: unknown): number | null {
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

type PlaceholderBuilder = () => string;

export function buildWhereClause(
  filters: ServerSideFilter[],
  allowedColumns: Set<string>,
  quoteIdentifier: (input: string) => string,
  buildPlaceholder: PlaceholderBuilder,
): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const pushValue = (value: unknown): string => {
    params.push(value);
    return buildPlaceholder();
  };

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
        clauses.push(`${col} LIKE ${pushValue(`%${value}%`)}`);
      }
      if (operator === "does not contain") {
        clauses.push(`${col} NOT LIKE ${pushValue(`%${value}%`)}`);
      }
      continue;
    }

    if (type === "number") {
      const first = coerceFiniteNumber(values[0]);
      const second = coerceFiniteNumber(values[1]);

      if (operator === "is" && first !== null) {
        clauses.push(`${col} = ${pushValue(first)}`);
      }
      if (operator === "is not" && first !== null) {
        clauses.push(`${col} != ${pushValue(first)}`);
      }
      if (operator === "is greater than" && first !== null) {
        clauses.push(`${col} > ${pushValue(first)}`);
      }
      if (operator === "is greater than or equal to" && first !== null) {
        clauses.push(`${col} >= ${pushValue(first)}`);
      }
      if (operator === "is less than" && first !== null) {
        clauses.push(`${col} < ${pushValue(first)}`);
      }
      if (operator === "is less than or equal to" && first !== null) {
        clauses.push(`${col} <= ${pushValue(first)}`);
      }
      if (operator === "is between" && first !== null && second !== null) {
        const firstPlaceholder = pushValue(first);
        const secondPlaceholder = pushValue(second);
        clauses.push(
          `${col} BETWEEN ${firstPlaceholder} AND ${secondPlaceholder}`,
        );
      }
      if (operator === "is not between" && first !== null && second !== null) {
        const firstPlaceholder = pushValue(first);
        const secondPlaceholder = pushValue(second);
        clauses.push(
          `${col} NOT BETWEEN ${firstPlaceholder} AND ${secondPlaceholder}`,
        );
      }
      continue;
    }

    if (type === "date") {
      const first = values[0];
      const second = values[1];

      if (operator === "is") {
        clauses.push(`DATE(${col}) = DATE(${pushValue(first)})`);
      }
      if (operator === "is not") {
        clauses.push(`DATE(${col}) != DATE(${pushValue(first)})`);
      }
      if (operator === "is between" && second !== undefined) {
        const firstPlaceholder = pushValue(first);
        const secondPlaceholder = pushValue(second);
        clauses.push(
          `DATE(${col}) BETWEEN DATE(${firstPlaceholder}) AND DATE(${secondPlaceholder})`,
        );
      }
      if (operator === "is not between" && second !== undefined) {
        const firstPlaceholder = pushValue(first);
        const secondPlaceholder = pushValue(second);
        clauses.push(
          `DATE(${col}) NOT BETWEEN DATE(${firstPlaceholder}) AND DATE(${secondPlaceholder})`,
        );
      }
      continue;
    }

    if (type === "option" || type === "multiOption") {
      const flattened = flattenOptionValues(values);
      if (!flattened.length) {
        continue;
      }

      const placeholders = flattened.map((item) => pushValue(item)).join(", ");

      if (
        operator === "is" ||
        operator === "is any of" ||
        operator === "include" ||
        operator === "include any of"
      ) {
        clauses.push(`${col} IN (${placeholders})`);
      }

      if (
        operator === "is not" ||
        operator === "is none of" ||
        operator === "exclude" ||
        operator === "exclude if any of"
      ) {
        clauses.push(`${col} NOT IN (${placeholders})`);
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

export function quoteBacktickIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("identifier cannot be empty");
  }

  if (!/^[A-Za-z0-9_$-]+$/.test(trimmed)) {
    throw new Error(`unsafe identifier: ${trimmed}`);
  }

  return `\`${trimmed}\``;
}

export function quoteDoubleQuoteIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("identifier cannot be empty");
  }

  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    throw new Error(`unsafe identifier: ${trimmed}`);
  }

  return `"${trimmed}"`;
}

export function quoteBigQueryIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("identifier cannot be empty");
  }

  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    throw new Error(`unsafe identifier: ${trimmed}`);
  }

  return `\`${trimmed}\``;
}
