/**
 * IStorageProvider — common interface for all storage backends.
 *
 * LocalStorageProvider (existing) and SupabaseStorageProvider (new) both
 * implement this interface. Consumers inject via the STORAGE_PROVIDER token
 * so they are decoupled from the concrete backend.
 */

export interface StorageUploadOptions {
    /** Raw file bytes. */
    buffer: Buffer;
    /** Original filename used to derive the extension. */
    filename: string;
    /**
     * Sub-path or bucket name, e.g. 'twins', 'drape-results', 'garment-images'.
     * LocalStorageProvider treats this as a sub-directory under public/.
     * SupabaseStorageProvider treats this as the bucket name.
     */
    folder: string;
    /** MIME type of the file, e.g. 'image/png'. */
    mimetype: string;
}

export interface StorageUploadResult {
    /** Public URL (Supabase) or absolute relative path (local), e.g. /public/twins/... */
    url: string;
    /** Internal storage path — used by delete(). */
    path: string;
    /** File size in bytes. */
    size: number;
}

export interface IStorageProvider {
    save(options: StorageUploadOptions): Promise<StorageUploadResult>;
    delete(path: string): Promise<void>;
}

/** NestJS injection token for the active IStorageProvider. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
