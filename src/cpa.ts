import { Container } from "@cloudflare/containers";
import type { Env } from "./env.ts";
import { handleS3 } from "./s3.ts";

export const STATE_HOST = "r2.internal";
export const STATE_BUCKET = "state";

export class Cpa extends Container<Env> {
  override defaultPort = 8317;
  override sleepAfter = "30m";

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = {
      OBJECTSTORE_ENDPOINT: `http://${STATE_HOST}`,
      OBJECTSTORE_BUCKET: STATE_BUCKET,
      OBJECTSTORE_ACCESS_KEY: "r2-binding",
      OBJECTSTORE_SECRET_KEY: "r2-binding",
      CPA_MANAGEMENT_KEY: env.MANAGEMENT_KEY,
      CPA_CLIENT_KEY: env.CLIENT_API_KEY,
    };
  }
}

Cpa.outboundByHost = {
  [STATE_HOST]: (request, env) => handleS3(request, (env as Env).STATE, STATE_BUCKET),
};
