export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly uploaded: Date;
}

export interface StoredBody extends StoredObject {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ObjectStore {
  head(key: string): Promise<StoredObject | null>;
  get(key: string): Promise<StoredBody | null>;
  put(key: string, value: ArrayBuffer): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit: number }): Promise<{
    objects: StoredObject[];
    truncated: boolean;
    cursor?: string;
  }>;
}

const XML_HEADERS = { "content-type": "application/xml" };
const MAX_KEYS = 1000;

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function s3Error(status: number, code: string, message: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${escapeXml(message)}</Message></Error>`;
  return new Response(body, { status, headers: XML_HEADERS });
}

function objectHeaders(object: StoredObject): Record<string, string> {
  return {
    "content-length": String(object.size),
    "content-type": "application/octet-stream",
    etag: `"${object.etag}"`,
    "last-modified": object.uploaded.toUTCString(),
  };
}

export function decodeAwsChunked(body: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [];
  const decoder = new TextDecoder();
  let offset = 0;
  for (;;) {
    let lineEnd = offset;
    while (lineEnd + 1 < body.length && !(body[lineEnd] === 13 && body[lineEnd + 1] === 10)) lineEnd += 1;
    if (lineEnd + 1 >= body.length) return null;
    const header = decoder.decode(body.subarray(offset, lineEnd));
    const sizeText = header.split(";")[0] ?? "";
    if (!/^[0-9a-fA-F]+$/.test(sizeText)) return null;
    const size = Number.parseInt(sizeText, 16);
    const start = lineEnd + 2;
    if (size === 0) break;
    const end = start + size;
    if (end + 2 > body.length || body[end] !== 13 || body[end + 1] !== 10) return null;
    parts.push(body.subarray(start, end));
    offset = end + 2;
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    joined.set(part, position);
    position += part.length;
  }
  return joined;
}

async function readBody(request: Request): Promise<ArrayBuffer | null> {
  const raw = new Uint8Array(await request.arrayBuffer());
  const sha = request.headers.get("x-amz-content-sha256") ?? "";
  const encoding = request.headers.get("content-encoding") ?? "";
  if (!sha.startsWith("STREAMING-") && !encoding.includes("aws-chunked")) return raw.slice().buffer;
  const decoded = decodeAwsChunked(raw);
  if (decoded === null) return null;
  const expected = request.headers.get("x-amz-decoded-content-length");
  if (expected !== null && Number(expected) !== decoded.length) return null;
  return decoded.slice().buffer;
}

async function listObjects(store: ObjectStore, bucket: string, params: URLSearchParams): Promise<Response> {
  const prefix = params.get("prefix") ?? "";
  const token = params.get("continuation-token");
  const requested = Number(params.get("max-keys") ?? MAX_KEYS);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_KEYS) : MAX_KEYS;
  const page = await store.list({ prefix, limit, ...(token === null ? {} : { cursor: token }) });
  const contents = page.objects
    .map(
      (object) =>
        `<Contents><Key>${escapeXml(object.key)}</Key><LastModified>${object.uploaded.toISOString()}</LastModified>` +
        `<ETag>"${object.etag}"</ETag><Size>${object.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
    )
    .join("");
  const next = page.truncated && page.cursor !== undefined ? `<NextContinuationToken>${escapeXml(page.cursor)}</NextContinuationToken>` : "";
  const body =
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
    `<Name>${escapeXml(bucket)}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${page.objects.length}</KeyCount>` +
    `<MaxKeys>${limit}</MaxKeys><IsTruncated>${page.truncated && page.cursor !== undefined}</IsTruncated>${next}${contents}</ListBucketResult>`;
  return new Response(body, { headers: XML_HEADERS });
}

async function bucketRequest(request: Request, store: ObjectStore, bucket: string, params: URLSearchParams): Promise<Response> {
  if (request.method === "HEAD") return new Response(null, { status: 200 });
  if (request.method === "PUT") return new Response(null, { status: 200 });
  if (request.method !== "GET") return s3Error(405, "MethodNotAllowed", "Unsupported bucket operation");
  if (params.has("location")) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></LocationConstraint>`,
      { headers: XML_HEADERS },
    );
  }
  if (params.get("list-type") === "2") return listObjects(store, bucket, params);
  return s3Error(501, "NotImplemented", "Only ListObjectsV2 is supported");
}

async function objectRequest(request: Request, store: ObjectStore, key: string): Promise<Response> {
  switch (request.method) {
    case "HEAD": {
      const object = await store.head(key);
      return object === null ? new Response(null, { status: 404 }) : new Response(null, { headers: objectHeaders(object) });
    }
    case "GET": {
      const object = await store.get(key);
      if (object === null) return s3Error(404, "NoSuchKey", "The specified key does not exist.");
      return new Response(await object.arrayBuffer(), { headers: objectHeaders(object) });
    }
    case "PUT": {
      const body = await readBody(request);
      if (body === null) return s3Error(400, "IncompleteBody", "Malformed aws-chunked body");
      const stored = await store.put(key, body);
      const etag = typeof stored === "object" && stored !== null && "etag" in stored ? String(stored.etag) : "";
      return new Response(null, { status: 200, headers: etag === "" ? {} : { etag: `"${etag}"` } });
    }
    case "DELETE":
      await store.delete(key);
      return new Response(null, { status: 204 });
    default:
      return s3Error(405, "MethodNotAllowed", "Unsupported object operation");
  }
}

export async function handleS3(request: Request, store: ObjectStore, bucket: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(1);
  const slash = path.indexOf("/");
  const name = decodeURIComponent(slash === -1 ? path : path.slice(0, slash));
  const key = slash === -1 ? "" : decodeURIComponent(path.slice(slash + 1));
  if (name !== bucket) return s3Error(404, "NoSuchBucket", "The specified bucket does not exist.");
  if (key === "") return bucketRequest(request, store, bucket, url.searchParams);
  return objectRequest(request, store, key);
}
