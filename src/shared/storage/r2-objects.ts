import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Reading files back out of our R2 bucket.
 *
 * Upload URLs point at the bucket's S3 API endpoint (`<account>.r2.cloudflarestorage.com`)
 * whenever R2_PUBLIC_DOMAIN is that endpoint or unset. That endpoint only answers signed
 * requests, so neither browsers nor plain `fetch` can open those URLs. These helpers read
 * such files with the bucket credentials instead (and MediaController serves them publicly).
 */

/** `<account>.r2.cloudflarestorage.com` (bucket in the path) or `<bucket>.<account>.r2.cloudflarestorage.com`. */
const R2_API_HOST = /^(?:([a-z0-9][a-z0-9-]*)\.)?[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i;

/** The object key inside our bucket for a private R2 endpoint URL, or null for any other URL. */
export function privateR2Key(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const host = R2_API_HOST.exec(parsed.hostname);
    if (!host) return null;
    const segments = decodeURIComponent(parsed.pathname).replace(/^\/+/, '').split('/');
    // With the bucket in the hostname the whole path is the key; otherwise the first segment is the bucket.
    const key = (host[1] ? segments : segments.slice(1)).join('/');
    return key || null;
}

let client: S3Client | null = null;

function r2Client(): S3Client | null {
    if (client) return client;
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    if (!accountId || !accessKeyId || !secretAccessKey) return null;
    client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });
    return client;
}

export type StoredFile = { body: Buffer; contentType: string };

/** Reads one object from the bucket; null if R2 isn't configured or the key doesn't exist. */
export async function readR2Object(key: string): Promise<StoredFile | null> {
    const s3 = r2Client();
    if (!s3) return null;
    try {
        const out = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME?.trim() || 'outfit-checker', Key: key }));
        if (!out.Body) return null;
        return { body: Buffer.from(await out.Body.transformToByteArray()), contentType: out.ContentType || 'application/octet-stream' };
    } catch (err: any) {
        if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
        throw err;
    }
}

/** Downloads a file by URL, reading our private R2 URLs with the bucket credentials. */
export async function downloadStored(url: string, init?: RequestInit): Promise<StoredFile> {
    const key = privateR2Key(url);
    if (key) {
        const file = await readR2Object(key);
        if (!file) throw new Error(`Stored file not found: ${key}`);
        return file;
    }
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`Could not download ${url} (HTTP ${res.status})`);
    return {
        body: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg',
    };
}
