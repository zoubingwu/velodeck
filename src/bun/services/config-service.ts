import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  type ConfigData,
  type ConnectionProfile,
  connectionProfileSchema,
  DEFAULT_BASE_THEME,
  DEFAULT_THEME_MODE,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEFAULT_WINDOW_X,
  DEFAULT_WINDOW_Y,
  type ThemeSettings,
  type WindowSettings,
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
    window: {
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      x: DEFAULT_WINDOW_X,
      y: DEFAULT_WINDOW_Y,
      isMaximized: false,
    },
  };
}

function omitConnectionId(details: ConnectionProfile): ConnectionProfile {
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
      const next: Record<string, ConnectionProfile> = {};
      for (const [id, value] of Object.entries(loaded.connections)) {
        try {
          const parsed = connectionProfileSchema.parse({
            ...((value as unknown as Record<string, unknown>) || {}),
            id,
          });

          next[id] = {
            ...parsed,
            id: undefined,
          };
        } catch {
          // Break compatibility by design: ignore invalid connection entries.
        }
      }
      this.config.connections = next;
    }

    if (loaded.appearance) {
      this.config.appearance = loaded.appearance;
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

  getAllConnections(): Record<string, ConnectionProfile> {
    const copy: Record<string, ConnectionProfile> = {};
    for (const [id, details] of Object.entries(this.config.connections)) {
      copy[id] = {
        ...details,
        id,
      };
    }
    return copy;
  }

  addOrUpdateConnection(profile: ConnectionProfile): string {
    const name = profile.name?.trim();
    if (!name) {
      throw new Error("connection name cannot be empty");
    }

    const targetId = profile.id?.trim() || generateConnectionId();

    for (const [id, existing] of Object.entries(this.config.connections)) {
      if (id === targetId) {
        continue;
      }
      if (existing.name === name) {
        throw new Error(`connection name '${name}' already exists`);
      }
    }

    this.config.connections[targetId] = omitConnectionId({
      ...profile,
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

  getConnection(connectionId: string): {
    profile: ConnectionProfile;
    found: boolean;
  } {
    const profile = this.config.connections[connectionId];
    if (!profile) {
      return {
        profile: {} as ConnectionProfile,
        found: false,
      };
    }

    return {
      profile: {
        ...profile,
        id: connectionId,
      },
      found: true,
    };
  }

  recordConnectionUsage(connectionId: string): void {
    const profile = this.config.connections[connectionId];
    if (!profile) {
      return;
    }

    this.config.connections[connectionId] = {
      ...profile,
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
