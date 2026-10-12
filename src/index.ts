import { getContainer } from "@cloudflare/containers";
import { CONFIG_OBJECT_KEY, parseClientKeys } from "./client-keys.ts";
import type { Env } from "./env.ts";
import { handle } from "./gateway.ts";

export { ContainerProxy } from "@cloudflare/containers";
export { Cpa } from "./cpa.ts";

export default {
  fetch(request, env) {
    const cpa = getContainer(env.CPA);
    return handle(
      request,
      {
        dashboardPassword: env.DASHBOARD_PASSWORD,
        nowSeconds: () => Math.floor(Date.now() / 1000),
        clientKeys: async () => {
          const config = await env.STATE.get(CONFIG_OBJECT_KEY);
          return config === null ? [] : parseClientKeys(await config.text());
        },
      },
      (forwarded) => cpa.fetch(forwarded),
    );
  },
} satisfies ExportedHandler<Env>;
