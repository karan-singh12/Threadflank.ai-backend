import { Module } from "@nestjs/common";
import { UploadsController } from "./uploads.controller";
import { MediaController } from "./media.controller";
import { UploadsService } from "./uploads.service";
import { AuthModule } from "../../auth/auth.module";
import { StorageModule } from "../../shared/storage/storage.module";

@Module({
  imports: [AuthModule, StorageModule.register()],
  controllers: [UploadsController, MediaController],
  providers: [UploadsService],
  exports: [UploadsService, StorageModule],
})
export class UploadsModule {}

