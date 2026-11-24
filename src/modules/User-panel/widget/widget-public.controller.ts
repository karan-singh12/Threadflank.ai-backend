import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../../Admin-panel/admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../../Admin-panel/admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { WidgetService, type WidgetSessionInput } from '../../Admin-panel/widget/widget.service';
import { WidgetTryOnService } from './widget-tryon.service';

@ApiTags('D2C try-on widget')
@Controller('widget')
export class WidgetPublicController {
  constructor(
    private readonly widget: WidgetService,
    private readonly tryOnService: WidgetTryOnService,
  ) {}

  @Get('config')
  async config(@Query('key') key: string, @Query('origin') origin?: string) {
    return { data: await this.widget.config(key, origin) };
  }

  /**
   * The widget's try-on: multipart with "selfie" (file), "garmentUrl", "garmentCategory" and "productUrl",
   * plus the x-widget-key and x-widget-origin headers. The selfie is read into memory and never stored.
   */
  @Post('tryon')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async tryon(@Req() req: any) {
    if (typeof req.isMultipart !== 'function' || !req.isMultipart()) throw new BadRequestException('Send the photo as multipart form data.');
    const fields: Record<string, string> = {};
    let selfie: Buffer | null = null;
    let selfieType = '';
    for await (const part of req.parts({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } })) {
      if (part.type === 'file') {
        if (part.fieldname === 'selfie') {
          selfie = await part.toBuffer();
          selfieType = part.mimetype;
        } else await part.toBuffer();
      } else fields[part.fieldname] = String(part.value ?? '').slice(0, 1000);
    }
    if (!selfie) throw new BadRequestException('Add a photo of yourself.');
    const data = await this.tryOnService.tryOn({
      key: String(req.headers['x-widget-key'] ?? ''),
      origin: req.headers['x-widget-origin'] ? String(req.headers['x-widget-origin']) : undefined,
      selfie,
      selfieType,
      garmentUrl: fields.garmentUrl ?? '',
      category: fields.garmentCategory,
      productUrl: fields.productUrl || undefined,
    });
    return { data };
  }

  @Post('session')
  async session(@Body() body: WidgetSessionInput) {
    return { data: await this.widget.recordSession(body) };
  }
}
