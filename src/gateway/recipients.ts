import { INBOX_KEY, MAX_INBOX, RECIPIENT_KEY } from "../constants.js";
import type { CmccGateway } from "../cmcc-gateway.js";
import type { InboundMessage } from "../message-format.js";
import { trimText } from "../message-format.js";

export interface Recipient {
  id: string;
  source: "env" | "request" | "inbound";
  updatedAt: number | null;
  messageId?: unknown;
  lastContent?: string;
}

export function getFallbackRecipient(gateway: CmccGateway): Recipient | null {
  const id = String(gateway.bindings.DEFAULT_RECIPIENT || "").trim();
  if (!id) return null;

  return {
    id,
    source: "env",
    updatedAt: null,
  };
}

export async function resolveRecipient(
  gateway: CmccGateway,
  explicitTo: unknown = "",
): Promise<Recipient | null> {
  const direct = String(explicitTo || "").trim();

  if (direct) {
    if (/^(RECIPIENT|YOUR_RECIPIENT|TO)$/i.test(direct)) {
      throw new Error(`无效接收人占位符：${direct}`);
    }

    return {
      id: direct,
      source: "request",
      updatedAt: Date.now(),
    };
  }

  const stored = await gateway.state.storage.get<Recipient>(RECIPIENT_KEY);
  if (stored?.id) return stored;

  return getFallbackRecipient(gateway);
}

export async function requireRecipient(
  gateway: CmccGateway,
  explicitTo: unknown = "",
): Promise<Recipient> {
  const recipient = await resolveRecipient(gateway, explicitTo);

  if (!recipient?.id) {
    throw new Error(
      "尚无默认 RECIPIENT。请先让手机向该 5G 消息账号发送一条消息，或设置 DEFAULT_RECIPIENT。",
    );
  }

  return recipient;
}

export async function setAutoRecipient(
  gateway: CmccGateway,
  message: InboundMessage,
): Promise<void> {
  const sender = String(message.from || "").trim();
  if (!sender) return;

  await gateway.state.storage.put(RECIPIENT_KEY, {
    id: sender,
    source: "inbound",
    updatedAt: Date.now(),
    messageId: message.id || null,
    lastContent: trimText(message.content, 300),
  } satisfies Recipient);
}

export async function addInbox(
  gateway: CmccGateway,
  message: InboundMessage,
): Promise<void> {
  const inbox =
    (await gateway.state.storage.get<InboundMessage[]>(INBOX_KEY)) || [];
  inbox.unshift(message);

  if (inbox.length > MAX_INBOX) {
    inbox.length = MAX_INBOX;
  }

  await gateway.state.storage.put(INBOX_KEY, inbox);
}
