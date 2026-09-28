import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { CmsService } from './cms.service';
import { MESSAGES } from '../../common/constants/messages.constant';

/** Unauthenticated: landing content, legal pages, banners, and FAQs must be
 * readable before login. */
@ApiTags('CMS (Public)')
@Controller('cms')
export class CmsPublicController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @ApiOperation({ summary: 'List all published content blocks' })
  @ApiQuery({ name: 'type', required: false })
  async listPublic(@Query('type') type?: string) {
    const blocks = await this.cmsService.listPublic(type);
    return { message: MESSAGES.cms.listFetched, data: blocks };
  }

  @Get(':key')
  @ApiOperation({ summary: 'Get a published content block by key' })
  async findByKey(@Param('key') key: string) {
    const block = await this.cmsService.findByKeyPublic(key);
    return { message: MESSAGES.cms.fetched, data: block };
  }
}
