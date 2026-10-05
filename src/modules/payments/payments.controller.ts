import { Body, Controller, Get, Headers, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { SkipThrottle, Throttle } from "@nestjs/throttler";
import { AuthGuard } from "../../common/guards/auth.guard";
import { CreditsService } from "./credits.service";
import { PaymentsService } from "./payments.service";
import { CreateOrderDto, VerifyPaymentDto } from "./dto/billing.dto";

/** Credits and checkout for app users, plus the Razorpay webhook. */
@Controller("billing")
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
  ) {}

  /** Pricing page: free credits and the packs on sale. */
  @Get("packs")
  async packs() {
    return { message: "Credit packs fetched", data: await this.payments.catalogue() };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  async me(@Req() req: any) {
    return { message: "Wallet fetched", data: await this.payments.wallet(req.user.userId) };
  }

  @Get("history")
  @UseGuards(AuthGuard)
  async history(@Req() req: any) {
    return { message: "Credit history fetched", data: await this.credits.history(req.user.userId) };
  }

  @Post("orders")
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createOrder(@Req() req: any, @Body() dto: CreateOrderDto) {
    return { message: "Order created", data: await this.payments.createOrder(req.user.userId, dto.packId) };
  }

  @Post("verify")
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async verify(@Req() req: any, @Body() dto: VerifyPaymentDto) {
    return { message: "Payment verified", data: await this.payments.verifyCheckout(req.user.userId, dto) };
  }

  /**
   * Razorpay webhook (payment.captured, order.paid, payment.failed). The signature is checked
   * against the raw body, which main.ts keeps for this path.
   */
  @Post("razorpay/webhook")
  @SkipThrottle()
  @HttpCode(200)
  async webhook(@Req() req: any, @Headers("x-razorpay-signature") signature?: string) {
    return { message: "Webhook received", data: await this.payments.handleWebhook(req.rawBody, signature) };
  }
}
