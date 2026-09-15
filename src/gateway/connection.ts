import type { CmccGateway } from "../cmcc-gateway.js";
import { errorMessage } from "../http.js";
import { handleWebSocketMessage } from "./inbound.js";

export async function ensureConnected(gateway: CmccGateway): Promise<void> {
  if (!gateway.cmccApiKey) {
    throw new Error("CMCC_API_KEY Secret 未配置");
  }

  if (gateway.isOpen() && gateway.authenticated) {
    return;
  }

  if (gateway.connectPromise) {
    return gateway.connectPromise;
  }

  gateway.connectPromise = connectInternal(gateway);

  try {
    await gateway.connectPromise;
  } finally {
    gateway.connectPromise = null;
  }
}

async function connectInternal(gateway: CmccGateway): Promise<void> {
  cleanupSocket(gateway, false);
  gateway.lastError = null;

  // Cloudflare fetch() 只接受 HTTP(S)，WebSocket 通过 Upgrade 完成握手。
  const upgradeUrl = gateway.serverUrl
    .replace(/^wss:/i, "https:")
    .replace(/^ws:/i, "http:");

  const response = await fetch(upgradeUrl, {
    headers: {
      Upgrade: "websocket",
      "X-API-Key": gateway.cmccApiKey,
    },
  });

  const ws = response.webSocket;
  if (!ws) {
    throw new Error(`CMCC WebSocket 握手失败，HTTP ${response.status}`);
  }

  ws.accept();
  gateway.ws = ws;
  gateway.authenticated = false;
  gateway.lastConnectAt = Date.now();
  gateway.lastPongAt = Date.now();

  ws.addEventListener("message", (event) => {
    gateway.state.waitUntil(handleWebSocketMessage(gateway, event.data));
  });

  ws.addEventListener("close", (event) => {
    handleWebSocketClose(gateway, event);
  });

  ws.addEventListener("error", () => {
    gateway.lastError = "CMCC WebSocket error";
  });

  const authPromise = new Promise<void>((resolve, reject) => {
    gateway.authResolve = resolve;
    gateway.authReject = reject;

    gateway.authTimeout = setTimeout(() => {
      gateway.authTimeout = null;

      if (!gateway.authenticated) {
        const error = new Error("等待 CMCC auth_ok 超时");
        gateway.authReject?.(error);
        gateway.authReject = null;
        gateway.authResolve = null;

        try {
          gateway.ws?.close(4001, "auth timeout");
        } catch {
          // ignore
        }
      }
    }, 10_000);
  });

  ws.send(
    JSON.stringify({
      type: "auth",
      apiKey: gateway.cmccApiKey,
      version: gateway.cmccVersion,
    }),
  );

  await authPromise;
  startHeartbeat(gateway);
  await gateway.state.storage.setAlarm(Date.now() + 5 * 60_000);
}

function startHeartbeat(gateway: CmccGateway): void {
  stopHeartbeat(gateway);

  gateway.heartbeatTimer = setInterval(() => {
    try {
      if (!gateway.isOpen()) {
        stopHeartbeat(gateway);
        return;
      }

      if (
        gateway.lastPongAt &&
        Date.now() - gateway.lastPongAt > 45_000
      ) {
        gateway.lastError = "CMCC pong timeout";
        gateway.ws.close(4002, "pong timeout");
        return;
      }

      gateway.ws.send(JSON.stringify({ type: "ping" }));
    } catch (error) {
      gateway.lastError = errorMessage(error);
    }
  }, 15_000);
}

function stopHeartbeat(gateway: CmccGateway): void {
  if (gateway.heartbeatTimer !== null) {
    clearInterval(gateway.heartbeatTimer);
    gateway.heartbeatTimer = null;
  }
}

function cleanupSocket(gateway: CmccGateway, close = true): void {
  stopHeartbeat(gateway);

  if (gateway.authTimeout !== null) {
    clearTimeout(gateway.authTimeout);
    gateway.authTimeout = null;
  }

  if (close && gateway.ws) {
    try {
      gateway.ws.close(1000, "reconnect");
    } catch {
      // ignore
    }
  }

  gateway.ws = null;
  gateway.authenticated = false;
}

function handleWebSocketClose(
  gateway: CmccGateway,
  event: CloseEvent,
): void {
  stopHeartbeat(gateway);
  gateway.ws = null;
  gateway.authenticated = false;
  gateway.lastDisconnectAt = Date.now();

  if (event.code && event.code !== 1000) {
    gateway.lastError =
      `WebSocket closed: ${event.code} ${event.reason || ""}`.trim();
  }

  gateway.state.waitUntil(
    gateway.state.storage.setAlarm(Date.now() + 3_000),
  );
}
