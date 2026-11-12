import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { AuditLogService } from '../../../shared/audit/audit-log.service';
import { BrandBiddingService } from '../../Brand-panel/bidding/brand-bidding.service';

class CycleSlotDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
  @IsString() @MinLength(2) @MaxLength(120) category!: string;
  @IsOptional() @IsInt() @Min(100) @Max(10_000_000) minBid?: number;
  @IsOptional() @IsString() @MaxLength(120) impressionsEstimate?: string;
  @IsOptional() @IsInt() @Min(0) projectedViews?: number;
  @IsOptional() @IsInt() @Min(0) projectedDrapes?: number;
}

class CreateCycleDto {
  @IsString() @MinLength(2) @MaxLength(80) label!: string;
  @IsISO8601() endsAt!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => CycleSlotDto) slots!: CycleSlotDto[];
}

class MarkPaidDto {
  @IsBoolean() paid!: boolean;
}

/** Staff controls for the runway auction: open a cycle, watch bids, close it, record payment. */
@ApiTags('Admin Panel — Runway bidding')
@ApiBearerAuth()
@Controller('admin-panel/brand-portal/bidding')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class BrandBiddingAdminController {
  constructor(
    private readonly bidding: BrandBiddingService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('cycles')
  @ApiOperation({ summary: 'Recent auction cycles with slot standings and winners' })
  async cycles() {
    return { message: 'Cycles fetched', data: await this.bidding.listCycles() };
  }

  @Post('cycles')
  @ApiOperation({ summary: 'Open a new auction with its slots' })
  async create(@Body() dto: CreateCycleDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const cycle = await this.bidding.createCycle(dto, admin.adminUserId);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BID_CYCLE_OPENED', entityType: 'BidCycle', entityId: cycle.id, metadata: { label: dto.label, slots: dto.slots.length } });
    return { message: 'Auction opened', data: cycle };
  }

  @Post('cycles/:id/close')
  @ApiOperation({ summary: 'Close an auction now and record the winners' })
  async close(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const closed = await this.bidding.closeCycle(id);
    if (closed) await this.audit.log({ adminUserId: admin.adminUserId, action: 'BID_CYCLE_CLOSED', entityType: 'BidCycle', entityId: id });
    return { message: closed ? 'Auction closed' : 'Already closed', data: { id, closed } };
  }

  @Get('slots/:slotId/bids')
  @ApiOperation({ summary: 'Every bid on a slot, highest first' })
  async bids(@Param('slotId') slotId: string) {
    return { message: 'Bids fetched', data: await this.bidding.slotBids(slotId) };
  }

  @Patch('slots/:slotId/paid')
  @ApiOperation({ summary: 'Record that the winning brand has paid for the slot' })
  async paid(@Param('slotId') slotId: string, @Body() dto: MarkPaidDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const result = await this.bidding.markPaid(slotId, dto.paid);
    await this.audit.log({ adminUserId: admin.adminUserId, action: dto.paid ? 'BID_SLOT_PAID' : 'BID_SLOT_UNPAID', entityType: 'BidSlot', entityId: slotId });
    return { message: 'Payment status updated', data: result };
  }
}
