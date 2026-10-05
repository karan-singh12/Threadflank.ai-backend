import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminRole } from "@prisma/client";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRolesGuard } from "../admin-auth/guards/admin-roles.guard";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { CurrentAdmin } from "../../common/decorators/current-admin.decorator";
import { AuthenticatedAdmin } from "../../common/interfaces/admin-jwt-payload.interface";
import { PaymentsService } from "./payments.service";
import { AdjustCreditsDto, CreditPackDto, PaymentsFilterDto, UpdateBillingSettingsDto, UpdateCreditPackDto } from "./dto/billing.dto";

@ApiTags("Admin Panel — Billing")
@ApiBearerAuth()
@Controller("admin-panel/billing")
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: "Billing settings, Razorpay status and revenue" })
  async overview() {
    return { message: "Billing overview fetched", data: await this.payments.adminOverview() };
  }

  @Put("settings")
  @ApiOperation({ summary: "Update free credits and credit costs" })
  async updateSettings(@Body() dto: UpdateBillingSettingsDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Billing settings saved", data: await this.payments.updateSettings(dto, admin.adminUserId) };
  }

  @Get("packs")
  async packs() {
    return { message: "Credit packs fetched", data: await this.payments.listPacks() };
  }

  @Post("packs")
  async createPack(@Body() dto: CreditPackDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Credit pack created", data: await this.payments.createPack(dto, admin.adminUserId) };
  }

  @Put("packs/:id")
  async updatePack(@Param("id") id: string, @Body() dto: UpdateCreditPackDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Credit pack saved", data: await this.payments.updatePack(id, dto, admin.adminUserId) };
  }

  @Delete("packs/:id")
  async deletePack(@Param("id") id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Credit pack removed", data: await this.payments.deletePack(id, admin.adminUserId) };
  }

  @Get("payments")
  async listPayments(@Query() filter: PaymentsFilterDto) {
    const result = await this.payments.listPayments(filter);
    return { message: "Payments fetched", data: result.payments, meta: result.meta };
  }

  @Post("credits")
  @ApiOperation({ summary: "Add or remove a user's credits" })
  async adjustCredits(@Body() dto: AdjustCreditsDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: "Credits updated", data: await this.payments.adjustCredits(dto, admin.adminUserId) };
  }
}
