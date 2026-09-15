import { DurableObject } from "cloudflare:workers";
import type { Hono } from "hono";

import {
  DEFAULT_CMCC_SERVER,
  DEFAULT_CMCC_UPLOAD,
  DEFAULT_CMCC_VERSION,
} from "./constants.js";
import type { Bindings } from "./env.js";
import { ensureConnected } from "./gateway/connection.js";
import { createGatewayApp } from "./gateway/router.js";
import { errorMessage } from "./http.js";

export class CmccGateway extends DurableObject<Bindings> {
  readonly state: DurableObjectState;
  readonly bindings: Bindings;

  ws: WebSocket | null = null;
  authenticated = false;
  connectPromise: Promise<void> | null = null;
  authResolve: (() => void) | null = null;
  authReject: ((reason?: unknown) => void) | null = null;
  authTimeout: ReturnType<typeof setTimeout> | null = null;
  heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  lastPongAt = 0;
  lastConnectAt = 0;
  lastDisconnectAt = 0;
  lastError: string | null = null;

  private readonly app: Hono;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.state = ctx;
    this.bindings = env;
    this.app = createGatewayApp(this);

    this.state.blockConcurrencyWhile(async () => {
      const alarm = await this.state.storage.getAlarm();
      if (alarm == null) {
        await this.state.storage.setAlarm(Date.now() + 30_000);
      }
    });
  }

  get cmccApiKey(): string {
    return String(this.bindings.CMCC_API_KEY || "").trim();
  }

  get serverUrl(): string {
    return (
      String(this.bindings.CMCC_SERVER_URL || "").trim() ||
      DEFAULT_CMCC_SERVER
    );
  }

  get uploadBaseUrl(): string {
    return (
      String(this.bindings.CMCC_UPLOAD_URL || "").trim() ||
      DEFAULT_CMCC_UPLOAD
    ).replace(/\/+$/, "");
  }

  get cmccVersion(): string {
    return (
      String(this.bindings.CMCC_VERSION || "").trim() || DEFAULT_CMCC_VERSION
    );
  }

  isOpen(): this is this & { ws: WebSocket } {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request);
  }

  async alarm(): Promise<void> {
    try {
      await ensureConnected(this);
    } catch (error) {
      this.lastError = errorMessage(error);
    } finally {
      await this.state.storage.setAlarm(Date.now() + 5 * 60_000);
    }
  }
}
