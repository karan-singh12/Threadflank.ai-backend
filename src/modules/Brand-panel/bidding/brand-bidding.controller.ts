import { Controller, Get, Post, Param, Body, ParseIntPipe, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandBiddingService } from './brand-bidding.service';
import { PlaceBidDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — Runway Spotlight Bidding')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/bidding')
export class BrandBiddingController {
  constructor(private readonly biddingService: BrandBiddingService) {}

  @Get('slots')
  @ApiOperation({ summary: "Slots of the open auction with this brand's standing (empty when none is open)" })
  async findAll(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Runway placement slots fetched', data: await this.biddingService.findAll(brand.brandId) };
  }

  @Post('slots/:rank/bid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Place a bid on a Runway slot (approved brands only)' })
  async placeBid(@CurrentBrand() brand: AuthenticatedBrand, @Param('rank', ParseIntPipe) rank: number, @Body() dto: PlaceBidDto) {
    const result = await this.biddingService.placeBid(brand.brandId, rank, dto);
    return { message: result.message, data: result.slot };
  }

  @Get('wins')
  @ApiOperation({ summary: 'Slots this brand has won' })
  async wins(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Wins fetched', data: await this.biddingService.wins(brand.brandId) };
  }
}
