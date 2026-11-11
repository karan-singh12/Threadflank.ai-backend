import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandAuthService } from './brand-auth.service';
import { BrandLoginDto, BrandRefreshTokenDto, RegisterBrandDto } from '../dto/brand-common.dto';
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
  @ApiOperation({ summary: 'Register a brand and its owner account' })
  async register(@Body() dto: RegisterBrandDto, @Req() req: any) {
    const data = await this.authService.register(dto, this.meta(req));
    return { message: 'Brand registered successfully. Welcome to Threadflank.', data };
  }

  @Post('signup')
  @ApiOperation({ summary: 'Alias for register' })
  async signup(@Body() dto: RegisterBrandDto, @Req() req: any) {
    return this.register(dto, req);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Brand login (separate from shopper and admin auth)' })
  async login(@Body() dto: BrandLoginDto, @Req() req: any) {
    const data = await this.authService.login(dto, this.meta(req));
    return { message: 'Signed in successfully.', data };
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
