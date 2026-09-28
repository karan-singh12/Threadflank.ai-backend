import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AdminShareController, ShareController } from "./share.controller";
import { ShareService } from "./share.service";

@Module({
  imports: [PrismaModule, AuthModule, AdminAuthModule],
  controllers: [ShareController, AdminShareController],
  providers: [ShareService],
})
export class ShareModule {}
