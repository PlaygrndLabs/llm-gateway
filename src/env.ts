import type { Cpa } from "./cpa.ts";

export interface Env {
  readonly CPA: DurableObjectNamespace<Cpa>;
  readonly R2_ENDPOINT: string;
  readonly R2_BUCKET: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
  readonly MANAGEMENT_KEY: string;
  readonly CLIENT_API_KEY: string;
  readonly DASHBOARD_PASSWORD: string;
}
