import { Controller, Post, Body, HttpCode, HttpStatus } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { MESSAGES } from "../common/constants/messages.constant";

// Brute-force guard for login/signup/password reset.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller("user/auth")
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post("signup")
  async signup(@Body() body: any) {
    const signupDto = {
      email: body.email,
      password: body.password,
      username: body.username,
      role: body.role || "USER",
      avatar: body.avatar,
    };
    return this.authService.signup(signupDto);
  }

  @Post("login")
  async login(@Body() body: any) {
    const loginDto = {
      email: body.email,
      password: body.password,
    };
    return this.authService.login(loginDto);
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return { message: MESSAGES.auth.resetRequested };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: MESSAGES.auth.resetSuccess };
  }
}