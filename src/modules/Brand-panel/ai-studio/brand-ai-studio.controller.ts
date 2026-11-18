import { Controller, Delete, Get, Param, Post, Query, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandAiStudioService } from './brand-ai-studio.service';
import { BrandVideoService } from './brand-video.service';
import { BrandReelService } from './brand-reel.service';
import { CreateBrandReelDto, CreateBrandVideoDto, GenerateContentDto, SaveContentDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — AI Studio (copy and motion video)')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/ai-studio')
export class BrandAiStudioController {
  constructor(
    private readonly aiStudioService: BrandAiStudioService,
    private readonly videos: BrandVideoService,
    private readonly reels: BrandReelService,
  ) {}

  // ── Motion video ────────────────────────────────────────────────────────

  @Get('presets')
  @ApiOperation({ summary: 'Motion looks a video can use (camera, light and movement)' })
  getPresets() {
    return { message: 'Motion presets retrieved', data: this.videos.presets() };
  }

  @Get('video/status')
  @ApiOperation({ summary: 'Whether video rendering is connected, the engine, shapes and the credit cost' })
  async videoStatus() {
    return { message: 'Video status', data: await this.videos.status() };
  }

  @Post('videos')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a motion video from a garment or uploaded photo (takes credits; refunded if it fails)' })
  async createVideo(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CreateBrandVideoDto) {
    return { message: 'Video rendering started', data: await this.videos.create(brand.brandId, dto) };
  }

  @Get('videos')
  @ApiOperation({ summary: "The brand's motion videos, newest first (renders in progress are checked)" })
  async listVideos(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Videos fetched', data: await this.videos.list(brand.brandId) };
  }

  @Get('videos/:id')
  @ApiOperation({ summary: 'One motion video; checks on it while it is rendering' })
  async getVideo(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Video fetched', data: await this.videos.get(brand.brandId, id) };
  }

  @Delete('videos/:id')
  @ApiOperation({ summary: 'Delete a finished or failed motion video' })
  async removeVideo(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Video deleted', data: await this.videos.remove(brand.brandId, id) };
  }

  // ── Promo reels ─────────────────────────────────────────────────────────

  @Get('reel/styles')
  @ApiOperation({ summary: 'Reel styles: the motion looks, cards and pace each one uses' })
  getReelStyles() {
    return { message: 'Reel styles retrieved', data: this.reels.styles() };
  }

  @Get('reel/status')
  @ApiOperation({ summary: 'Whether reels can be made (engine plus stitching), the shot limits and the credit cost' })
  async reelStatus() {
    return { message: 'Reel status', data: await this.reels.status() };
  }

  @Post('reels')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a promo reel from 3-5 outfits (takes credits; refunded if it fails)' })
  async createReel(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CreateBrandReelDto) {
    return { message: 'Reel started', data: await this.reels.create(brand.brandId, dto) };
  }

  @Get('reels')
  @ApiOperation({ summary: "The brand's reels, newest first (reels in progress are checked and stitched)" })
  async listReels(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Reels fetched', data: await this.reels.list(brand.brandId) };
  }

  @Get('reels/:id')
  @ApiOperation({ summary: 'One reel; checks on its shots and stitches once they are all in' })
  async getReel(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Reel fetched', data: await this.reels.get(brand.brandId, id) };
  }

  @Delete('reels/:id')
  @ApiOperation({ summary: 'Delete a finished or failed reel' })
  async removeReel(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Reel deleted', data: await this.reels.remove(brand.brandId, id) };
  }

  // ── Written copy ────────────────────────────────────────────────────────

  @Post('content')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Write product descriptions, captions, announcements, emails or SEO copy (charges credits on success)' })
  async content(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: GenerateContentDto) {
    return { message: 'Content generated', data: await this.aiStudioService.generateContent(brand.brandId, dto) };
  }

  @Get('library')
  @ApiOperation({ summary: 'Copy the brand saved from the writer, newest first' })
  async library(@CurrentBrand() brand: AuthenticatedBrand, @Query('type') type?: string) {
    return { message: 'Library fetched', data: await this.aiStudioService.listLibrary(brand.brandId, type) };
  }

  @Post('library')
  @ApiOperation({ summary: 'Save a piece of written copy to the library' })
  async save(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: SaveContentDto) {
    return { message: 'Saved to library', data: await this.aiStudioService.saveToLibrary(brand.brandId, dto) };
  }

  @Delete('library/:id')
  @ApiOperation({ summary: 'Remove saved copy' })
  async removeSaved(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Removed from library', data: await this.aiStudioService.removeFromLibrary(brand.brandId, id) };
  }
}
