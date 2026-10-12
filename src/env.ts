import type { Cpa } from "./cpa.ts";

export interface Env {
  readonly CPA: DurableObjectNamespace<Cpa>;
  readonly STATE: R2Bucket;
  readonly MANAGEMENT_KEY: string;
  readonly CLIENT_API_KEY: string;
  readonly DASHBOARD_PASSWORD: string;
}
