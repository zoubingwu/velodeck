import type { AppEventName, AppEventPayloadMap } from "../shared/contracts";
import type { AppRPCSchema } from "../shared/rpc-schema";
import { logger } from "./services/logger-service";

type RendererEventMap = AppRPCSchema["webview"]["messages"];

type MainWindowRef = {
  webview?: {
    rpc?: {
      send: {
        [EventName in keyof RendererEventMap]: (
          payload: RendererEventMap[EventName],
        ) => void;
      };
    };
  };
};

export class EventService {
  private windowRef: MainWindowRef | null = null;

  attachWindow(window: MainWindowRef): void {
    this.windowRef = window;
  }

  async emit<EventName extends AppEventName>(
    eventName: EventName,
    payload: AppEventPayloadMap[EventName],
  ): Promise<void> {
    if (!this.windowRef?.webview?.rpc?.send) {
      return;
    }

    try {
      this.windowRef.webview.rpc.send[eventName](payload);
    } catch (error) {
      logger.warn(`failed to emit event '${eventName}': ${String(error)}`);
    }
  }
}

export const events = new EventService();
