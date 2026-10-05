import {
    Body,
    Controller,
    Header,
    Post,
    Req,
    Res,
    UseGuards,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { DrapeService } from './drape.service';
import { AnimateDto } from './dto/animate.dto';
import { GroupDrapeDto } from './dto/group-drape.dto';
import { LookEditDto } from './dto/look-edit.dto';
import { TryOnRequestDto } from './dto/tryon.dto';

@Controller('drape')
@UseGuards(AuthGuard)
export class DrapeController {
    constructor(private readonly drapeService: DrapeService) {}

    @Post('tryon')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async tryon(@Req() req: any, @Body() dto: TryOnRequestDto) {
        const userId = req.user?.userId;
        const result = await this.drapeService.processTryOn(userId, dto);
        return { success: true, ...result };
    }

    /** Multi-person Drape: every person's twin and outfit pieces in, one group photo out. */
    @Post('group')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async group(@Req() req: any, @Body() dto: GroupDrapeDto) {
        const userId = req.user?.userId;
        const result = await this.drapeService.processGroup(userId, dto);
        return { success: true, ...result };
    }

    @Post('look-edit')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async lookEdit(@Req() req: any, @Body() dto: LookEditDto) {
        const userId = req.user?.userId;
        const result = await this.drapeService.processLookEdit(userId, dto);
        return { success: true, ...result };
    }

    @Post('animate')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async animate(@Body() dto: AnimateDto) {
        const result = await this.drapeService.processAnimate(dto);
        return { success: true, ...result };
    }

    @Post('cutout')
    async cutout(@Req() req: any, @Res() res: any) {
        let buffer: Buffer;

        if (Buffer.isBuffer(req.body)) {
            buffer = req.body;
        } else if (req.body?.image) {
            const dataUrl = req.body.image;
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            buffer = Buffer.from(base64, 'base64');
        } else if (req.rawBody) {
            buffer = req.rawBody;
        } else {
            buffer = Buffer.from(req.body || '');
        }

        const cutout = await this.drapeService.processCutout(buffer);

        if (cutout.box) {
            res.header('X-Subject-Box', JSON.stringify(cutout.box));
        }
        res.header('Content-Type', 'image/png');
        res.send(cutout.png);
    }
}
