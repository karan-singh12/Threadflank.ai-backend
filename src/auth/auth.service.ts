import { Injectable, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Role } from '@prisma/client';
import { MESSAGES } from '../common/constants/messages.constant';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { MailerService } from '../shared/mailer/mailer.service';
import { AppLogger } from '../shared/logger/logger.service';
import { passwordResetEmailHtml, verificationEmailHtml } from '../common/utils/email.util';

const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');
const RESET_PASSWORD_EXPIRY_MIN = Number(process.env.RESET_PASSWORD_EXPIRE_TIME || 30);
const VERIFY_EMAIL_EXPIRY_HOURS = Number(process.env.VERIFY_EMAIL_EXPIRE_HOURS || 24);

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly logger: AppLogger,
  ) {}

  async generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): Promise<string> {
    return this.jwtService.sign(payload);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async signup(signupDto: SignupDto) {
    const { email, password, username, role, avatar } = signupDto;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }

    if (password.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters long');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new BadRequestException(MESSAGES.auth.emailExists);
    }

    const hashedPassword = await this.hashPassword(password);

    let assignedRole: Role = Role.USER;
    if (role?.toUpperCase() === 'ADMIN') {
      assignedRole = Role.ADMIN;
    }

    const user = await this.prisma.user.create({
      data: {
        email:    email.toLowerCase(),
        password: hashedPassword,
        username: username || null,
        role:     assignedRole,
        avatar:   avatar || null,
        emailVerified: false,
      },
    });

    await this.sendVerificationEmail(user);

    // No session yet: the account is activated by the emailed link (see verifyEmail).
    return {
      message: MESSAGES.auth.verificationSent,
      data: {
        requiresVerification: true,
        user: {
          id:       user.id,
          email:    user.email,
          username: user.username,
          role:     user.role,
          bio:      user.bio,
          phone:    user.phone,
          location: user.location,
          avatar:   user.avatar,
        },
      },
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException(MESSAGES.auth.invalidCredentials);
    }

    const isPasswordValid = await this.comparePassword(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(MESSAGES.auth.invalidCredentials);
    }

    if (!user.emailVerified) {
      throw new ForbiddenException(MESSAGES.auth.emailNotVerified);
    }

    const token = await this.generateToken({
      userId:   user.id,
      email:    user.email,
      role:     user.role,
      username: user.username || undefined,
    });

    return {
      message: MESSAGES.auth.loginSuccess,
      data: {
        token,
        user: {
          id:       user.id,
          email:    user.email,
          username: user.username,
          role:     user.role,
          bio:      user.bio,
          phone:    user.phone,
          location: user.location,
          avatar:   user.avatar,
        },
      },
    };
  }

  // ─── Password reset (new — does not touch signup/login above) ────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });

    // Always resolve the same way whether or not the account exists, so this
    // endpoint can't be used to enumerate registered emails.
    if (!user) return;

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.userPasswordReset.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_PASSWORD_EXPIRY_MIN * 60 * 1000),
      },
    });

    const resetUrl = `${process.env.USER_PASSWORD_RESET_URL || 'http://localhost:3000/reset-password/'}${rawToken}`;

    try {
      await this.mailer.send({
        to: user.email,
        subject: 'Reset your Threadflank password',
        html: passwordResetEmailHtml({ name: user.username, url: resetUrl, expiresInMinutes: RESET_PASSWORD_EXPIRY_MIN }),
      });
    } catch (error) {
      // Mail delivery failure shouldn't leak whether the account exists, but
      // is logged — including the URL, so local/dev testing works without a
      // configured mail provider.
      this.logger.warn('AuthService', `Password reset email not sent (mailer not configured?) — dev link: ${resetUrl}`);
      this.logger.error('AuthService', 'Failed to send password reset email', error);
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashResetToken(dto.token);
    const reset = await this.prisma.userPasswordReset.findFirst({
      where: { tokenHash, usedAt: null },
    });

    if (!reset || reset.expiresAt < new Date()) {
      throw new BadRequestException(MESSAGES.auth.resetInvalid);
    }

    const hashedPassword = await this.hashPassword(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { password: hashedPassword, emailVerified: true } }),
      this.prisma.userPasswordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);
  }

  // ─── Email verification ───────────────────────────────────────────────────

  private async sendVerificationEmail(user: { id: string; email: string; username: string | null }): Promise<void> {
    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.userEmailVerification.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFY_EMAIL_EXPIRY_HOURS * 60 * 60 * 1000),
      },
    });

    const verifyUrl = `${process.env.USER_EMAIL_VERIFY_URL || 'http://localhost:3000/verify-email/'}${rawToken}`;

    try {
      await this.mailer.send({
        to: user.email,
        subject: 'Verify your ThreadFlank email',
        html: verificationEmailHtml({ name: user.username, url: verifyUrl, expiresInHours: VERIFY_EMAIL_EXPIRY_HOURS }),
      });
    } catch (error) {
      // Signup still succeeds; the user can request another link. The URL is logged so
      // local/dev testing works without a configured mail provider.
      this.logger.warn('AuthService', `Verification email not sent (mailer not configured?) — dev link: ${verifyUrl}`);
      this.logger.error('AuthService', 'Failed to send verification email', error);
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.userEmailVerification.findFirst({
      where: { tokenHash: hashResetToken(token), usedAt: null },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException(MESSAGES.auth.verifyInvalid);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
      this.prisma.userEmailVerification.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Same silent outcome for unknown or already-verified emails, so this can't be used to probe accounts.
    if (!user || user.emailVerified) return;

    await this.sendVerificationEmail(user);
  }
}
