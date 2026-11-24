import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandAuthGuard, CurrentBrand } from '../../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../../auth/brand-jwt.strategy';
import { BrandModelService } from './brand-model.service';
import { CreateModelShotDto, PhotoToolDto } from './brand-model.dto';
import { PHOTO_TOOL_COST, PHOTO_TOOLS } from './photo-tools';

@ApiTags('Brand Panel — AI Studio (model shoot)')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/ai-studio/model')
export class BrandModelController {
  constructor(private readonly shoots: BrandModelService) {}

  @Get('presets')
  @ApiOperation({ summary: 'The models, poses, backdrops and framings a shoot can use' })
  presets() {
    return { message: 'Model presets retrieved', data: this.shoots.presets() };
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether model shoots can run right now, and what one costs' })
  status() {
    return { message: 'Model shoot status', data: this.shoots.status() };
  }

  @Post('shoots')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Put a garment on a model (takes credits; refunded if the render fails)' })
  async create(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CreateModelShotDto) {
    return { message: 'Model shot ready', data: await this.shoots.create(brand.brandId, dto) };
  }

  @Get('tools')
  @ApiOperation({ summary: 'The photo tools (background swap, ghost mannequin, ad creative) and what each costs' })
  tools() {
    return { message: 'Photo tools', data: { tools: PHOTO_TOOLS, cost: PHOTO_TOOL_COST, available: this.shoots.status().available } };
  }

  @Post('tools')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Run a photo tool on a garment photo (takes credits; refunded if the render fails)' })
  async tool(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: PhotoToolDto) {
    return { message: 'Photo ready', data: await this.shoots.edit(brand.brandId, dto) };
  }

  @Get('shoots')
  @ApiOperation({ summary: "The brand's model shots, newest first" })
  async list(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Model shots fetched', data: await this.shoots.list(brand.brandId) };
  }

  @Get('shoots/:id')
  @ApiOperation({ summary: 'One model shot' })
  async get(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Model shot fetched', data: await this.shoots.get(brand.brandId, id) };
  }

  @Delete('shoots/:id')
  @ApiOperation({ summary: 'Delete a model shot' })
  async remove(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Model shot deleted', data: await this.shoots.remove(brand.brandId, id) };
  }
}
