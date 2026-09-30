import { DynamicModule, Module } from '@nestjs/common';
import { STORAGE_PROVIDER } from './storage.interface';
import { LocalStorageProvider } from './local-storage.provider';
import { R2StorageProvider } from './r2-storage.provider';
import { SupabaseStorageProvider } from './supabase-storage.provider';

/**
 * StorageModule — dynamically selects the active IStorageProvider at startup.
 *
 * Provider selection priority:
 *   1. Cloudflare R2: if R2_ACCOUNT_ID and R2_ACCESS_KEY_ID are set (Zero egress fees, S3 compatible).
 *   2. Supabase Storage: if SUPABASE_URL is set.
 *   3. LocalStorageProvider: fallback for local disk storage (public/).
 *
 * Both providers are exposed under the STORAGE_PROVIDER injection token so
 * consumers are decoupled from the concrete implementation.
 *
 * Usage in a feature module:
 *
 *   @Module({ imports: [StorageModule.register()] })
 *   export class DrapeModule {}
 *
 * Then inject in a service:
 *
 *   constructor(
 *     @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider
 *   ) {}
 */
@Module({})
export class StorageModule {
    static register(): DynamicModule {
        const useR2 = Boolean(process.env.R2_ACCOUNT_ID?.trim() && process.env.R2_ACCESS_KEY_ID?.trim());
        const useSupabase = !useR2 && Boolean(process.env.SUPABASE_URL?.trim());

        let providerClass: any = LocalStorageProvider;
        if (useR2) {
            providerClass = R2StorageProvider;
        } else if (useSupabase) {
            providerClass = SupabaseStorageProvider;
        }

        const storageProvider = {
            provide: STORAGE_PROVIDER,
            useClass: providerClass,
        };

        return {
            module: StorageModule,
            providers: [providerClass, storageProvider],
            exports: [STORAGE_PROVIDER],
        };
    }
}
