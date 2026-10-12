import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env.ts";
import { handle } from "./gateway.ts";

export { Cpa } from "./cpa.ts";

export default {
  fetch(request, env) {
    const cpa = getContainer(env.CPA);
    return handle(
      request,
      { dashboardPassword: env.DASHBOARD_PASSWORD, nowSeconds: () => Math.floor(Date.now() / 1000) },
      (forwarded) => cpa.fetch(forwarded),
    );
  },
} satisfies ExportedHandler<Env>;
