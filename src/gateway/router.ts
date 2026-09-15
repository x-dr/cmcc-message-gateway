import { Hono } from "hono";

import type { CmccGateway } from "../cmcc-gateway.js";
import {
  INBOX_KEY,
  LAST_FRAME_KEY,
  MAX_INBOX,
  RECIPIENT_KEY,
} from "../constants.js";
import { decodePathPart, errorMessage, json, readJson } from "../http.js";
import type { InboundMessage } from "../message-format.js";
import { inferMediaType } from "../message-format.js";
import { ensureConnected } from "./connection.js";
import { sendMedia, sendText, uploadMedia } from "./outbound.js";
import type { Recipient } from "./recipients.js";
import {
  getFallbackRecipient,
  requireRecipient,
  resolveRecipient,
} from "./recipients.js";

type RequestBody = Record<string, unknown>;

export function createGatewayApp(gateway: CmccGateway): Hono {
  const app = new Hono();

  app.all("/health", async () => healthResponse(gateway));

  app.all("/connect", async () => {
    await ensureConnected(gateway);
    return json({
      ok: true,
      connected: gateway.isOpen(),
      authenticated: gateway.authenticated,
      timestamp: Date.now(),
    });
  });

  app.all("/api/recipient", async () => {
    const stored = await gateway.state.storage.get<Recipient>(RECIPIENT_KEY);
    const fallback = getFallbackRecipient(gateway);

    return json({
      ok: true,
      recipient: stored || fallback || null,
      autoRecipient: true,
      timestamp: Date.now(),
    });
  });

  app.all("/api/inbox", async (context) =>
    inboxResponse(gateway, context.req.query("limit")),
  );

  app.all("/api/debug/last-frame", async () =>
    json({
      ok: true,
      frame: (await gateway.state.storage.get(LAST_FRAME_KEY)) || null,
    }),
  );

  app.post("/push", async (context) => {
    const body = await readJson<RequestBody>(context.req.raw);
    return handlePush(gateway, {
      to: body.to,
      title: body.title,
      body: body.body ?? body.content ?? body.message,
    });
  });

  app.get("/push", (context) =>
    handlePush(gateway, {
      to: context.req.query("to") || "",
      title: context.req.query("title") || "",
      body:
        context.req.query("body") ||
        context.req.query("content") ||
        context.req.query("message") ||
        "",
    }),
  );

  // Hono 的 `*` 也会匹配空尾段，精确路由必须先注册。
  app.get("/push/*", (context) =>
    handlePathPush(gateway, context.req.path, context.req.query()),
  );

  app.post("/api/messages/send", async (context) => {
    const body = await readJson<RequestBody>(context.req.raw);
    return handlePush(gateway, {
      to: body.to,
      title: body.title,
      body: body.body ?? body.content ?? body.message,
    });
  });

  app.post("/api/media/send", async (context) =>
    handleMediaSend(
      gateway,
      await readJson<RequestBody>(context.req.raw),
    ),
  );

  app.post("/api/media/upload-send", (context) =>
    handleMediaUpload(gateway, context.req.raw),
  );

  app.notFound(() =>
    json(
      {
        ok: false,
        code: 404,
        message: "Not Found",
      },
      404,
    ),
  );

  app.onError((error) => {
    gateway.lastError = errorMessage(error);
    return json(
      {
        ok: false,
        code: 500,
        message: gateway.lastError,
      },
      500,
    );
  });

  return app;
}

async function healthResponse(gateway: CmccGateway): Promise<Response> {
  const recipient = await resolveRecipient(gateway, "");

  return json({
    ok: true,
    service: "cmcc-message-gateway",
    connected: gateway.isOpen(),
    authenticated: gateway.authenticated,
    hasRecipient: Boolean(recipient),
    recipient: recipient
      ? {
          id: recipient.id,
          source: recipient.source,
          updatedAt: recipient.updatedAt,
        }
      : null,
    lastConnectAt: gateway.lastConnectAt || null,
    lastDisconnectAt: gateway.lastDisconnectAt || null,
    lastPongAt: gateway.lastPongAt || null,
    lastError: gateway.lastError,
    timestamp: Date.now(),
  });
}

async function inboxResponse(
  gateway: CmccGateway,
  rawLimit: string | undefined,
): Promise<Response> {
  const requested = Number.parseInt(rawLimit || "50", 10);
  const limit = Math.max(
    1,
    Math.min(Number.isFinite(requested) ? requested : 50, MAX_INBOX),
  );
  const inbox =
    (await gateway.state.storage.get<InboundMessage[]>(INBOX_KEY)) || [];

  return json({
    ok: true,
    count: Math.min(limit, inbox.length),
    totalStored: inbox.length,
    messages: inbox.slice(0, limit),
  });
}

function handlePathPush(
  gateway: CmccGateway,
  path: string,
  query: Record<string, string>,
): Promise<Response> | Response {
  const parts = path
    .slice("/push/".length)
    .split("/")
    .map(decodePathPart)
    .filter((part) => part !== "");

  if (parts.length === 1) {
    return handlePush(gateway, {
      body: parts[0],
      to: query.to || "",
      title: query.title || "",
    });
  }

  if (parts.length >= 2) {
    return handlePush(gateway, {
      title: parts[0],
      body: parts.slice(1).join("/"),
      to: query.to || "",
    });
  }

  return json(
    {
      code: 400,
      message: "缺少消息内容",
    },
    400,
  );
}

async function handlePush(
  gateway: CmccGateway,
  values: { to?: unknown; title?: unknown; body?: unknown },
): Promise<Response> {
  const contentBody = String(values.body || "").trim();
  const contentTitle = String(values.title || "").trim();

  if (!contentBody && !contentTitle) {
    return json(
      {
        code: 400,
        message: "消息内容不能为空",
      },
      400,
    );
  }

  const recipient = await requireRecipient(gateway, values.to);
  const content =
    contentTitle && contentBody
      ? `${contentTitle}\n${contentBody}`
      : contentTitle || contentBody;
  const messageId = await sendText(gateway, recipient.id, content);

  return successResponse(messageId, recipient);
}

async function handleMediaSend(
  gateway: CmccGateway,
  body: RequestBody,
): Promise<Response> {
  const recipient = await requireRecipient(gateway, body.to);

  if (!body.mediaUrl) {
    return json(
      {
        code: 400,
        message: "mediaUrl 不能为空",
      },
      400,
    );
  }

  const result = await sendMedia(gateway, {
    to: recipient.id,
    mediaType: body.mediaType || "FILE",
    content: body.content || body.title || "",
    mediaUrl: body.mediaUrl,
    thumbnailUrl: body.thumbnailUrl,
    mediaFileName: body.mediaFileName || body.fileName,
    mediaSize: body.mediaSize,
    mediaMimeType: body.mediaMimeType || body.mimeType,
  });

  return successResponse(result.messageId, recipient);
}

async function handleMediaUpload(
  gateway: CmccGateway,
  request: Request,
): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return json(
      {
        code: 400,
        message: "multipart/form-data 中缺少 file",
      },
      400,
    );
  }

  const recipient = await requireRecipient(gateway, form.get("to"));
  const uploaded = await uploadMedia(gateway, file);
  const result = await sendMedia(gateway, {
    to: recipient.id,
    mediaType: String(form.get("mediaType") || inferMediaType(file.type)),
    content: String(form.get("content") || ""),
    mediaUrl: uploaded.mediaUrl,
    mediaFileName: file.name,
    mediaSize: file.size,
    mediaMimeType: file.type || undefined,
  });

  return successResponse(result.messageId, recipient, {
    mediaUrl: uploaded.mediaUrl,
  });
}

function successResponse(
  messageId: string,
  recipient: Recipient,
  extraData: Record<string, unknown> = {},
): Response {
  return json({
    code: 200,
    message: "success",
    timestamp: Date.now(),
    data: {
      messageId,
      status: "ws_written",
      to: recipient.id,
      recipientSource: recipient.source,
      ...extraData,
    },
  });
}
