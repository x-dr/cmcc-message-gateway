import type { CmccGateway } from "../cmcc-gateway.js";
import { LAST_FRAME_KEY } from "../constants.js";
import { errorMessage } from "../http.js";
import {
  isCmccFrame,
  normalizeInbound,
  parseWebSocketFrame,
  sanitizeFrame,
} from "../message-format.js";
import { addInbox, setAutoRecipient } from "./recipients.js";

export async function handleWebSocketMessage(
  gateway: CmccGateway,
  data: unknown,
): Promise<void> {
  let parsed: unknown;

  try {
    parsed = await parseWebSocketFrame(data);
  } catch {
    return;
  }

  await gateway.state.storage.put(LAST_FRAME_KEY, {
    receivedAt: Date.now(),
    frame: sanitizeFrame(parsed),
  });

  if (!isCmccFrame(parsed)) return;

  const type = String(parsed.type || "");

  if (type === "auth_ok") {
    gateway.authenticated = true;
    gateway.lastError = null;

    if (gateway.authTimeout !== null) {
      clearTimeout(gateway.authTimeout);
      gateway.authTimeout = null;
    }

    gateway.authResolve?.();
    gateway.authResolve = null;
    gateway.authReject = null;
    return;
  }

  if (type === "auth_failed") {
    handleAuthenticationFailure(gateway, parsed.message);
    return;
  }

  if (type === "pong") {
    gateway.lastPongAt = Date.now();
    return;
  }

  if (type === "ping") {
    if (gateway.isOpen()) {
      gateway.ws.send(JSON.stringify({ type: "pong" }));
    }
    return;
  }

  if (["text_message", "media_message", "message"].includes(type)) {
    const sender = String(parsed.from || parsed.phone || "").trim();

    // CMCC 的某些状态回包也叫 message，但没有 from，不能覆盖接收人。
    if (!sender) return;

    const message = normalizeInbound(parsed, sender);
    await setAutoRecipient(gateway, message);
    await addInbox(gateway, message);

    if (gateway.bindings.INBOUND_WEBHOOK_URL) {
      gateway.state.waitUntil(deliverWebhook(gateway, message));
    }
  }
}

function handleAuthenticationFailure(
  gateway: CmccGateway,
  rawMessage: unknown,
): void {
  const error = new Error(
    rawMessage ? String(rawMessage) : "CMCC authentication failed",
  );

  if (gateway.authTimeout !== null) {
    clearTimeout(gateway.authTimeout);
    gateway.authTimeout = null;
  }

  gateway.authenticated = false;
  gateway.lastError = error.message;
  gateway.authReject?.(error);
  gateway.authResolve = null;
  gateway.authReject = null;

  try {
    gateway.ws?.close(4003, "auth failed");
  } catch {
    // ignore
  }
}

async function deliverWebhook(
  gateway: CmccGateway,
  message: unknown,
): Promise<void> {
  const url = String(gateway.bindings.INBOUND_WEBHOOK_URL || "").trim();
  if (!url) return;

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const token = String(gateway.bindings.INBOUND_WEBHOOK_TOKEN || "").trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
  } catch (error) {
    gateway.lastError = `Inbound webhook: ${errorMessage(error)}`;
  }
}
