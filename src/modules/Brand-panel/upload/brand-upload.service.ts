import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { IStorageProvider, STORAGE_PROVIDER } from '../../../shared/storage/storage.interface';
import { randomUUID } from 'crypto';

@Injectable()
export class BrandUploadService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider) {}

  async uploadBase64(base64Data: string, filename: string = 'brand-asset.jpg', folder: string = 'brand-assets') {
    // Check if data URL format e.g. data:image/png;base64,....
    const matches = base64Data.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
    let buffer: Buffer;
    let mimetype = 'image/jpeg';

    if (matches && matches.length === 3) {
      mimetype = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(base64Data, 'base64');
    }

    if (buffer.length === 0) {
      throw new BadRequestException('Invalid image data provided.');
    }

    const ext = mimetype.split('/')[1] || 'jpg';
    const cleanFilename = `${randomUUID()}.${ext}`;

    const result = await this.storage.save({
      buffer,
      filename: cleanFilename,
      folder,
      mimetype,
    });

    return result;
  }
}

