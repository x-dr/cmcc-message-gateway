import { Hono } from "hono";

import type { Bindings, HonoEnv } from "./env.js";
import { errorMessage, json, publicAuthorized } from "./http.js";

function getStub(env: Bindings): DurableObjectStub {
  const id = env.CMCC_GATEWAY.idFromName("default");
  return env.CMCC_GATEWAY.get(id);
}

export const app = new Hono<HonoEnv>();

app.use("*", async (context, next) => {
  const path = context.req.path;
  if (path === "/" || path === "/health") {
    await next();
    return;
  }

  if (!context.env.API_TOKEN) {
    return json(
      {
        ok: false,
        code: 500,
        message: "API_TOKEN Secret 未配置",
      },
      500,
    );
  }

  if (!publicAuthorized(context.req.raw, context.env)) {
    return json(
      {
        ok: false,
        code: 401,
        message: "Unauthorized",
      },
      401,
    );
  }

  await next();
});

async function health(env: Bindings): Promise<Response> {
  try {
    const response = await getStub(env).fetch(
      new Request("https://cmcc.internal/health"),
    );
    const detail = (await response.json()) as Record<string, unknown>;

    return json({
      ok: true,
      service: "cmcc-message-gateway",
      connected: Boolean(detail.connected),
      authenticated: Boolean(detail.authenticated),
      hasRecipient: Boolean(detail.hasRecipient),
      timestamp: Date.now(),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        service: "cmcc-message-gateway",
        connected: false,
        authenticated: false,
        hasRecipient: false,
        error: errorMessage(error),
        timestamp: Date.now(),
      },
      503,
    );
  }
}

app.get("/", (context) => health(context.env));
app.get("/health", (context) => health(context.env));

// 鉴权完成后，其余请求原样转发给唯一的 Durable Object。
app.all("*", (context) => getStub(context.env).fetch(context.req.raw));
