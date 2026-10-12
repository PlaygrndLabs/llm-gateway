import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env.ts";

export { ContainerProxy } from "@cloudflare/containers";
export { Cpa } from "./cpa.ts";

export default {
  fetch(request, env) {
    return getContainer(env.CPA).fetch(request);
  },
} satisfies ExportedHandler<Env>;
