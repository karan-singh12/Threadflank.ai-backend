import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandAiStudioService } from './brand-ai-studio.service';
import { SimulateVideoDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — AI Video Studio (Veo-2 Motion)')
@Controller('brand/ai-studio')
export class BrandAiStudioController {
  constructor(private readonly aiStudioService: BrandAiStudioService) {}

  @Get('presets')
  @ApiOperation({ summary: 'List curated Veo-2 motion camera and lighting presets' })
  getPresets() {
    const data = this.aiStudioService.getPresets();
    return {
      message: 'Motion presets retrieved',
      data,
    };
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run high-fidelity Veo-2 cinematic motion video simulation' })
  async simulate(@Body() dto: SimulateVideoDto) {
    const data = await this.aiStudioService.simulateVideo(dto);
    return {
      message: 'Simulation generated successfully',
      data,
    };
  }
}

