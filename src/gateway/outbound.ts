import type { CmccGateway } from "../cmcc-gateway.js";
import { randomId } from "../message-format.js";
import { ensureConnected } from "./connection.js";

export interface OutboundMediaMessage extends Record<string, unknown> {
  to: string;
  mediaType: unknown;
  content?: unknown;
  mediaUrl: unknown;
  thumbnailUrl?: unknown;
  mediaFileName?: unknown;
  mediaSize?: unknown;
  mediaMimeType?: unknown;
}

function openSocket(gateway: CmccGateway): WebSocket {
  if (!gateway.isOpen()) {
    throw new Error("CMCC WebSocket 尚未连接");
  }
  return gateway.ws;
}

export async function sendText(
  gateway: CmccGateway,
  to: string,
  content: string,
): Promise<string> {
  await ensureConnected(gateway);

  const messageId = randomId("msg");
  openSocket(gateway).send(
    JSON.stringify({
      type: "send",
      apiKey: gateway.cmccApiKey,
      to,
      content,
      messageId,
    }),
  );

  return messageId;
}

export async function sendMedia(
  gateway: CmccGateway,
  message: OutboundMediaMessage,
): Promise<{ messageId: string }> {
  await ensureConnected(gateway);

  const messageId = randomId("msg");
  const payload: Record<string, unknown> = {
    type: "send",
    apiKey: gateway.cmccApiKey,
    to: message.to,
    mediaType: message.mediaType,
    content: message.content || "",
    mediaUrl: message.mediaUrl,
    messageId,
  };

  for (const field of [
    "thumbnailUrl",
    "mediaFileName",
    "mediaSize",
    "mediaMimeType",
  ] as const) {
    if (message[field] != null && message[field] !== "") {
      payload[field] = message[field];
    }
  }

  openSocket(gateway).send(JSON.stringify(payload));
  return { messageId };
}

export async function uploadMedia(
  gateway: CmccGateway,
  file: File,
): Promise<{ mediaUrl: unknown; rawCode: unknown }> {
  if (!gateway.cmccApiKey) {
    throw new Error("CMCC_API_KEY Secret 未配置");
  }

  const form = new FormData();
  form.append("file", file, file.name || "upload.bin");
  form.append("apiKey", gateway.cmccApiKey);

  const response = await fetch(`${gateway.uploadBaseUrl}/upload`, {
    method: "POST",
    body: form,
  });

  let result: Record<string, unknown>;
  try {
    result = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`CMCC upload 返回非 JSON，HTTP ${response.status}`);
  }

  if (!response.ok || Number(result.code) !== 10200 || !result.data) {
    const code = result.code ?? "unknown";
    const message = result.message ?? "unknown";
    throw new Error(
      `CMCC upload 失败：HTTP ${response.status}, code=${String(code)}, message=${String(message)}`,
    );
  }

  return {
    mediaUrl: result.data,
    rawCode: result.code,
  };
}
