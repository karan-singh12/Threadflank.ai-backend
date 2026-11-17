import { Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuthGuard } from '../../../common/guards/optional-auth.guard';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { BrandShowcaseService } from './brand-showcase.service';
import { BrandDirectoryService } from './brand-directory.service';
import { BrandFollowService } from './brand-follow.service';
import { BrandStoreService } from './brand-store.service';
import { DirectoryQueryDto, StoreCatalogQueryDto } from './brand-store.dto';
import { TaxonomyService } from '../../Brand-panel/taxonomy/taxonomy.service';
import { BrandEventsService } from '../../../shared/brand-events/brand-events.service';
import { getClientIp } from '../../../common/utils/client-ip.util';

/** What shoppers see of a brand's own panel data: its catalog, its drops, and the runway spotlight. */
@ApiTags('Brands (App) — showcase')
@ApiBearerAuth()
@Controller('brands')
export class BrandShowcaseController {
  constructor(
    private readonly showcase: BrandShowcaseService,
    private readonly directory: BrandDirectoryService,
    private readonly store: BrandStoreService,
    private readonly events: BrandEventsService,
    private readonly follows: BrandFollowService,
  ) {}

  @Get('directory')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'One page of brand cards: search, category, sort (built for 1000+ brands)' })
  async dir(@Query() q: DirectoryQueryDto) {
    return { message: 'Brands fetched', data: await this.directory.directory(q) };
  }

  @Get('directory/categories')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Brand categories with how many brands each has' })
  async dirCategories() {
    return { message: 'Categories fetched', data: await this.directory.categories() };
  }

  @Get(':slug/store')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: "A brand's virtual store: profile, showcase, filters, new in and drops in one call" })
  async storeHome(@Param('slug') slug: string, @Req() req: any) {
    const data = await this.store.store(slug, req.user?.userId);
    const [followers, following] = await Promise.all([this.follows.count(data.brand.id), this.follows.isFollowing(data.brand.id, req.user?.userId)]);
    (data.brand as any).followers = followers;
    (data.brand as any).following = following;
    this.events.record({ brandId: data.brand.id, type: 'STORE_VIEW', userId: req.user?.userId, actor: req.user?.userId ?? getClientIp(req) });
    return { message: 'Store fetched', data };
  }

  @Get('following')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Brands the signed-in shopper follows' })
  async following(@Req() req: any) {
    return { message: 'Following fetched', data: await this.follows.mine(req.user.userId) };
  }

  @Post(':slug/follow')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow a brand to hear about its drops' })
  async follow(@Param('slug') slug: string, @Req() req: any) {
    return { message: 'Following', data: await this.follows.follow(slug, req.user.userId) };
  }

  @Delete(':slug/follow')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Unfollow a brand' })
  async unfollow(@Param('slug') slug: string, @Req() req: any) {
    return { message: 'Unfollowed', data: await this.follows.unfollow(slug, req.user.userId) };
  }

  @Get(':slug/pieces')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: "A brand's pieces: filtered, sorted, cursor-paginated" })
  async pieces(@Param('slug') slug: string, @Query() q: StoreCatalogQueryDto, @Req() req: any) {
    return { message: 'Pieces fetched', data: await this.store.catalog(slug, q, req.user?.userId) };
  }

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

@ApiTags('Discover (App) — categories')
@Controller('discover')
export class DiscoverController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('categories')
  @ApiOperation({ summary: 'The categories admins set up for Discover, in order, with how many live pieces each has' })
  async categories() {
    return { message: 'Categories fetched', data: await this.taxonomy.publicCategories() };
  }
}
