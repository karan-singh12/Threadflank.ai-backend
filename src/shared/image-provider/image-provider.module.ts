import { Module } from '@nestjs/common';
import { GeminiImageProvider } from './gemini.provider';
import { ImageProviderService } from './image-provider.service';
import { ReplicateImageProvider } from './replicate.provider';

@Module({
    providers: [
        ReplicateImageProvider,
        GeminiImageProvider,
        ImageProviderService,
    ],
    exports: [
        ImageProviderService,
        ReplicateImageProvider,
        GeminiImageProvider,
    ],
})
export class ImageProviderModule {}
