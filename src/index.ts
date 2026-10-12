import { getContainer } from "@cloudflare/containers";
import type { Env } from "./env.ts";
import { handle } from "./gateway.ts";
import { KeyGuard } from "./key-guard.ts";

export { ContainerProxy } from "@cloudflare/containers";
export { Cpa } from "./cpa.ts";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const keyGuard = new KeyGuard(nowSeconds);

export default {
  fetch(request, env) {
    const cpa = getContainer(env.CPA);
    return handle(
      request,
      {
        dashboardPassword: env.DASHBOARD_PASSWORD,
        nowSeconds,
        keyGuard,
      },
      (forwarded) => cpa.fetch(forwarded),
    );
  },
} satisfies ExportedHandler<Env>;
