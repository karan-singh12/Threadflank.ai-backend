import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';
import { IStorageProvider, StorageUploadOptions, StorageUploadResult } from './storage.interface';

/**
 * Supabase Storage provider.
 *
 * Each `folder` value in StorageUploadOptions maps directly to a Supabase
 * Storage bucket. The bucket names are read from env vars with sensible
 * defaults:
 *
 *   folder            env var                              default
 *   ──────────────── ─────────────────────────────────── ───────────────
 *   drape-results    SUPABASE_STORAGE_BUCKET_DRAPE        drape-results
 *   twin-images      SUPABASE_STORAGE_BUCKET_TWINS        twin-images
 *   model-images     SUPABASE_STORAGE_BUCKET_MODELS       model-images
 *   garment-images   SUPABASE_STORAGE_BUCKET_GARMENTS     garment-images
 *
 * Any other folder name is used as-is as the bucket name.
 *
 * Buckets must be created as public-read in the Supabase dashboard before use.
 * This provider only uploads; it does not auto-create buckets.
 */
@Injectable()
export class SupabaseStorageProvider implements IStorageProvider, OnModuleInit {
    private readonly logger = new Logger(SupabaseStorageProvider.name);
    private client: SupabaseClient;

    // Bucket name overrides from env
    private readonly bucketMap: Record<string, string> = {
        'drape-results': process.env.SUPABASE_STORAGE_BUCKET_DRAPE || 'drape-results',
        'twin-images': process.env.SUPABASE_STORAGE_BUCKET_TWINS || 'twin-images',
        'model-images': process.env.SUPABASE_STORAGE_BUCKET_MODELS || 'model-images',
        'garment-images': process.env.SUPABASE_STORAGE_BUCKET_GARMENTS || 'garment-images',
    };

    onModuleInit() {
        const url = process.env.SUPABASE_URL!;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        this.client = createClient(url, key, {
            auth: { persistSession: false },
        });
        this.logger.log('Supabase storage provider initialised');
    }

    /** Resolve folder name → bucket name using the env-override map. */
    private bucket(folder: string): string {
        return this.bucketMap[folder] ?? folder;
    }

    async save(options: StorageUploadOptions): Promise<StorageUploadResult> {
        const { buffer, filename, folder, mimetype } = options;
        const bucket = this.bucket(folder);
        const ext = path.extname(filename) || '.bin';
        const storagePath = `${Date.now()}-${path.basename(filename, ext)}${ext}`;

        const { error } = await this.client.storage
            .from(bucket)
            .upload(storagePath, buffer, {
                contentType: mimetype,
                upsert: false,
            });

        if (error) {
            this.logger.error(`Supabase upload failed [${bucket}/${storagePath}]: ${error.message}`);
            throw new Error(`Supabase storage error: ${error.message}`);
        }

        const { data: urlData } = this.client.storage
            .from(bucket)
            .getPublicUrl(storagePath);

        const publicUrl = urlData.publicUrl;

        this.logger.debug(`Uploaded to Supabase: ${bucket}/${storagePath}`);
        return {
            url: publicUrl,
            path: `${bucket}/${storagePath}`,
            size: buffer.length,
        };
    }

    async delete(storagePath: string): Promise<void> {
        // storagePath format: "<bucket>/<file>" as saved by save()
        const slashIndex = storagePath.indexOf('/');
        if (slashIndex === -1) {
            this.logger.warn(`Cannot delete — invalid path format: ${storagePath}`);
            return;
        }
        const bucket = storagePath.slice(0, slashIndex);
        const filePath = storagePath.slice(slashIndex + 1);

        const { error } = await this.client.storage.from(bucket).remove([filePath]);
        if (error) {
            this.logger.warn(`Supabase delete failed [${storagePath}]: ${error.message}`);
        }
    }
}
