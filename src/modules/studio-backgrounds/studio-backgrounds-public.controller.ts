import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { StudioBackgroundsService } from './studio-backgrounds.service';

@ApiTags('Studio — Scene Backgrounds')
@Controller('studio/backgrounds')
export class StudioBackgroundsPublicController {
  constructor(private readonly service: StudioBackgroundsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active character scene backgrounds for Drape Studio' })
  async findAll() {
    const list = await this.service.findAllActive();
    return {
      message: 'Studio backgrounds fetched successfully',
      data: list,
    };
  }
}
