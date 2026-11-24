import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { ContentLibraryService, LIBRARY_KINDS } from './library.service';

class LibraryQueryDto {
  @IsOptional() @IsIn(LIBRARY_KINDS) kind?: string;
  /** A folder name, or "__none" for items not in a folder. */
  @IsOptional() @IsString() @MaxLength(40) folder?: string;
  @IsOptional() @IsString() @MaxLength(24) tag?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

class LibraryMetaDto {
  /** null takes the item out of its folder. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40) folder?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(24, { each: true }) tags?: string[];
}

@ApiTags('Brand Panel — Content library')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
// Not /library: that path already serves the saved-copy list (brand-ai-studio.controller.ts).
@Controller('brand/ai-studio/assets')
export class ContentLibraryController {
  constructor(private readonly library: ContentLibraryService) {}

  @Get()
  @ApiOperation({ summary: 'Saved copy, model shots, videos and reels in one list, with folders and tags' })
  async list(@CurrentBrand() brand: AuthenticatedBrand, @Query() q: LibraryQueryDto) {
    return { message: 'Library fetched', data: await this.library.list(brand.brandId, q) };
  }

  @Patch(':kind/:id')
  @ApiOperation({ summary: 'Put an item in a folder and/or set its tags' })
  async setMeta(@CurrentBrand() brand: AuthenticatedBrand, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: LibraryMetaDto) {
    return { message: 'Library item updated', data: await this.library.setMeta(brand.brandId, kind, id, dto) };
  }
}
