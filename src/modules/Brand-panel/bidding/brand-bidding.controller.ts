import { Controller, Get, Post, Param, Body, ParseIntPipe, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandBiddingService } from './brand-bidding.service';
import { PlaceBidDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — Runway Spotlight Bidding')
@Controller('brand/bidding')
export class BrandBiddingController {
  constructor(private readonly biddingService: BrandBiddingService) {}

  @Get('slots')
  @ApiOperation({ summary: 'List all open Runway Spotlight auction slots' })
  findAll() {
    const data = this.biddingService.findAll();
    return {
      message: 'Runway placement slots fetched',
      data,
    };
  }

  @Post('slots/:rank/bid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Place a competitive bid on a Runway slot' })
  placeBid(@Param('rank', ParseIntPipe) rank: number, @Body() dto: PlaceBidDto) {
    const data = this.biddingService.placeBid(rank, dto);
    return {
      message: data.message,
      data: data.slot,
    };
  }
}

