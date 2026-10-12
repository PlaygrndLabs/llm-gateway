import { describe, expect, it } from "vitest";
import { decodeAwsChunked, handleS3 } from "../src/s3.ts";
import { MemoryStore } from "./memory-store.ts";

const BUCKET = "state";

function s3(path: string, init: RequestInit = {}): Request {
  return new Request(`http://r2.internal${path}`, init);
}

function chunked(parts: string[]): string {
  const signature = "chunk-signature=" + "0".repeat(64);
  return parts.map((part) => `${new TextEncoder().encode(part).length.toString(16)};${signature}\r\n${part}\r\n`).join("") + `0;${signature}\r\n\r\n`;
}

function streamingPut(path: string, parts: string[]): Request {
  const decoded = parts.join("");
  return s3(path, {
    method: "PUT",
    headers: {
      "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD",
      "content-encoding": "aws-chunked",
      "x-amz-decoded-content-length": String(new TextEncoder().encode(decoded).length),
    },
    body: chunked(parts),
  });
}

describe("decodeAwsChunked", () => {
  it("joins the chunks and drops the signatures", () => {
    const body = new TextEncoder().encode(chunked(["hello ", "world"]));
    expect(new TextDecoder().decode(decodeAwsChunked(body) ?? new Uint8Array())).toBe("hello world");
  });

  it("rejects a body that ends before its final chunk", () => {
    const body = new TextEncoder().encode("5;chunk-signature=abc\r\nhel");
    expect(decodeAwsChunked(body)).toBeNull();
  });
});

describe("handleS3", () => {
  it("answers the bucket checks minio-go makes on boot", async () => {
    const store = new MemoryStore();
    expect((await handleS3(s3("/state/", { method: "HEAD" }), store, BUCKET)).status).toBe(200);
    const location = await handleS3(s3("/state/?location="), store, BUCKET);
    expect(location.status).toBe(200);
    expect(await location.text()).toContain("<LocationConstraint");
  });

  it("stores a streamed upload, reads it back and reports it missing after delete", async () => {
    const store = new MemoryStore();
    const key = "/state/config/config.yaml";
    expect((await handleS3(s3(key, { method: "HEAD" }), store, BUCKET)).status).toBe(404);
    expect((await handleS3(streamingPut(key, ["config-version: 8\n", "server:\n  port: 8317\n"]), store, BUCKET)).status).toBe(200);
    expect(store.text("config/config.yaml")).toBe("config-version: 8\nserver:\n  port: 8317\n");
    const head = await handleS3(s3(key, { method: "HEAD" }), store, BUCKET);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("39");
    expect(head.headers.get("etag")).toMatch(/^".+"$/);
    const get = await handleS3(s3(key), store, BUCKET);
    expect(await get.text()).toBe("config-version: 8\nserver:\n  port: 8317\n");
    expect((await handleS3(s3(key, { method: "DELETE" }), store, BUCKET)).status).toBe(204);
    const missing = await handleS3(s3(key), store, BUCKET);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("<Code>NoSuchKey</Code>");
  });

  it("stores a plain upload as is", async () => {
    const store = new MemoryStore();
    const put = await handleS3(s3("/state/auths/a.json", { method: "PUT", headers: { "x-amz-content-sha256": "UNSIGNED-PAYLOAD" }, body: "{}" }), store, BUCKET);
    expect(put.status).toBe(200);
    expect(store.text("auths/a.json")).toBe("{}");
  });

  it("refuses a streamed upload whose length does not match", async () => {
    const store = new MemoryStore();
    const request = streamingPut("/state/auths/a.json", ["abc"]);
    request.headers.set("x-amz-decoded-content-length", "99");
    expect((await handleS3(request, store, BUCKET)).status).toBe(400);
    expect(store.entries.size).toBe(0);
  });

  it("lists by prefix with continuation", async () => {
    const store = new MemoryStore();
    for (const name of ["auths/a.json", "auths/b & c.json", "auths/d.json", "config/config.yaml"]) {
      await store.put(name, new TextEncoder().encode(name).slice().buffer);
    }
    const first = await (await handleS3(s3("/state/?list-type=2&prefix=auths%2F&max-keys=2&encoding-type=url"), store, BUCKET)).text();
    expect(first).toContain("<Key>auths/a.json</Key>");
    expect(first).toContain("<Key>auths/b &amp; c.json</Key>");
    expect(first).toContain("<IsTruncated>true</IsTruncated>");
    expect(first).not.toContain("<EncodingType>");
    const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(first)?.[1] ?? "";
    const second = await (await handleS3(s3(`/state/?list-type=2&prefix=auths%2F&max-keys=2&continuation-token=${token}`), store, BUCKET)).text();
    expect(second).toContain("<Key>auths/d.json</Key>");
    expect(second).toContain("<IsTruncated>false</IsTruncated>");
    expect(second).not.toContain("config.yaml");
  });

  it("decodes encoded object keys", async () => {
    const store = new MemoryStore();
    await handleS3(s3("/state/auths/claude-me%40example.com.json", { method: "PUT", body: "x" }), store, BUCKET);
    expect(store.text("auths/claude-me@example.com.json")).toBe("x");
  });

  it("only serves its own bucket", async () => {
    const store = new MemoryStore();
    const response = await handleS3(s3("/other/key"), store, BUCKET);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("NoSuchBucket");
  });
});
