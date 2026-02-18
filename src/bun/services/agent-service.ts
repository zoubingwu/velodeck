import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AGENT_DIR_NAME,
  AGENT_SKILLS_DIR_NAME,
  type AgentRunEventSource,
  APP_EVENTS,
  CONFIG_DIR_NAME,
  type ConnectionDetails,
} from "../../shared/contracts";
import type { EventService } from "../events";
import type { AgentBridgeService } from "./agent-bridge-service";
import { logger } from "./logger-service";
import type { SessionService } from "./session-service";

type AgentRun = {
  runId: string;
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  cancelled: boolean;
};

const CODEX_ARGS = [
  "exec",
  "--json",
  "--skip-git-repo-check",
  "-a",
  "never",
  "-s",
  "read-only",
] as const;

const SKILL_MD_TEMPLATE = `# TiDB Read-only SQL Skill

Use this skill when you need to run read-only SQL against the active TiDB connection.

## Rules
- Only read-only SQL is allowed.
- Allowed: SELECT, SHOW, DESCRIBE, EXPLAIN, WITH (read-only query).
- Disallowed: INSERT, UPDATE, DELETE, DDL, privilege changes, multiple statements.

## How to execute
Run the helper script below and pass the SQL text:

\`\`\`bash
./scripts/sql_read.sh "SELECT * FROM users LIMIT 10"
\`\`\`

The script calls the local TiDB Desktop bridge via:
- \`TIDB_AGENT_BRIDGE_URL\`
- \`TIDB_AGENT_BRIDGE_TOKEN\`
`;

const SKILL_SCRIPT_TEMPLATE = `#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: ./scripts/sql_read.sh \\"<read-only-sql>\\"" >&2
  exit 1
fi

if [[ -z "\${TIDB_AGENT_BRIDGE_URL:-}" || -z "\${TIDB_AGENT_BRIDGE_TOKEN:-}" ]]; then
  echo "missing TIDB_AGENT_BRIDGE_URL or TIDB_AGENT_BRIDGE_TOKEN" >&2
  exit 1
fi

query="$*"

curl -sS \\
  -H "Authorization: Bearer \${TIDB_AGENT_BRIDGE_TOKEN}" \\
  -H "Content-Type: text/plain; charset=utf-8" \\
  --data "$query" \\
  "\${TIDB_AGENT_BRIDGE_URL}/v1/sql/read"
`;

export class AgentService {
  private readonly runs = new Map<string, AgentRun>();
  private readonly configDir: string;
  private readonly skillsDir: string;

  constructor(
    private readonly events: EventService,
    private readonly bridgeService: AgentBridgeService,
    private readonly sessionService: SessionService,
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
    const bridgeToken = this.bridgeService.registerRun(runId);
    const activeConnection = this.sessionService.getActiveConnection();

    try {
      const child = Bun.spawn(
        [...CODEX_ARGS, "-C", this.configDir, "--", cleaned],
        {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          cwd: this.configDir,
          env: this.buildRunEnv(bridgeToken, activeConnection),
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
      this.bridgeService.revokeRun(runId);
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

  private buildRunEnv(
    bridgeToken: string,
    activeConnection: ConnectionDetails | null,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      env[key] = String(value ?? "");
    }

    env.TIDB_AGENT_BRIDGE_URL = this.bridgeService.getBaseURL();
    env.TIDB_AGENT_BRIDGE_TOKEN = bridgeToken;
    env.TIDB_ACTIVE_DB_HOST = activeConnection?.host || "";
    env.TIDB_ACTIVE_DB_PORT = activeConnection?.port || "";
    env.TIDB_ACTIVE_DB_USER = activeConnection?.user || "";
    env.TIDB_ACTIVE_DB_NAME = activeConnection?.dbName || "";
    env.TIDB_ACTIVE_DB_TLS = activeConnection?.useTLS ? "1" : "0";

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
      this.bridgeService.revokeRun(runId);
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
    const scriptsDir = join(this.skillsDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true, mode: 0o750 });

    const skillDocPath = join(this.skillsDir, "SKILL.md");
    if (!existsSync(skillDocPath)) {
      writeFileSync(skillDocPath, SKILL_MD_TEMPLATE, { mode: 0o600 });
    }

    const scriptPath = join(scriptsDir, "sql_read.sh");
    if (!existsSync(scriptPath)) {
      writeFileSync(scriptPath, SKILL_SCRIPT_TEMPLATE, { mode: 0o700 });
    }

    chmodSync(scriptPath, 0o700);
  }
}
