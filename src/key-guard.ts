export type KeyState = "required" | "open" | "unavailable";

const REQUIRED_SECONDS = 15;

function probeKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `probe-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export class KeyGuard {
  private requiredSince: number | null = null;

  constructor(private readonly nowSeconds: () => number) {}

  async state(origin: string, forward: (request: Request) => Promise<Response>): Promise<KeyState> {
    const now = this.nowSeconds();
    if (this.requiredSince !== null && now - this.requiredSince < REQUIRED_SECONDS) return "required";
    this.requiredSince = null;
    const probe = new Request(new URL("/v1/models", origin), { headers: { authorization: `Bearer ${probeKey()}` } });
    const response = await forward(probe).catch(() => null);
    await response?.body?.cancel();
    if (response === null) return "unavailable";
    if (response.status === 401 || response.status === 403) {
      this.requiredSince = now;
      return "required";
    }
    return response.ok ? "open" : "unavailable";
  }

  forget(): void {
    this.requiredSince = null;
  }
}
