import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { IStorageProvider, StorageUploadOptions, StorageUploadResult } from './storage.interface';

/**
 * Cloudflare R2 Storage Provider.
 *
 * Cloudflare R2 is an S3-compatible, zero-egress fee object storage.
 *
 * Required environment variables:
 *   - R2_ACCOUNT_ID: Cloudflare Account ID
 *   - R2_ACCESS_KEY_ID: R2 API Access Key ID
 *   - R2_SECRET_ACCESS_KEY: R2 API Secret Access Key
 *   - R2_BUCKET_NAME: Target bucket name (e.g. "outfit-checker")
 *   - R2_PUBLIC_DOMAIN: Public custom domain or r2.dev domain (e.g. "https://pub-xxxx.r2.dev" or "https://assets.yourdomain.com")
 */
@Injectable()
export class R2StorageProvider implements IStorageProvider, OnModuleInit {
    private readonly logger = new Logger(R2StorageProvider.name);
    private s3Client: S3Client;

    private get accountId(): string {
        return process.env.R2_ACCOUNT_ID?.trim() ?? '';
    }

    private get accessKeyId(): string {
        return process.env.R2_ACCESS_KEY_ID?.trim() ?? '';
    }

    private get secretAccessKey(): string {
        return process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '';
    }

    private get bucketName(): string {
        return process.env.R2_BUCKET_NAME?.trim() || 'outfit-checker';
    }

    private get publicDomain(): string {
        const domain = process.env.R2_PUBLIC_DOMAIN?.trim() || '';
        return domain.replace(/\/+$/, '');
    }

    onModuleInit() {
        if (!this.accountId || !this.accessKeyId || !this.secretAccessKey) {
            this.logger.warn(
                'Cloudflare R2 is enabled in StorageModule but R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY is missing.',
            );
            return;
        }

        const endpoint = `https://${this.accountId}.r2.cloudflarestorage.com`;
        this.s3Client = new S3Client({
            region: 'auto',
            endpoint,
            credentials: {
                accessKeyId: this.accessKeyId,
                secretAccessKey: this.secretAccessKey,
            },
        });

        this.logger.log(`Cloudflare R2 Storage initialized for bucket: ${this.bucketName} (endpoint: ${endpoint})`);
    }

    async save(options: StorageUploadOptions): Promise<StorageUploadResult> {
        if (!this.s3Client) {
            this.onModuleInit();
            if (!this.s3Client) {
                throw new Error('Cloudflare R2 storage client is not configured.');
            }
        }

        const safeFilename = path.basename(options.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${options.folder}/${Date.now()}-${safeFilename}`;

        try {
            await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: this.bucketName,
                    Key: key,
                    Body: options.buffer,
                    ContentType: options.mimetype,
                }),
            );

            // Construct the public URL
            const url = this.publicDomain
                ? `${this.publicDomain}/${key}`
                : `https://${this.bucketName}.${this.accountId}.r2.cloudflarestorage.com/${key}`;

            return {
                url,
                path: key,
                size: options.buffer.length,
            };
        } catch (error: any) {
            this.logger.error(`Failed to upload to Cloudflare R2 (${key}): ${error?.message || error}`);
            throw error;
        }
    }

    async delete(storagePath: string): Promise<void> {
        if (!this.s3Client) return;

        try {
            await this.s3Client.send(
                new DeleteObjectCommand({
                    Bucket: this.bucketName,
                    Key: storagePath,
                }),
            );
        } catch (error: any) {
            this.logger.warn(`Failed to delete from Cloudflare R2 (${storagePath}): ${error?.message || error}`);
        }
    }
}
