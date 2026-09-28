import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
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

const hashResetToken = (token: string) => createHash('sha256').update(token).digest('hex');
const RESET_PASSWORD_EXPIRY_MIN = Number(process.env.RESET_PASSWORD_EXPIRE_TIME || 30);

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
      },
    });

    const token = await this.generateToken({
      userId:   user.id,
      email:    user.email,
      role:     user.role,
      username: user.username || undefined,
    });

    return {
      message: MESSAGES.auth.signupSuccess,
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
        html: `<p>Hi ${user.username || ''},</p><p>Click the link below to reset your password. This link expires in ${RESET_PASSWORD_EXPIRY_MIN} minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
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
      this.prisma.user.update({ where: { id: reset.userId }, data: { password: hashedPassword } }),
      this.prisma.userPasswordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
    ]);
  }
}
