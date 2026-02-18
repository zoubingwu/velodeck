import type { AppEventName } from "../shared/contracts";
import { logger } from "./services/logger-service";

export type EventEnvelope = {
  eventName: AppEventName;
  payload?: unknown;
};

export class EventService {
  private windowRef: any = null;

  attachWindow(window: any): void {
    this.windowRef = window;
  }

  async emit(eventName: AppEventName, payload?: unknown): Promise<void> {
    if (!this.windowRef?.webview?.rpc?.request?.emitEvent) {
      return;
    }

    try {
      await this.windowRef.webview.rpc.request.emitEvent({
        eventName,
        payload,
      });
    } catch (error) {
      logger.warn(`failed to emit event '${eventName}': ${String(error)}`);
    }
  }
}

export const events = new EventService();
