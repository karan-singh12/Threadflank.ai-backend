import { Controller, Delete, Get, Param, Post, Query, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandAiStudioService } from './brand-ai-studio.service';
import { GenerateContentDto, SaveContentDto, SimulateVideoDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — AI Video Studio (Veo-2 Motion)')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/ai-studio')
export class BrandAiStudioController {
  constructor(private readonly aiStudioService: BrandAiStudioService) {}

  @Get('presets')
  @ApiOperation({ summary: 'List curated motion camera and lighting presets' })
  getPresets() {
    return { message: 'Motion presets retrieved', data: this.aiStudioService.getPresets() };
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a cinematic motion video simulation (charges credits)' })
  async simulate(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: SimulateVideoDto) {
    return { message: 'Simulation generated successfully', data: await this.aiStudioService.simulateVideo(brand.brandId, dto) };
  }

  @Post('content')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Write product descriptions, captions, announcements, emails or SEO copy (charges credits on success)' })
  async content(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: GenerateContentDto) {
    return { message: 'Content generated', data: await this.aiStudioService.generateContent(brand.brandId, dto) };
  }

  @Get("library")
  @ApiOperation({ summary: "Copy the brand saved from the writer, newest first" })
  async library(@CurrentBrand() brand: AuthenticatedBrand, @Query("type") type?: string) {
    return { message: "Library fetched", data: await this.aiStudioService.listLibrary(brand.brandId, type) };
  }

  @Post("library")
  @ApiOperation({ summary: "Save a piece of written copy to the library" })
  async save(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: SaveContentDto) {
    return { message: "Saved to library", data: await this.aiStudioService.saveToLibrary(brand.brandId, dto) };
  }

  @Delete("library/:id")
  @ApiOperation({ summary: "Remove saved copy" })
  async removeSaved(@CurrentBrand() brand: AuthenticatedBrand, @Param("id") id: string) {
    return { message: "Removed from library", data: await this.aiStudioService.removeFromLibrary(brand.brandId, id) };
  }
}
