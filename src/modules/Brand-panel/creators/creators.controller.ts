import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { OptionalAuthGuard } from '../../../common/guards/optional-auth.guard';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { COLLAB_KINDS, CreatorsService, type CollabKind } from './creators.service';

export class CollabRequestDto {
  @IsString() @MaxLength(40) creatorId!: string;
  @IsIn(COLLAB_KINDS as unknown as string[]) kind!: CollabKind;
  @IsString() @MaxLength(1000) brief!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) productIds?: string[];
  @IsOptional() @IsString() @MaxLength(40) dropId?: string;
  @IsOptional() @IsInt() @Min(0) fee?: number;
}

export class CollabRespondDto {
  @IsBoolean() accept!: boolean;
}

export class CollabDeliverDto {
  @IsOptional() @IsString() @MaxLength(500) url?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) lookIds?: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('Brand Panel — Creators')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/creators')
export class BrandCreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get()
  @ApiOperation({ summary: 'Verified stylists to collab with, by niche, city and engagement' })
  async discover(@CurrentBrand() b: AuthenticatedBrand, @Query('q') q?: string, @Query('niche') niche?: string, @Query('city') city?: string) {
    return { message: 'Creators fetched', data: await this.creators.discover(b.brandId, { q, niche, city }) };
  }

  @Get('collabs')
  async collabs(@CurrentBrand() b: AuthenticatedBrand) {
    return { message: 'Collabs fetched', data: await this.creators.listForBrand(b.brandId) };
  }

  @Post('collabs')
  @ApiOperation({ summary: 'Ask a creator for a styled look, an unboxing or a launch post (Pro plan)' })
  async request(@CurrentBrand() b: AuthenticatedBrand, @Body() dto: CollabRequestDto) {
    return { message: 'Request sent', data: await this.creators.request(b.brandId, dto) };
  }

  @Delete('collabs/:id')
  async cancel(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Collab called off', data: await this.creators.cancel(b.brandId, id) };
  }
}

/** The creator's side, in the shopper app. */
@ApiTags('Creator collabs')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('creator')
export class CreatorCollabsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get('status')
  async status(@Req() req: any) {
    return { message: 'Status fetched', data: await this.creators.creatorStatus(req.user.userId) };
  }

  @Get('collabs')
  async mine(@Req() req: any) {
    return { message: 'Collabs fetched', data: await this.creators.mine(req.user.userId) };
  }

  @Post('collabs/:id/respond')
  @HttpCode(HttpStatus.OK)
  async respond(@Req() req: any, @Param('id') id: string, @Body() dto: CollabRespondDto) {
    if (dto.accept) await this.creators.assertCreator(req.user.userId);
    return { message: dto.accept ? 'Collab accepted' : 'Collab declined', data: await this.creators.respond(req.user.userId, id, dto.accept) };
  }

  @Post('collabs/:id/deliver')
  @HttpCode(HttpStatus.OK)
  async deliver(@Req() req: any, @Param('id') id: string, @Body() dto: CollabDeliverDto) {
    await this.creators.assertCreator(req.user.userId);
    return { message: 'Marked done', data: await this.creators.deliver(req.user.userId, id, dto) };
  }
}

@ApiTags('Creator links')
@Controller('creators/links')
export class CreatorLinksController {
  constructor(private readonly creators: CreatorsService) {}

  /** POST because it counts a visit. */
  @Post(':code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resolve(@Param('code') code: string, @Req() req: any) {
    return { message: 'Link resolved', data: await this.creators.resolve(code, req.user?.userId) };
  }
}
