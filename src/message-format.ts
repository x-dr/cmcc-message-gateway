export interface CmccMediaFrame {
  type?: unknown;
  url?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
  thumbnailUrl?: unknown;
}

export interface CmccFrame extends Record<string, unknown> {
  type?: unknown;
  messageId?: unknown;
  id?: unknown;
  from?: unknown;
  phone?: unknown;
  content?: unknown;
  text?: unknown;
  message?: unknown;
  timestamp?: unknown;
  mediaType?: unknown;
  mediaUrl?: unknown;
  mediaFileName?: unknown;
  mediaMimeType?: unknown;
  mediaSize?: unknown;
  thumbnailUrl?: unknown;
  media?: CmccMediaFrame;
}

export interface InboundMessage {
  id: unknown;
  type: "text" | "media";
  from: string;
  content: string;
  timestamp: number;
  receivedAt: number;
  media?: {
    type: unknown;
    url: unknown;
    fileName: unknown;
    mimeType: unknown;
    size: unknown;
    thumbnailUrl: unknown;
  };
}

export function randomId(prefix = "msg"): string {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  return `${prefix}_${Date.now()}_${suffix}`;
}

export function trimText(value: unknown, max = 4000): string {
  if (value == null) return "";
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function parseWebSocketFrame(data: unknown): Promise<unknown> {
  let text: string;

  if (typeof data === "string") {
    text = data;
  } else if (data instanceof Blob) {
    // Cloudflare 2026 runtime 默认以 Blob 交付 WebSocket 二进制消息。
    text = await data.text();
  } else if (data instanceof ArrayBuffer) {
    text = new TextDecoder().decode(data);
  } else if (ArrayBuffer.isView(data)) {
    text = new TextDecoder().decode(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
  } else {
    text = String(data);
  }

  return JSON.parse(text) as unknown;
}

export function isCmccFrame(value: unknown): value is CmccFrame {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeInbound(
  frame: CmccFrame,
  sender: string,
): InboundMessage {
  const mediaType = frame.mediaType || frame.media?.type || undefined;

  return {
    id: frame.messageId || frame.id || randomId("in"),
    type: mediaType ? "media" : "text",
    from: sender,
    content: trimText(
      frame.content ?? frame.text ?? frame.message ?? "",
      8000,
    ),
    timestamp: Number(frame.timestamp) || Date.now(),
    receivedAt: Date.now(),
    ...(mediaType
      ? {
          media: {
            type: mediaType,
            url: frame.mediaUrl || frame.media?.url || undefined,
            fileName:
              frame.mediaFileName || frame.media?.fileName || undefined,
            mimeType:
              frame.mediaMimeType || frame.media?.mimeType || undefined,
            size: frame.mediaSize || frame.media?.size || undefined,
            thumbnailUrl:
              frame.thumbnailUrl || frame.media?.thumbnailUrl || undefined,
          },
        }
      : {}),
  };
}

export function sanitizeFrame(frame: unknown): unknown {
  if (!frame || typeof frame !== "object") {
    return frame;
  }

  const copy: Record<string, unknown> = { ...frame };

  for (const key of ["apiKey", "token", "authorization", "Authorization"]) {
    if (key in copy) copy[key] = "***";
  }

  if (typeof copy.content === "string") {
    copy.content = trimText(copy.content, 1000);
  }

  return copy;
}

export function inferMediaType(mime = ""): string {
  const type = mime.toLowerCase();

  if (type.startsWith("image/")) return "IMAGE";
  if (type.startsWith("video/")) return "VIDEO";
  if (type.startsWith("audio/")) return "AUDIO";
  if (type.startsWith("text/")) return "TEXT";

  return "FILE";
}
