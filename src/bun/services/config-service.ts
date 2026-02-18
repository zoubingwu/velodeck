import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type AIProviderSettings,
  type ConfigData,
  type ConnectionDetails,
  type ThemeSettings,
  type WindowSettings,
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  DEFAULT_AI_PROVIDER,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_BASE_THEME,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_THEME_MODE,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_X,
  DEFAULT_WINDOW_Y,
} from "../../shared/contracts";

function generateConnectionId(): string {
  return randomBytes(4).toString("hex");
}

function getDefaultConfig(): ConfigData {
  return {
    connections: {},
    appearance: {
      mode: DEFAULT_THEME_MODE,
      baseTheme: DEFAULT_BASE_THEME,
    },
    ai: {
      provider: DEFAULT_AI_PROVIDER,
      openai: { model: DEFAULT_OPENAI_MODEL },
      anthropic: { model: DEFAULT_ANTHROPIC_MODEL },
      openrouter: { model: DEFAULT_OPENROUTER_MODEL },
    },
    window: {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      x: DEFAULT_WINDOW_X,
      y: DEFAULT_WINDOW_Y,
      isMaximized: false,
    },
  };
}

function omitConnectionId(details: ConnectionDetails): ConnectionDetails {
  const { id: _id, ...rest } = details;
  return rest;
}

export class ConfigService {
  private readonly configPath: string;
  private config: ConfigData;

  constructor() {
    this.configPath = join(homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
    this.config = getDefaultConfig();
    this.load();
  }

  private ensureDir(): void {
    mkdirSync(dirname(this.configPath), { recursive: true, mode: 0o750 });
  }

  private load(): void {
    if (!existsSync(this.configPath)) {
      return;
    }

    const raw = readFileSync(this.configPath, "utf8").trim();
    if (!raw) {
      return;
    }

    const loaded = JSON.parse(raw) as ConfigData;

    if (loaded.connections && typeof loaded.connections === "object") {
      this.config.connections = loaded.connections;
    }
    if (loaded.appearance) {
      this.config.appearance = loaded.appearance;
    }
    if (loaded.ai) {
      this.config.ai = loaded.ai;
    }
    if (loaded.window) {
      this.config.window = loaded.window;
    }
  }

  private save(): void {
    this.ensureDir();
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), {
      mode: 0o600,
    });
  }

  getAllConnections(): Record<string, ConnectionDetails> {
    const copy: Record<string, ConnectionDetails> = {};
    for (const [id, details] of Object.entries(this.config.connections)) {
      copy[id] = {
        ...details,
        id,
      };
    }
    return copy;
  }

  addOrUpdateConnection(details: ConnectionDetails): string {
    const name = details.name?.trim();
    if (!name) {
      throw new Error("connection name cannot be empty");
    }

    const targetId = details.id?.trim() || generateConnectionId();

    for (const [id, existing] of Object.entries(this.config.connections)) {
      if (id === targetId) {
        continue;
      }
      if (existing.name === name) {
        throw new Error(`connection name '${name}' already exists`);
      }
    }

    this.config.connections[targetId] = omitConnectionId({
      ...details,
      id: undefined,
      name,
    });

    this.save();
    return targetId;
  }

  deleteConnection(connectionId: string): void {
    if (!connectionId) {
      throw new Error("connection ID cannot be empty");
    }
    delete this.config.connections[connectionId];
    this.save();
  }

  getConnection(connectionId: string): { details: ConnectionDetails; found: boolean } {
    const details = this.config.connections[connectionId];
    if (!details) {
      return {
        details: {} as ConnectionDetails,
        found: false,
      };
    }

    return {
      details: {
        ...details,
        id: connectionId,
      },
      found: true,
    };
  }

  recordConnectionUsage(connectionId: string): void {
    const details = this.config.connections[connectionId];
    if (!details) {
      return;
    }

    this.config.connections[connectionId] = {
      ...details,
      lastUsed: new Date().toISOString(),
    };
    this.save();
  }

  getThemeSettings(): ThemeSettings {
    return {
      mode: this.config.appearance?.mode || DEFAULT_THEME_MODE,
      baseTheme: this.config.appearance?.baseTheme || DEFAULT_BASE_THEME,
    };
  }

  saveThemeSettings(settings: ThemeSettings): void {
    this.config.appearance = settings;
    this.save();
  }

  getAIProviderSettings(): AIProviderSettings {
    return {
      provider: this.config.ai?.provider || DEFAULT_AI_PROVIDER,
      openai: {
        model: this.config.ai?.openai?.model || DEFAULT_OPENAI_MODEL,
        apiKey: this.config.ai?.openai?.apiKey || "",
        baseURL: this.config.ai?.openai?.baseURL || "",
      },
      anthropic: {
        model: this.config.ai?.anthropic?.model || DEFAULT_ANTHROPIC_MODEL,
        apiKey: this.config.ai?.anthropic?.apiKey || "",
        baseURL: this.config.ai?.anthropic?.baseURL || "",
      },
      openrouter: {
        model: this.config.ai?.openrouter?.model || DEFAULT_OPENROUTER_MODEL,
        apiKey: this.config.ai?.openrouter?.apiKey || "",
      },
    };
  }

  saveAIProviderSettings(settings: AIProviderSettings): void {
    this.config.ai = settings;
    this.save();
  }

  getWindowSettings(): WindowSettings {
    return {
      width: this.config.window?.width ?? DEFAULT_WINDOW_WIDTH,
      height: this.config.window?.height ?? DEFAULT_WINDOW_HEIGHT,
      x: this.config.window?.x ?? DEFAULT_WINDOW_X,
      y: this.config.window?.y ?? DEFAULT_WINDOW_Y,
      isMaximized: this.config.window?.isMaximized ?? false,
    };
  }

  saveWindowSettings(settings: WindowSettings): void {
    this.config.window = settings;
    this.save();
  }
}
