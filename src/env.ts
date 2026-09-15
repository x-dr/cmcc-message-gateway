import type { CmccGateway } from "./cmcc-gateway.js";

export interface Bindings {
  CMCC_GATEWAY: DurableObjectNamespace<CmccGateway>;
  CMCC_API_KEY?: string;
  API_TOKEN?: string;
  CMCC_SERVER_URL?: string;
  CMCC_UPLOAD_URL?: string;
  CMCC_VERSION?: string;
  DEFAULT_RECIPIENT?: string;
  INBOUND_WEBHOOK_URL?: string;
  INBOUND_WEBHOOK_TOKEN?: string;
}

export interface HonoEnv {
  Bindings: Bindings;
}
