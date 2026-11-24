import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalAuthGuard } from '../../../common/guards/optional-auth.guard';
import { CampaignsService } from '../../Brand-panel/campaigns/campaigns.service';

@ApiTags('Campaigns (App)')
@Controller('campaigns')
export class CampaignsPublicController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'Campaigns running now (Diwali Edit, Wedding Season Edit…)' })
  async live() {
    return { message: 'Campaigns fetched', data: await this.campaigns.live() };
  }

  @Get(':slug')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: "A campaign page with every brand's entered pieces" })
  async page(@Param('slug') slug: string, @Req() req: any) {
    return { message: 'Campaign fetched', data: await this.campaigns.page(slug, req.user?.userId) };
  }
}
