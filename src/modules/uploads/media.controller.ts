import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { readR2Object } from "../../shared/storage/r2-objects";

/**
 * Public read access to uploaded files in R2: GET /api/media/<folder>/<file>.
 *
 * The bucket's own URLs (`…r2.cloudflarestorage.com`) need signed requests, so the web app
 * rewrites them to this route. Keys carry an upload timestamp and never change, so responses
 * can be cached for good.
 */
@SkipThrottle()
@Controller("media")
export class MediaController {
  @Get(":folder/:file")
  async read(@Param("folder") folder: string, @Param("file") file: string, @Res() res: any) {
    if (!/^[\w-]+$/.test(folder) || !/^[\w.-]+$/.test(file)) throw new NotFoundException();
    const stored = await readR2Object(`${folder}/${file}`);
    if (!stored) throw new NotFoundException();
    res
      .header("Content-Type", stored.contentType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .send(stored.body);
  }
}
