import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BrandAuthService } from '../auth/brand-auth.service';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { InviteMemberDto, SetMemberActiveDto, SetMemberRoleDto } from '../dto/brand-common.dto';

/** The brand owner adds teammates; they set their own password from an emailed link. */
@ApiTags('Brand Panel — Team')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/team')
export class BrandTeamController {
  constructor(private readonly auth: BrandAuthService) {}

  @Get()
  @ApiOperation({ summary: 'Everyone with a login for this brand' })
  async list(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Team fetched', data: await this.auth.listTeam(brand.brandId) };
  }

  @Post('invite')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invite a teammate by email (owner only)' })
  async invite(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: InviteMemberDto) {
    return { message: 'Invitation sent', data: await this.auth.inviteMember(brand.brandAccountId, brand.brandId, dto) };
  }

  @Post(':id/resend')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send the invitation again (owner only)' })
  async resend(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    await this.auth.resendInvite(brand.brandAccountId, brand.brandId, id);
    return { message: 'Invitation sent again' };
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a teammate' + "'" + 's role (owner only)' })
  async setRole(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string, @Body() dto: SetMemberRoleDto) {
    return { message: 'Role updated', data: await this.auth.setMemberRole(brand.brandAccountId, brand.brandId, id, dto.role) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Enable or disable a teammate (owner only)' })
  async setActive(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string, @Body() dto: SetMemberActiveDto) {
    return { message: 'Teammate updated', data: await this.auth.setMemberActive(brand.brandAccountId, brand.brandId, id, dto.isActive) };
  }
}
