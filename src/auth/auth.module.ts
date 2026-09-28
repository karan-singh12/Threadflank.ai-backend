import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PrismaModule } from "../prisma/prisma.module";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { MailerModule } from "../shared/mailer/mailer.module";
import { AppLogger } from "../shared/logger/logger.service";

import { AuthGuard } from "../common/guards/auth.guard";
import { OptionalAuthGuard } from "../common/guards/optional-auth.guard";

@Module({
  imports: [
    PrismaModule,
    MailerModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || "super-secret-key-12345",
      signOptions: { expiresIn: "10d" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AppLogger, AuthGuard, OptionalAuthGuard],
  exports: [AuthService, JwtModule, JwtStrategy, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}

