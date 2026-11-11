import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandAuthService } from './brand-auth.service';
import { BrandLoginDto, RegisterBrandDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — Authentication')
@Controller('brand/auth')
export class BrandAuthController {
  constructor(private readonly authService: BrandAuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register and Onboard a new Brand Atelier' })
  async register(@Body() dto: RegisterBrandDto) {
    const result = await this.authService.register(dto);
    return {
      message: result.message,
      data: result,
    };
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Alias for Brand Atelier Signup' })
  async signup(@Body() dto: RegisterBrandDto) {
    return this.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login to Brand Atelier Panel' })
  async login(@Body() dto: BrandLoginDto) {
    const result = await this.authService.login(dto);
    return {
      message: 'Atelier session authenticated successfully',
      data: result,
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current authenticated brand atelier profile' })
  async getMe() {
    const brand = await this.authService.getMe();
    return {
      message: 'Brand session active',
      data: brand,
    };
  }
}

