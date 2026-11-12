import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { WidgetDomainsDto } from '../dto/brand-common.dto';
import { BrandWidgetService } from './brand-widget.service';

@ApiTags('Brand Panel — Try-on widget')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/widget')
export class BrandWidgetController {
  constructor(private readonly widget: BrandWidgetService) {}

  @Get()
  @ApiOperation({ summary: 'Widget key, allowed sites and 30-day usage' })
  async get(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Widget fetched', data: await this.widget.get(brand.brandId) };
  }

  @Put('domains')
  @ApiOperation({ summary: 'Set which storefronts may load the widget (empty = anywhere)' })
  async domains(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: WidgetDomainsDto) {
    return { message: 'Allowed sites saved', data: await this.widget.setDomains(brand.brandId, dto.domains) };
  }

  @Post('rotate-key')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a new widget key (the old one stops working immediately)' })
  async rotate(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'New key issued', data: await this.widget.rotateKey(brand.brandId) };
  }
}
