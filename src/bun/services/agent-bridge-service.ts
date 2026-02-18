import { randomBytes } from "node:crypto";
import type { DatabaseGatewayService } from "./database-gateway-service";
import { logger } from "./logger-service";
import type { SessionService } from "./session-service";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function normalizeSQL(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
}

function hasWriteKeyword(sql: string): boolean {
  return /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|CALL|LOAD|SET|ANALYZE|OPTIMIZE|RENAME)\b/i.test(
    sql,
  );
}

function isReadOnlySQL(sql: string): boolean {
  const normalized = normalizeSQL(sql);
  if (!normalized) {
    return false;
  }

  const statements = normalized
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (statements.length !== 1) {
    return false;
  }

  const statement = statements[0];
  if (hasWriteKeyword(statement)) {
    return false;
  }

  return /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i.test(statement);
}

export class AgentBridgeService {
  private server: Bun.Server<unknown> | null = null;
  private readonly runTokens = new Map<string, string>();
  private readonly tokenToRun = new Map<string, string>();

  constructor(
    private readonly sessionService: SessionService,
    private readonly databaseService: DatabaseGatewayService,
  ) {}

  getBaseURL(): string {
    this.ensureServer();
    return `http://127.0.0.1:${this.server?.port ?? 0}`;
  }

  registerRun(runId: string): string {
    this.ensureServer();

    const token = randomBytes(24).toString("hex");
    this.runTokens.set(runId, token);
    this.tokenToRun.set(token, runId);
    return token;
  }

  revokeRun(runId: string): void {
    const token = this.runTokens.get(runId);
    if (!token) {
      return;
    }

    this.runTokens.delete(runId);
    this.tokenToRun.delete(token);
  }

  private ensureServer(): void {
    if (this.server) {
      return;
    }

    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => this.handleRequest(request),
    });

    logger.info(`agent bridge listening on ${this.getBaseURL()}`);
  }

  private isAuthorized(request: Request): boolean {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!token) {
      return false;
    }

    return this.tokenToRun.has(token);
  }

  private async handleRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method not allowed" });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/v1/sql/read") {
      return jsonResponse(404, { error: "not found" });
    }

    if (!this.isAuthorized(request)) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const query = (await request.text()).trim();
    if (!query) {
      return jsonResponse(400, { error: "query cannot be empty" });
    }

    if (!isReadOnlySQL(query)) {
      return jsonResponse(400, {
        error:
          "only read-only SQL is allowed (SELECT/SHOW/DESCRIBE/EXPLAIN/WITH)",
      });
    }

    try {
      const { details } = this.sessionService.ensureActiveConnection();
      const result = await this.databaseService.executeSQL(details, query);
      return jsonResponse(200, { success: true, result });
    } catch (error) {
      logger.warn(`agent bridge sql failed: ${String(error)}`);
      return jsonResponse(500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
