import { Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuthGuard } from '../../../common/guards/optional-auth.guard';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { BrandShowcaseService } from './brand-showcase.service';

/** What shoppers see of a brand's own panel data: its catalog, its drops, and the runway spotlight. */
@ApiTags('Brands (App) — showcase')
@ApiBearerAuth()
@Controller('brands')
export class BrandShowcaseController {
  constructor(private readonly showcase: BrandShowcaseService) {}

  @Get('showcase')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Every approved brand with a catalog preview and upcoming drops (the Brands page)' })
  async all(@Req() req: any) {
    return { message: 'Showcase fetched', data: await this.showcase.all(req.user?.userId) };
  }

  @Get(':slug/catalog')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: "A brand's garments (approved brands only)" })
  async catalog(@Param('slug') slug: string) {
    return { message: 'Catalog fetched', data: await this.showcase.catalog(slug) };
  }

  @Get(':slug/drops')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: "A brand's upcoming and live drops, with whether the signed-in shopper has joined the waitlist" })
  async drops(@Param('slug') slug: string, @Req() req: any) {
    return { message: 'Drops fetched', data: await this.showcase.drops(slug, req.user?.userId) };
  }

  @Post('drops/:dropId/waitlist')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join the waitlist for a drop' })
  async join(@Param('dropId') dropId: string, @Req() req: any) {
    return { message: 'You are on the waitlist', data: await this.showcase.joinWaitlist(dropId, req.user.userId) };
  }

  @Delete('drops/:dropId/waitlist')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Leave the waitlist for a drop' })
  async leave(@Param('dropId') dropId: string, @Req() req: any) {
    return { message: 'You left the waitlist', data: await this.showcase.leaveWaitlist(dropId, req.user.userId) };
  }

  /** Plain link target for the Buy button: counts the click, then sends the shopper to the brand's store. */
  @Get('products/:productId/go')
  @ApiOperation({ summary: "Count a Buy tap and redirect to the brand's store page" })
  async go(@Param('productId') productId: string, @Res() reply: any) {
    const result = await this.showcase.click(productId);
    if (!result) throw new NotFoundException('Garment not found');
    // Sent on the raw reply: the global response wrapper would otherwise turn a redirect into JSON.
    reply.status(302).header('Location', result.buyUrl).send();
  }

  @Post('products/:productId/click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'A shopper tapped Buy on a garment: counts the click and returns the store link' })
  async click(@Param('productId') productId: string) {
    const result = await this.showcase.click(productId);
    if (!result) throw new NotFoundException('Garment not found');
    return { message: 'Click recorded', data: result };
  }
}

@ApiTags('Brands (App) — runway spotlight')
@Controller('spotlight')
export class SpotlightController {
  constructor(private readonly showcase: BrandShowcaseService) {}

  @Get()
  @ApiOperation({ summary: 'Brands that won the latest runway auction' })
  async spotlight() {
    return { message: 'Spotlight fetched', data: await this.showcase.spotlight() };
  }
}
