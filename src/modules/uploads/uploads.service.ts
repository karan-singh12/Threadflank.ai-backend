import { Injectable, BadRequestException, Inject } from "@nestjs/common";
import * as path from "path";
import { IStorageProvider, STORAGE_PROVIDER } from "../../shared/storage/storage.interface";
import { APP_CONSTANTS } from "../../common/constants/app.constant";

@Injectable()
export class UploadsService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider) {}

  async handleMultipart(req: any): Promise<void> {
    if (typeof req.isMultipart !== "function" || !req.isMultipart()) {
      return;
    }

    const parts = req.parts();
    const body: any = {};
    const tempFiles: Array<{ part: any; buffer: Buffer }> = [];
    let fileInfo: any = undefined;

    for await (const part of parts) {
      if (part.file) {
        // Collect file stream to buffer in-memory to handle field ordering
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);
        tempFiles.push({
          part,
          buffer: fileBuffer,
        });
      } else {
        body[part.fieldname] = part.value;
      }
    }

    // Folder is used as an object-key prefix; keep it to a safe single segment.
    const imagePath = String(body.imagePath || "general").replace(/[^a-zA-Z0-9_-]/g, "") || "general";

    for (const tempFile of tempFiles) {
      const ext = path.extname(tempFile.part.filename || "").toLowerCase().replace(".", "");
      if (
        ["user", "streamer", "billboard"].includes(imagePath) &&
        !(APP_CONSTANTS.uploads.allowedImageTypes as readonly string[]).includes(ext)
      ) {
        throw new BadRequestException(
          `Only ${APP_CONSTANTS.uploads.allowedImageTypes.join(", ")} files are allowed.`,
        );
      }

      // Goes to R2 (or Supabase / local disk, whichever StorageModule selected).
      // `imagePath` is also passed for the local-disk fallback, which names the folder that way.
      const result = await this.storage.save({
        buffer: tempFile.buffer,
        filename: tempFile.part.filename,
        folder: imagePath,
        imagePath,
        mimetype: tempFile.part.mimetype,
      } as any);

      fileInfo = {
        fieldname: tempFile.part.fieldname,
        originalname: tempFile.part.filename,
        encoding: tempFile.part.encoding,
        mimetype: tempFile.part.mimetype,
        filename: path.basename(result.path),
        path: result.path,
        url: result.url,
        size: result.size,
      };
    }

    // Attach to request object to mimic Express body-parser & multer outputs
    req.body = body;
    req.file = fileInfo;
  }
}

