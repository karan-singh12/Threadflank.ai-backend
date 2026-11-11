import { Controller, Post, Body, Req, UseInterceptors, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { BrandAuthGuard } from '../auth/brand-auth.guard';
import { BrandUploadService } from './brand-upload.service';
import { MultipartInterceptor } from '../../../common/interceptors/multipart.interceptor';

@ApiTags('Brand Panel — Cloudflare R2 & Storage Uploads')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/upload')
export class BrandUploadController {
  constructor(private readonly uploadService: BrandUploadService) {}

  @Post('base64')
  @ApiOperation({ summary: 'Upload garment or banner image as Base64 to Cloudflare R2' })
  @ApiBody({ schema: { type: 'object', properties: { base64: { type: 'string' }, filename: { type: 'string' } } } })
  async uploadBase64(@Body() body: { base64: string; filename?: string }) {
    if (!body.base64) {
      throw new BadRequestException('base64 field is required.');
    }
    const result = await this.uploadService.uploadBase64(body.base64, body.filename);
    return {
      message: 'Image uploaded successfully to Cloudflare R2 storage',
      data: result,
    };
  }

  @Post('file')
  @UseInterceptors(MultipartInterceptor)
  @ApiOperation({ summary: 'Upload multipart garment asset' })
  async uploadMultipart(@Req() req: any) {
    if (!req.file) {
      throw new BadRequestException('No file uploaded');
    }
    return {
      message: 'File uploaded successfully',
      data: {
        url: req.file.url,
        path: req.file.path,
        filename: req.file.filename,
      },
    };
  }
}

