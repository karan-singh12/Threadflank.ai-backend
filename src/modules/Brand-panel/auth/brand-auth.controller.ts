import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandAuthService } from './brand-auth.service';
import { BrandEmailDto, BrandLoginDto, BrandRefreshTokenDto, BrandResetPasswordDto, BrandVerifyEmailDto, RegisterBrandDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from './brand-auth.guard';
import { AuthenticatedBrand } from './brand-jwt.strategy';

@ApiTags('Brand Panel — Authentication')
// Brute-force guard for login/register.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('brand/auth')
export class BrandAuthController {
  constructor(private readonly authService: BrandAuthService) {}

  private meta(req: any) {
    return { ip: req.ip, userAgent: req.headers?.['user-agent'] };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a brand and its owner account; a verification email is sent' })
  async register(@Body() dto: RegisterBrandDto) {
    const data = await this.authService.register(dto);
    return { message: 'Check your email to verify your account.', data };
  }

  @Post('signup')
  @ApiOperation({ summary: 'Alias for register' })
  async signup(@Body() dto: RegisterBrandDto) {
    return this.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Brand login (separate from shopper and admin auth)' })
  async login(@Body() dto: BrandLoginDto, @Req() req: any) {
    const data = await this.authService.login(dto, this.meta(req));
    return { message: 'Signed in successfully.', data };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email address using the emailed token' })
  async verifyEmail(@Body() dto: BrandVerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified. You can now sign in.' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the verification email (same response for any address)' })
  async resendVerification(@Body() dto: BrandEmailDto) {
    await this.authService.resendVerification(dto.email);
    return { message: 'If the account still needs verifying, a new link is on its way.' };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a password reset link (same response for any address)' })
  async forgotPassword(@Body() dto: BrandEmailDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists for that email, a reset link is on its way.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using the emailed token' })
  async resetPassword(@Body() dto: BrandResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password updated. You can now sign in.' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token for a new access/refresh pair' })
  async refresh(@Body() dto: BrandRefreshTokenDto, @Req() req: any) {
    const data = await this.authService.refresh(dto.refreshToken, this.meta(req));
    return { message: 'Session refreshed.', data };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body() dto: BrandRefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Signed out.' };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(BrandAuthGuard)
  @ApiOperation({ summary: 'The signed-in brand account and its brand (session restore)' })
  async me(@CurrentBrand() brand: AuthenticatedBrand) {
    const data = await this.authService.me(brand.brandAccountId, brand.brandId);
    return { message: 'Brand session active.', data };
  }
}
