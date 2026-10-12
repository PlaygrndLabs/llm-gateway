import { createServer } from "node:http";
import { handleS3 } from "../src/s3.ts";
import { MemoryStore } from "./memory-store.ts";

const store = new MemoryStore();
const port = Number(process.env.PORT ?? "9000");

createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const method = incoming.method ?? "GET";
  if (incoming.url === "/__keys") {
    outgoing.writeHead(200, { "content-type": "application/json" });
    outgoing.end(JSON.stringify([...store.entries.keys()].sort()));
    return;
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
    method,
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
  const response = await handleS3(request, store, "state");
  console.log(method, incoming.url, response.status);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`s3 test server on ${port}`));
