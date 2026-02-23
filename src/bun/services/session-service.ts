import type { ConnectionProfile } from "../../shared/contracts";

export class SessionService {
  private activeConnection: ConnectionProfile | null = null;
  private activeConnectionId = "";

  setActiveConnection(connectionId: string, profile: ConnectionProfile): void {
    this.activeConnectionId = connectionId;
    this.activeConnection = {
      ...profile,
      id: connectionId,
    };
  }

  clearActiveConnection(): void {
    this.activeConnectionId = "";
    this.activeConnection = null;
  }

  getActiveConnection(): ConnectionProfile | null {
    return this.activeConnection;
  }

  getActiveConnectionId(): string {
    return this.activeConnectionId;
  }

  ensureActiveConnection(): { id: string; profile: ConnectionProfile } {
    if (!this.activeConnection || !this.activeConnectionId) {
      throw new Error(
        "no active database connection established for this session",
      );
    }

    return {
      id: this.activeConnectionId,
      profile: this.activeConnection,
    };
  }
}
