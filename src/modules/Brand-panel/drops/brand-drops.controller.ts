import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandDropsService } from './brand-drops.service';
import { CreateDropDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — Capsule Drops & Launches')
@Controller('brand/drops')
export class BrandDropsController {
  constructor(private readonly dropsService: BrandDropsService) {}

  @Get()
  @ApiOperation({ summary: 'List all upcoming and live collection drops' })
  findAll() {
    const data = this.dropsService.findAll();
    return {
      message: 'Drops list fetched',
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create and schedule a new limited capsule drop' })
  create(@Body() dto: CreateDropDto) {
    const data = this.dropsService.create(dto);
    return {
      message: 'Drop created and waitlist activated',
      data,
    };
  }
}

