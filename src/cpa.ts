import { Container } from "@cloudflare/containers";
import type { Env } from "./env.ts";

export class Cpa extends Container<Env> {
  override defaultPort = 8317;
  override sleepAfter = "30m";

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: Env) {
    super(ctx, env);
    this.envVars = {
      OBJECTSTORE_ENDPOINT: env.R2_ENDPOINT,
      OBJECTSTORE_BUCKET: env.R2_BUCKET,
      OBJECTSTORE_ACCESS_KEY: env.R2_ACCESS_KEY_ID,
      OBJECTSTORE_SECRET_KEY: env.R2_SECRET_ACCESS_KEY,
      CPA_MANAGEMENT_KEY: env.MANAGEMENT_KEY,
      CPA_CLIENT_KEY: env.CLIENT_API_KEY,
    };
  }
}
