import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AGENT_DIR_NAME,
  AGENT_SKILLS_DIR_NAME,
  type AgentRunEventSource,
  type AgentSQLApprovalResolveInput,
  APP_EVENTS,
  CONFIG_DIR_NAME,
  type ConnectionDetails,
} from "../../shared/contracts";
import type { EventService } from "../events";
import {
  type AgentMCPService,
  VELODECK_MCP_BEARER_ENV,
  VELODECK_MCP_SERVER_NAME,
} from "./agent-mcp-service";
import type { DatabaseGatewayService } from "./database-gateway-service";
import { logger } from "./logger-service";
import type { SessionService } from "./session-service";

type AgentRun = {
  runId: string;
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  cancelled: boolean;
};

const CODEX_BASE_ARGS = [
  "exec",
  "--json",
  "--color",
  "never",
  "--skip-git-repo-check",
  "-s",
  "workspace-write",
] as const;

const DB_INDEX_SKILL_TEMPLATE = `---
name: db-index
description: Use generated markdown schema indexes to understand complete table structure and write accurate SQL.
compatibility: Requires VeloDeck MCP tool velodeck_sql_execute and write access under ~/.velodeck/.agents/skills/db-index/references.
metadata:
  owner: velodeck
  version: "3.0"
---

# VeloDeck Schema Index Skill

Use this skill when you need full schema context before writing SQL.

## Primary Goal
- Locate the correct markdown index files first.
- Use those files to recover complete table structures (columns, PK/FK, indexes, comments).
- Then write SQL that matches the schema exactly.
- Prefer markdown tables/lists as the canonical format. Do not rely on JSON blobs.

## Index Directory Layout
- \`references/catalog.md\`: global directory of all saved connections and their index files.
- \`references/<connection-locator>/index.md\`: directory for one connection, mapping each namespace/database to a markdown file.
- \`references/<connection-locator>/<namespace-file>.md\`: full metadata for one namespace/database.

## SQL Workflow
1. Open \`references/catalog.md\` and locate the active connection index file.
2. Open the connection index file and locate the target namespace/database markdown file.
3. Read the namespace markdown file to verify table names, column types, PK/FK, and indexes.
4. Draft SQL based on the indexed structure.
5. If required metadata is missing or stale, refresh it via MCP SQL introspection and update the same files under \`references/\`.

## Tooling
- Use MCP tool \`velodeck_sql_execute\` for SQL execution.
- Write SQL requires explicit user approval.
`;

export class AgentService {
  private readonly runs = new Map<string, AgentRun>();
  private readonly configDir: string;
  private readonly skillsDir: string;

  constructor(
    private readonly events: EventService,
    private readonly mcpService: AgentMCPService,
    private readonly sessionService: SessionService,
    private readonly databaseService: DatabaseGatewayService,
  ) {
    this.configDir = join(homedir(), CONFIG_DIR_NAME);
    this.skillsDir = join(
      this.configDir,
      AGENT_DIR_NAME,
      AGENT_SKILLS_DIR_NAME,
    );
    this.ensureSkillTemplates();
  }

  async startRun(prompt: string): Promise<string> {
    const cleaned = prompt.trim();
    if (!cleaned) {
      throw new Error("prompt cannot be empty");
    }

    this.ensureSkillTemplates();

    const runId = randomBytes(8).toString("hex");
    const activeConnection = this.sessionService.getActiveConnection();
    const mcpToken = this.mcpService.registerRun(runId, activeConnection);
    const promptWithContext = await this.buildPromptWithContext(
      cleaned,
      activeConnection,
    );

    try {
      this.mcpService.upsertManagedProjectConfig(this.configDir);
      const mcpURL = this.mcpService.getMCPURL();
      const codexExecutable = this.resolveCodexExecutable();

      const child = Bun.spawn(
        [
          codexExecutable,
          ...this.buildCodexArgs(mcpURL),
          "-C",
          this.configDir,
          "--",
          promptWithContext,
        ],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          cwd: this.configDir,
          env: this.buildRunEnv(mcpToken, activeConnection),
        },
      );

      this.runs.set(runId, {
        runId,
        process: child,
        cancelled: false,
      });

      await this.events.emit(APP_EVENTS.agentRunStatus, {
        runId,
        status: "started",
      });

      void this.watchRun(runId);

      return runId;
    } catch (error) {
      this.mcpService.revokeRun(runId);
      throw error;
    }
  }

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }

    run.cancelled = true;
    run.process.kill();
    return true;
  }

  cancelAllRuns(): void {
    for (const run of this.runs.values()) {
      run.cancelled = true;
      run.process.kill();
    }
  }

  async resolveSQLApproval(input: AgentSQLApprovalResolveInput): Promise<void> {
    await this.mcpService.resolveApproval(input);
  }

  private resolveCodexExecutable(): string {
    const overridePath = process.env.VELODECK_CODEX_PATH?.trim();
    if (overridePath) {
      return overridePath;
    }

    const detected = Bun.which("codex");
    if (detected) {
      return detected;
    }

    const fallback = join(homedir(), ".bun", "bin", "codex");
    if (existsSync(fallback)) {
      return fallback;
    }

    return "codex";
  }

  private async buildPromptWithContext(
    userPrompt: string,
    activeConnection: ConnectionDetails | null,
  ): Promise<string> {
    const connectionSummary = this.describeConnection(activeConnection);
    const dbVersion = await this.resolveConnectionVersion(activeConnection);

    return [
      "You are running inside the VeloDeck desktop app.",
      "",
      "Runtime context:",
      `- Connection: ${connectionSummary}`,
      `- Database version: ${dbVersion || "unknown"}`,
      "",
      "Execution rules:",
      "- Use MCP tool `velodeck_sql_execute` for SQL execution.",
      "- Return end-user output as concise Markdown.",
      "- Do not output raw JSON event objects.",
      "",
      "User request:",
      userPrompt,
    ].join("\n");
  }

  private async resolveConnectionVersion(
    activeConnection: ConnectionDetails | null,
  ): Promise<string> {
    if (!activeConnection) {
      return "";
    }

    try {
      return await this.databaseService.getVersion(activeConnection);
    } catch (error) {
      logger.warn(
        `failed to resolve DB version for prompt context: ${String(error)}`,
      );
      return "";
    }
  }

  private describeConnection(
    activeConnection: ConnectionDetails | null,
  ): string {
    if (!activeConnection) {
      return "none";
    }

    switch (activeConnection.kind) {
      case "mysql":
      case "postgres":
        return `${activeConnection.kind} ${activeConnection.user}@${activeConnection.host}:${activeConnection.port}/${activeConnection.dbName}`;
      case "sqlite":
        return `sqlite file=${activeConnection.filePath}`;
      case "bigquery":
        return `bigquery project=${activeConnection.projectId}${activeConnection.location ? ` location=${activeConnection.location}` : ""}`;
      default:
        return "unknown";
    }
  }

  private buildCodexArgs(mcpURL: string): string[] {
    return [
      ...CODEX_BASE_ARGS,
      "-c",
      `mcp_servers.${VELODECK_MCP_SERVER_NAME}.url=\"${mcpURL}\"`,
      "-c",
      `mcp_servers.${VELODECK_MCP_SERVER_NAME}.bearer_token_env_var=\"${VELODECK_MCP_BEARER_ENV}\"`,
      "-c",
      `mcp_servers.${VELODECK_MCP_SERVER_NAME}.required=true`,
      "-c",
      `mcp_servers.${VELODECK_MCP_SERVER_NAME}.enabled=true`,
    ];
  }

  private buildRunEnv(
    mcpToken: string,
    activeConnection: ConnectionDetails | null,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      env[key] = String(value ?? "");
    }

    env[VELODECK_MCP_BEARER_ENV] = mcpToken;
    env.VELODECK_ACTIVE_DB_KIND = activeConnection?.kind || "";

    if (!activeConnection) {
      env.VELODECK_ACTIVE_DB_HOST = "";
      env.VELODECK_ACTIVE_DB_PORT = "";
      env.VELODECK_ACTIVE_DB_USER = "";
      env.VELODECK_ACTIVE_DB_NAME = "";
      env.VELODECK_ACTIVE_DB_TLS = "0";
      return env;
    }

    switch (activeConnection.kind) {
      case "mysql":
      case "postgres":
        env.VELODECK_ACTIVE_DB_HOST = activeConnection.host;
        env.VELODECK_ACTIVE_DB_PORT = activeConnection.port;
        env.VELODECK_ACTIVE_DB_USER = activeConnection.user;
        env.VELODECK_ACTIVE_DB_NAME = activeConnection.dbName;
        env.VELODECK_ACTIVE_DB_TLS = activeConnection.useTLS ? "1" : "0";
        break;
      case "sqlite":
        env.VELODECK_ACTIVE_DB_HOST = "";
        env.VELODECK_ACTIVE_DB_PORT = "";
        env.VELODECK_ACTIVE_DB_USER = "";
        env.VELODECK_ACTIVE_DB_NAME = activeConnection.filePath;
        env.VELODECK_ACTIVE_DB_TLS = "0";
        break;
      case "bigquery":
        env.VELODECK_ACTIVE_DB_HOST = "bigquery.googleapis.com";
        env.VELODECK_ACTIVE_DB_PORT = "443";
        env.VELODECK_ACTIVE_DB_USER = "";
        env.VELODECK_ACTIVE_DB_NAME = activeConnection.projectId;
        env.VELODECK_ACTIVE_DB_TLS = "1";
        break;
      default:
        env.VELODECK_ACTIVE_DB_HOST = "";
        env.VELODECK_ACTIVE_DB_PORT = "";
        env.VELODECK_ACTIVE_DB_USER = "";
        env.VELODECK_ACTIVE_DB_NAME = "";
        env.VELODECK_ACTIVE_DB_TLS = "0";
        break;
    }

    return env;
  }

  private async watchRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    let exitCode = -1;
    let errorMessage = "";

    try {
      const stdoutTask = this.consumeStream(
        runId,
        "stdout",
        run.process.stdout,
      );
      const stderrTask = this.consumeStream(
        runId,
        "stderr",
        run.process.stderr,
      );
      const waitExit = run.process.exited;

      const results = await Promise.all([stdoutTask, stderrTask, waitExit]);
      exitCode = results[2];
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`agent run failed (${runId}): ${errorMessage}`);
    } finally {
      this.mcpService.revokeRun(runId);
      this.runs.delete(runId);
    }

    if (run.cancelled) {
      await this.events.emit(APP_EVENTS.agentRunStatus, {
        runId,
        status: "cancelled",
        exitCode,
      });
      return;
    }

    if (errorMessage || exitCode !== 0) {
      await this.events.emit(APP_EVENTS.agentRunStatus, {
        runId,
        status: "failed",
        exitCode,
        error: errorMessage || `codex exited with code ${exitCode}`,
      });
      return;
    }

    await this.events.emit(APP_EVENTS.agentRunStatus, {
      runId,
      status: "completed",
      exitCode,
    });
  }

  private async consumeStream(
    runId: string,
    source: AgentRunEventSource,
    stream: ReadableStream<Uint8Array>,
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = await this.flushLines(runId, source, buffer);
      }

      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        await this.emitRunEvent(runId, source, buffer.trim());
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async flushLines(
    runId: string,
    source: AgentRunEventSource,
    content: string,
  ): Promise<string> {
    const lines = content.split(/\r?\n/);
    const tail = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      await this.emitRunEvent(runId, source, trimmed);
    }

    return tail;
  }

  private async emitRunEvent(
    runId: string,
    source: AgentRunEventSource,
    raw: string,
  ): Promise<void> {
    const clipped =
      raw.length > 4000 ? `${raw.slice(0, 4000)}...<truncated>` : raw;
    if (source === "stderr") {
      logger.warn(`[agent:${runId}] ${source}: ${clipped}`);
    } else {
      logger.info(`[agent:${runId}] ${source}: ${clipped}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }

    await this.events.emit(APP_EVENTS.agentRunEvent, {
      runId,
      source,
      raw,
      parsed,
    });
  }

  private ensureSkillTemplates(): void {
    mkdirSync(this.skillsDir, { recursive: true, mode: 0o750 });

    const dbIndexSkillDir = join(this.skillsDir, "db-index");
    const referencesDir = join(dbIndexSkillDir, "references");
    mkdirSync(referencesDir, { recursive: true, mode: 0o750 });

    const skillDocPath = join(dbIndexSkillDir, "SKILL.md");
    writeFileSync(skillDocPath, DB_INDEX_SKILL_TEMPLATE, { mode: 0o600 });
  }
}
