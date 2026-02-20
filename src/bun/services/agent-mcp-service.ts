import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AgentSQLApprovalDecision,
  type AgentSQLApprovalResolveInput,
  type AgentSQLClassification,
  APP_EVENTS,
  type ConnectionDetails,
  type SQLResult,
} from "../../shared/contracts";
import type { EventService } from "../events";
import type { DatabaseGatewayService } from "./database-gateway-service";
import { logger } from "./logger-service";

export const VELODECK_MCP_SERVER_NAME = "velodeck_sql";
export const VELODECK_MCP_BEARER_ENV = "VELODECK_MCP_BEARER";

const MCP_PATH = "/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MANAGED_BLOCK_START = "# VELODECK_MANAGED_MCP_START";
const MANAGED_BLOCK_END = "# VELODECK_MANAGED_MCP_END";
const MANAGED_BLOCK_RE =
  /\n?# VELODECK_MANAGED_MCP_START[\s\S]*?# VELODECK_MANAGED_MCP_END\n?/g;

const READ_PREFIX_RE = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;
const WRITE_KEYWORD_RE =
  /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMIT|ROLLBACK|BEGIN|START\s+TRANSACTION|LOCK|UNLOCK|SET|USE|ANALYZE|OPTIMIZE|REINDEX|VACUUM|CALL|EXEC|EXECUTE|PREPARE|DEALLOCATE|COPY|ATTACH|DETACH)\b/i;

type JSONRPCId = string | number | null;

type JSONRPCRequest = {
  jsonrpc?: string;
  id?: JSONRPCId;
  method?: string;
  params?: unknown;
};

type JSONRPCResponse = {
  jsonrpc: "2.0";
  id: JSONRPCId;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type RunContext = {
  runId: string;
  token: string;
  connection: ConnectionDetails | null;
  pendingApprovalIds: Set<string>;
};

type ApprovalResolution = {
  decision: AgentSQLApprovalDecision;
  reason?: string;
};

type PendingApproval = {
  runId: string;
  approvalId: string;
  query: string;
  resolve: (resolution: ApprovalResolution) => void;
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function stripSQLComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim();
}

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function classifySQL(sql: string): {
  normalized: string;
  classification: AgentSQLClassification;
} {
  const normalized = stripSQLComments(sql);
  if (!normalized) {
    throw new Error("query cannot be empty");
  }

  const statements = splitStatements(normalized);
  if (statements.length !== 1) {
    throw new Error("only single-statement SQL is supported");
  }

  const statement = statements[0];

  if (/^SELECT\b[\s\S]*\bINTO\b/i.test(statement)) {
    return {
      normalized: statement,
      classification: "write",
    };
  }

  if (READ_PREFIX_RE.test(statement)) {
    return {
      normalized: statement,
      classification: "read",
    };
  }

  if (/^WITH\b/i.test(statement)) {
    return {
      normalized: statement,
      classification: WRITE_KEYWORD_RE.test(statement) ? "write" : "read",
    };
  }

  if (WRITE_KEYWORD_RE.test(statement)) {
    return {
      normalized: statement,
      classification: "write",
    };
  }

  return {
    normalized: statement,
    classification: "write",
  };
}

function cloneConnection(
  details: ConnectionDetails | null,
): ConnectionDetails | null {
  if (!details) {
    return null;
  }

  return structuredClone(details);
}

export class AgentMCPService {
  private server: Bun.Server<unknown> | null = null;
  private readonly runs = new Map<string, RunContext>();
  private readonly tokenToRun = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(
    private readonly events: EventService,
    private readonly databaseService: DatabaseGatewayService,
  ) {}

  getMCPURL(): string {
    this.ensureServer();
    return `${this.getBaseURL()}${MCP_PATH}`;
  }

  getBaseURL(): string {
    this.ensureServer();
    return `http://127.0.0.1:${this.server?.port ?? 0}`;
  }

  registerRun(runId: string, connection: ConnectionDetails | null): string {
    this.ensureServer();

    const token = randomBytes(24).toString("hex");
    const context: RunContext = {
      runId,
      token,
      connection: cloneConnection(connection),
      pendingApprovalIds: new Set<string>(),
    };

    this.runs.set(runId, context);
    this.tokenToRun.set(token, runId);
    return token;
  }

  revokeRun(runId: string): void {
    const context = this.runs.get(runId);
    if (!context) {
      return;
    }

    this.rejectPendingApprovalsForRun(runId, "agent run ended before approval");
    this.runs.delete(runId);
    this.tokenToRun.delete(context.token);
  }

  async resolveApproval(input: AgentSQLApprovalResolveInput): Promise<void> {
    const context = this.runs.get(input.runId);
    if (!context) {
      throw new Error(`agent run '${input.runId}' not found`);
    }

    const pending = this.pendingApprovals.get(input.approvalId);
    if (!pending) {
      throw new Error(`sql approval '${input.approvalId}' not found`);
    }

    if (pending.runId !== input.runId) {
      throw new Error("approval does not belong to the provided run");
    }

    context.pendingApprovalIds.delete(input.approvalId);
    this.pendingApprovals.delete(input.approvalId);

    const reason = input.reason?.trim() || undefined;

    pending.resolve({
      decision: input.decision,
      reason,
    });

    await this.events.emit(APP_EVENTS.agentSQLApprovalResolved, {
      runId: input.runId,
      approvalId: input.approvalId,
      decision: input.decision,
      reason,
    });
  }

  upsertManagedProjectConfig(projectDir: string): void {
    const codexDir = join(projectDir, ".codex");
    mkdirSync(codexDir, { recursive: true, mode: 0o750 });

    const configPath = join(codexDir, "config.toml");
    const current = existsSync(configPath)
      ? readFileSync(configPath, "utf8")
      : "";

    const withoutManaged = current.replace(MANAGED_BLOCK_RE, "").trimEnd();
    const managedBlock = this.buildManagedConfigBlock();
    const next = withoutManaged
      ? `${withoutManaged}\n\n${managedBlock}\n`
      : `${managedBlock}\n`;

    if (next === current) {
      return;
    }

    writeFileSync(configPath, next, { mode: 0o600 });
  }

  private buildManagedConfigBlock(): string {
    return [
      MANAGED_BLOCK_START,
      `[mcp_servers.${VELODECK_MCP_SERVER_NAME}]`,
      `url = "${this.getMCPURL()}"`,
      `bearer_token_env_var = "${VELODECK_MCP_BEARER_ENV}"`,
      "required = true",
      "enabled = true",
      MANAGED_BLOCK_END,
    ].join("\n");
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

    logger.info(`agent MCP bridge listening on ${this.getMCPURL()}`);
  }

  private async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== MCP_PATH) {
      return jsonResponse(404, {
        error: "not found",
      });
    }

    const context = this.getRunContextFromRequest(request);
    if (!context) {
      return jsonResponse(401, {
        error: "unauthorized",
      });
    }

    if (request.method === "GET") {
      return new Response(`event: endpoint\ndata: ${MCP_PATH}\n\n`, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(405, {
        error: "method not allowed",
      });
    }

    let rpcRequest: JSONRPCRequest;
    try {
      rpcRequest = (await request.json()) as JSONRPCRequest;
    } catch {
      return jsonResponse(400, {
        error: "invalid json body",
      });
    }

    if (
      !rpcRequest ||
      rpcRequest.jsonrpc !== "2.0" ||
      typeof rpcRequest.method !== "string"
    ) {
      const invalid = this.rpcErrorResponse(
        null,
        -32600,
        "invalid JSON-RPC request",
      );
      return jsonResponse(400, invalid);
    }

    const hasId = Object.prototype.hasOwnProperty.call(rpcRequest, "id");

    try {
      const result = await this.handleRPCMethod(
        context,
        rpcRequest.method,
        rpcRequest.params,
      );

      if (!hasId) {
        return new Response(null, { status: 202 });
      }

      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: rpcRequest.id ?? null,
        result,
      } satisfies JSONRPCResponse);
    } catch (error) {
      if (!hasId) {
        return new Response(null, { status: 202 });
      }

      const response = this.rpcErrorResponse(
        rpcRequest.id ?? null,
        -32000,
        error instanceof Error ? error.message : String(error),
      );
      return jsonResponse(200, response);
    }
  }

  private rpcErrorResponse(
    id: JSONRPCId,
    code: number,
    message: string,
    data?: unknown,
  ): JSONRPCResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        data,
      },
    };
  }

  private getRunContextFromRequest(request: Request): RunContext | null {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      return null;
    }

    const runId = this.tokenToRun.get(token);
    if (!runId) {
      return null;
    }

    return this.runs.get(runId) || null;
  }

  private async handleRPCMethod(
    context: RunContext,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    switch (method) {
      case "initialize": {
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: {
            name: "velodeck-agent-sql-mcp",
            version: "0.1.0",
          },
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
        };
      }
      case "notifications/initialized": {
        return {};
      }
      case "ping": {
        return {};
      }
      case "tools/list": {
        return {
          tools: [
            {
              name: "velodeck_sql_execute",
              title: "Execute SQL against active VeloDeck connection",
              description:
                "Execute one SQL statement. Read queries run immediately. Write queries require explicit user approval.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  query: {
                    type: "string",
                    minLength: 1,
                    description: "SQL text to execute",
                  },
                },
                required: ["query"],
              },
            },
          ],
        };
      }
      case "tools/call": {
        return this.handleToolCall(context, params);
      }
      case "prompts/list": {
        return {
          prompts: [],
        };
      }
      case "resources/list": {
        return {
          resources: [],
        };
      }
      case "resources/templates/list": {
        return {
          resourceTemplates: [],
        };
      }
      default: {
        throw new Error(`unsupported MCP method '${method}'`);
      }
    }
  }

  private async handleToolCall(
    context: RunContext,
    params: unknown,
  ): Promise<unknown> {
    if (!params || typeof params !== "object") {
      throw new Error("invalid tool call payload");
    }

    const candidate = params as {
      name?: unknown;
      arguments?: unknown;
    };

    if (candidate.name !== "velodeck_sql_execute") {
      throw new Error(`unsupported tool '${String(candidate.name ?? "")}'`);
    }

    const args =
      candidate.arguments && typeof candidate.arguments === "object"
        ? (candidate.arguments as Record<string, unknown>)
        : {};

    const query = String(args.query ?? "").trim();
    if (!query) {
      return {
        content: [{ type: "text", text: "query cannot be empty" }],
        isError: true,
      };
    }

    try {
      const execution = await this.executeSQLForRun(context, query);
      const payload = {
        classification: execution.classification,
        result: execution.result,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  }

  private async executeSQLForRun(
    context: RunContext,
    query: string,
  ): Promise<{ classification: AgentSQLClassification; result: SQLResult }> {
    if (!context.connection) {
      throw new Error("no active connection snapshot for this agent run");
    }

    const { classification } = classifySQL(query);

    if (classification === "write") {
      const decision = await this.waitForWriteApproval(context, query);
      if (decision.decision !== "approved") {
        throw new Error(decision.reason || "write SQL rejected by user");
      }
    }

    const result = await this.databaseService.executeSQL(
      context.connection,
      query,
    );
    return {
      classification,
      result,
    };
  }

  private async waitForWriteApproval(
    context: RunContext,
    query: string,
  ): Promise<ApprovalResolution> {
    const approvalId = randomBytes(8).toString("hex");

    const resolution = new Promise<ApprovalResolution>((resolve) => {
      this.pendingApprovals.set(approvalId, {
        runId: context.runId,
        approvalId,
        query,
        resolve,
      });
      context.pendingApprovalIds.add(approvalId);
    });

    await this.events.emit(APP_EVENTS.agentSQLApprovalRequested, {
      runId: context.runId,
      approvalId,
      query,
      classification: "write",
    });

    return resolution;
  }

  private rejectPendingApprovalsForRun(runId: string, reason: string): void {
    const context = this.runs.get(runId);
    const approvalIds = context
      ? Array.from(context.pendingApprovalIds)
      : Array.from(this.pendingApprovals.values())
          .filter((pending) => pending.runId === runId)
          .map((pending) => pending.approvalId);

    for (const approvalId of approvalIds) {
      const pending = this.pendingApprovals.get(approvalId);
      if (!pending) {
        continue;
      }

      this.pendingApprovals.delete(approvalId);
      pending.resolve({
        decision: "rejected",
        reason,
      });

      void this.events.emit(APP_EVENTS.agentSQLApprovalResolved, {
        runId,
        approvalId,
        decision: "rejected",
        reason,
      });
    }

    if (context) {
      context.pendingApprovalIds.clear();
    }
  }
}
