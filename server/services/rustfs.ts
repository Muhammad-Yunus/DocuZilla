import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const LOCAL_VAULT_ROOT = path.resolve(process.cwd(), '.rustfs-vault');
const LEGACY_SEAL_MAGIC = Buffer.from('DZSEAL1\0', 'ascii');

function unsealLegacyBufferIfNeeded(buf: Buffer): Buffer {
  if (buf.length < 36 || !buf.subarray(0, 8).equals(LEGACY_SEAL_MAGIC)) {
    return buf;
  }
  const secret = process.env.RUSTFS_SECRET_KEY?.trim() || process.env.SESSION_SECRET?.trim();
  if (!secret) return buf;
  const key = crypto.createHash('sha256').update('docuzilla-seal-v1:').update(secret).digest();
  const iv = buf.subarray(8, 20);
  const tag = buf.subarray(20, 36);
  const ciphertext = buf.subarray(36);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface RustFSUploadResult {
  bucket: string;
  key: string;
  sha256: string;
  sizeBytes: number;
  storageMode: 'rustfs-s3' | 'rustfs-local-vault';
}

function getBucket(): string {
  return process.env.RUSTFS_BUCKET?.trim() || 'docuzilla-dataroom';
}

function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

interface CapturedHttpMeta {
  statusCode?: number;
  server?: string;
  contentType?: string;
  cfRay?: string;
  amzRequestId?: string;
  bodySnippet?: string;
}

function extractReadableHttpError(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // S3 XML error (<Error><Code>...</Code><Message>...</Message></Error>)
  const xmlCode = trimmed.match(/<Code>([^<]+)<\/Code>/i)?.[1];
  const xmlMsg = trimmed.match(/<Message>([^<]+)<\/Message>/i)?.[1];
  if (xmlCode || xmlMsg) {
    return [xmlCode, xmlMsg].filter(Boolean).join(': ');
  }

  // HTML error page (e.g., Cloudflare 403 WAF / Bot block)
  if (/<!doctype|<html/i.test(trimmed)) {
    const title = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim();
    const h1 = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const h2 = trimmed.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const rayId = trimmed.match(/Ray ID:\s*<strong[^>]*>([^<]+)<\/strong>/i)?.[1]
      || trimmed.match(/Ray ID:\s*([a-f0-9]+)/i)?.[1];
    const parts = [title, h1, h2, rayId ? `Ray ID: ${rayId}` : ''].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' | ').slice(0, 320);
    }
    const stripped = trimmed
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped.slice(0, 320);
  }

  return trimmed.replace(/\s+/g, ' ').slice(0, 320);
}

function attachResponseCapture(client: S3Client, capture: CapturedHttpMeta): void {
  client.middlewareStack.add(
    (next) => async (args) => {
      const result = await next(args);
      const res = (
        result as {
          response?: {
            statusCode?: number;
            headers?: Record<string, string>;
            body?: AsyncIterable<Uint8Array>;
          };
        }
      ).response;
      if (res) {
        capture.statusCode = res.statusCode;
        capture.server = res.headers?.server;
        capture.contentType = res.headers?.['content-type'];
        capture.cfRay = res.headers?.['cf-ray'];
        capture.amzRequestId = res.headers?.['x-amz-request-id'] || res.headers?.['x-amz-id-2'];

        if (res.statusCode && res.statusCode >= 400 && res.body) {
          try {
            const chunks: Uint8Array[] = [];
            for await (const chunk of res.body) {
              chunks.push(chunk);
            }
            const buf = Buffer.concat(chunks);
            capture.bodySnippet = extractReadableHttpError(buf.toString('utf8'));
            // Re-wrap body stream so AWS SDK deserializer can still read it
            const { Readable } = await import('node:stream');
            res.body = Readable.from(buf);
          } catch {
            // ignore capture errors
          }
        }
      }
      return result;
    },
    { step: 'deserialize', name: 'captureHttpMeta', priority: 'high' },
  );
}

function getS3Client(capture?: CapturedHttpMeta): S3Client | null {
  const rawEndpoint = process.env.RUSTFS_ENDPOINT?.trim();
  const accessKeyId = process.env.RUSTFS_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.RUSTFS_SECRET_KEY?.trim();

  if (!rawEndpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const client = new S3Client({
    endpoint: normalizeEndpoint(rawEndpoint),
    region: process.env.RUSTFS_REGION?.trim() || 'us-east-1',
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  if (capture) {
    attachResponseCapture(client, capture);
  }
  return client;
}

function formatS3Error(context: string, err: unknown, capture?: CapturedHttpMeta): Error {
  const e = err as {
    name?: string;
    message?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
    cause?: { message?: string; code?: string };
  };
  const status = e?.$metadata?.httpStatusCode || capture?.statusCode;
  const code = e?.Code || e?.code || e?.cause?.code || e?.name || 'S3Error';
  const rawDetail = capture?.bodySnippet || e?.cause?.message || e?.message || 'Unexpected storage error';
  const detail = extractReadableHttpError(rawDetail) || rawDetail;
  const statusPart = status ? ` HTTP ${status}` : '';
  const isCloudflareBlock =
    status === 403 &&
    capture?.server?.toLowerCase() === 'cloudflare' &&
    !capture?.amzRequestId;
  const cfHint = isCloudflareBlock
    ? ' — Blocked by Cloudflare WAF/Proxy before reaching RustFS (add a Cloudflare WAF Skip rule for S3 PUT requests or set the S3 DNS record to DNS-only).'
    : '';
  const serverInfo = capture?.server
    ? ` [server=${capture.server}, ct=${capture.contentType || 'n/a'}, amz=${Boolean(capture.amzRequestId)}, ray=${capture.cfRay || 'n/a'}]`
    : '';
  return new Error(`RustFS ${context} failed (${code}${statusPart}): ${detail}${cfHint}${serverInfo}`);
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveConfinedPath(bucket: string, key: string): string {
  const safeBucket = sanitizeSegment(bucket);
  const safeKeyParts = key.split('/').map((seg) => sanitizeSegment(seg)).filter(Boolean);
  const resolved = path.resolve(LOCAL_VAULT_ROOT, safeBucket, ...safeKeyParts);
  if (!resolved.startsWith(LOCAL_VAULT_ROOT + path.sep)) {
    throw new Error('Invalid object storage key path');
  }
  return resolved;
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (headErr) {
    const status = (headErr as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) {
      await client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => {});
    }
  }
}

export class RustFSStorageService {
  static getStorageMode(): 'rustfs-s3' | 'rustfs-local-vault' {
    return getS3Client() ? 'rustfs-s3' : 'rustfs-local-vault';
  }

  static getBucketName(): string {
    return getBucket();
  }

  static async probeConnection(): Promise<{
    mode: 'rustfs-s3' | 'rustfs-local-vault';
    bucket: string;
    reachable: boolean;
    httpStatus?: number;
    listStatus?: number;
    listError?: string;
    server?: string;
    contentType?: string;
    hasAmzHeaders?: boolean;
    detail?: string;
  }> {
    const capture: CapturedHttpMeta = {};
    const s3 = getS3Client(capture);
    const bucket = getBucket();
    if (!s3) {
      return { mode: 'rustfs-local-vault', bucket, reachable: true };
    }

    let headStatus: number | undefined;
    try {
      const res = await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      headStatus = res.$metadata?.httpStatusCode;
    } catch (err) {
      const formatted = formatS3Error('HeadBucket', err, capture);
      return {
        mode: 'rustfs-s3',
        bucket,
        reachable: false,
        httpStatus: (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode,
        server: capture.server,
        contentType: capture.contentType,
        hasAmzHeaders: Boolean(capture.amzRequestId),
        detail: formatted.message,
      };
    }

    const listCapture: CapturedHttpMeta = {};
    const s3List = getS3Client(listCapture)!;
    let listStatus: number | undefined;
    try {
      const listRes = await s3List.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      listStatus = listRes.$metadata?.httpStatusCode;
    } catch (listErr) {
      const formattedList = formatS3Error('ListObjectsV2', listErr, listCapture);
      return {
        mode: 'rustfs-s3',
        bucket,
        reachable: false,
        httpStatus: headStatus,
        listStatus: (listErr as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode,
        listError: formattedList.message,
        server: listCapture.server || capture.server,
        contentType: listCapture.contentType || capture.contentType,
        hasAmzHeaders: Boolean(listCapture.amzRequestId || capture.amzRequestId),
      };
    }

    return {
      mode: 'rustfs-s3',
      bucket,
      reachable: true,
      httpStatus: headStatus,
      listStatus,
      server: listCapture.server || capture.server,
      contentType: listCapture.contentType || capture.contentType,
      hasAmzHeaders: Boolean(listCapture.amzRequestId || capture.amzRequestId),
    };
  }

  static async putObject(params: {
    projectId: number;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<RustFSUploadResult> {
    const sha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
    const safeName = sanitizeSegment(params.fileName);
    const uniquePrefix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const key = `projects/${params.projectId}/${uniquePrefix}-${safeName}`;
    const bucket = getBucket();
    const contentType = params.mimeType || 'application/octet-stream';

    const capture: CapturedHttpMeta = {};
    const s3 = getS3Client(capture);
    if (s3) {
      try {
        await ensureBucket(s3, bucket);
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: params.buffer,
            ContentLength: params.buffer.length,
            ContentType: contentType,
          }),
        );
        return {
          bucket,
          key,
          sha256,
          sizeBytes: params.buffer.length,
          storageMode: 'rustfs-s3',
        };
      } catch (err) {
        const status =
          (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ||
          capture.statusCode;

        // If Cloudflare WAF blocked the plaintext body with HTTP 403, transport as Content-Encoding: gzip
        // preserving the true ContentType (e.g., application/pdf) so RustFS stores raw valid PDF bytes.
        if (status === 403) {
          const gzBody = gzipSync(params.buffer);
          const gzCapture: CapturedHttpMeta = {};
          const s3Gz = getS3Client(gzCapture);
          if (s3Gz) {
            try {
              await s3Gz.send(
                new PutObjectCommand({
                  Bucket: bucket,
                  Key: key,
                  Body: gzBody,
                  ContentLength: gzBody.length,
                  ContentType: contentType,
                  ContentEncoding: 'gzip',
                }),
              );
              return {
                bucket,
                key,
                sha256,
                sizeBytes: params.buffer.length,
                storageMode: 'rustfs-s3',
              };
            } catch (gzErr) {
              const gzStatus =
                (gzErr as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ||
                gzCapture.statusCode;

              if (gzStatus === 403) {
                const signedUrl = await getSignedUrl(
                  s3Gz,
                  new PutObjectCommand({
                    Bucket: bucket,
                    Key: key,
                    ContentType: contentType,
                    ContentEncoding: 'gzip',
                  }),
                  { expiresIn: 120 },
                );
                const putRes = await fetch(signedUrl, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': contentType,
                    'Content-Encoding': 'gzip',
                    'User-Agent': 'DocuZilla-Storage/1.0',
                  },
                  body: new Uint8Array(gzBody),
                });
                if (putRes.ok) {
                  return {
                    bucket,
                    key,
                    sha256,
                    sizeBytes: params.buffer.length,
                    storageMode: 'rustfs-s3',
                  };
                }
                const rawErrText = await putRes.text().catch(() => '');
                const fallbackCapture: CapturedHttpMeta = {
                  statusCode: putRes.status,
                  server: putRes.headers.get('server') || undefined,
                  contentType: putRes.headers.get('content-type') || undefined,
                  cfRay: putRes.headers.get('cf-ray') || undefined,
                  amzRequestId: putRes.headers.get('x-amz-request-id') || undefined,
                  bodySnippet: extractReadableHttpError(rawErrText) || undefined,
                };
                const formattedFallback = formatS3Error(
                  'PutObject',
                  new Error(fallbackCapture.bodySnippet || `HTTP ${putRes.status}`),
                  fallbackCapture,
                );
                console.error('[RustFS PutObject Fallback Error]', formattedFallback.message);
                throw formattedFallback;
              }

              const formattedGz = formatS3Error('PutObject', gzErr, gzCapture);
              console.error('[RustFS PutObject Gzip Error]', formattedGz.message);
              throw formattedGz;
            }
          }
        }

        const formatted = formatS3Error('PutObject', err, capture);
        console.error('[RustFS PutObject Error]', formatted.message);
        throw formatted;
      }
    }

    const filePath = resolveConfinedPath(bucket, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.buffer);
    return {
      bucket,
      key,
      sha256,
      sizeBytes: params.buffer.length,
      storageMode: 'rustfs-local-vault',
    };
  }

  static async getObjectBuffer(bucket: string, key: string): Promise<Buffer | null> {
    const capture: CapturedHttpMeta = {};
    const s3 = getS3Client(capture);
    if (s3) {
      try {
        const res = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        if (!res.Body) return null;
        const chunks: Uint8Array[] = [];
        const stream = res.Body as AsyncIterable<Uint8Array>;
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        let buf: Buffer = Buffer.concat(chunks);
        if (res.ContentEncoding?.toLowerCase().includes('gzip') && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
          buf = gunzipSync(buf);
        }
        return unsealLegacyBufferIfNeeded(buf);
      } catch (err) {
        console.error('[RustFS GetObject Error]', formatS3Error('GetObject', err, capture).message);
        return null;
      }
    }

    try {
      const filePath = resolveConfinedPath(bucket, key);
      const buf = await fs.readFile(filePath);
      return unsealLegacyBufferIfNeeded(buf);
    } catch {
      return null;
    }
  }

  static async getPresignedUrl(bucket: string, key: string): Promise<string | null> {
    const s3 = getS3Client();
    if (!s3) return null;
    try {
      return await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 300 },
      );
    } catch {
      return null;
    }
  }

  static async deleteObject(bucket: string, key: string): Promise<void> {
    const s3 = getS3Client();
    if (s3) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
      return;
    }
    const filePath = resolveConfinedPath(bucket, key);
    await fs.unlink(filePath).catch(() => {});
  }
}
