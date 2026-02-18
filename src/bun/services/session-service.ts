import type { ConnectionDetails } from "../../shared/contracts";

export class SessionService {
  private activeConnection: ConnectionDetails | null = null;
  private activeConnectionId = "";

  setActiveConnection(connectionId: string, details: ConnectionDetails): void {
    this.activeConnectionId = connectionId;
    this.activeConnection = {
      ...details,
      id: connectionId,
    };
  }

  clearActiveConnection(): void {
    this.activeConnectionId = "";
    this.activeConnection = null;
  }

  getActiveConnection(): ConnectionDetails | null {
    return this.activeConnection;
  }

  getActiveConnectionId(): string {
    return this.activeConnectionId;
  }

  ensureActiveConnection(): { id: string; details: ConnectionDetails } {
    if (!this.activeConnection || !this.activeConnectionId) {
      throw new Error("no active database connection established for this session");
    }

    return {
      id: this.activeConnectionId,
      details: this.activeConnection,
    };
  }
}
