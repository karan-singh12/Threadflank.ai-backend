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
import { CreditsService } from '../payments/credits.service';
import { DrapeService } from './drape.service';
import { AnimateDto } from './dto/animate.dto';
import { GroupDrapeDto } from './dto/group-drape.dto';
import { LookEditDto } from './dto/look-edit.dto';
import { TryOnRequestDto } from './dto/tryon.dto';

@Controller('drape')
@UseGuards(AuthGuard)
export class DrapeController {
    constructor(
        private readonly drapeService: DrapeService,
        private readonly credits: CreditsService,
    ) {}

    // Every generated image costs 1 credit (a video costs the admin-set amount). Credits are
    // taken before the render and given back if it fails; responses carry the new balance.

    @Post('tryon')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async tryon(@Req() req: any, @Body() dto: TryOnRequestDto) {
        const userId = req.user?.userId;
        const result = await this.credits.charge(userId, 1, 'DRAPE', () => this.drapeService.processTryOn(userId, dto));
        return { success: true, ...result, creditsLeft: await this.credits.balance(userId) };
    }

    /** Multi-person Drape: every person's twin and outfit pieces in, one group photo out — 1 credit. */
    @Post('group')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async group(@Req() req: any, @Body() dto: GroupDrapeDto) {
        const userId = req.user?.userId;
        const result = await this.credits.charge(userId, 1, 'DRAPE', () => this.drapeService.processGroup(userId, dto));
        return { success: true, ...result, creditsLeft: await this.credits.balance(userId) };
    }

    @Post('look-edit')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async lookEdit(@Req() req: any, @Body() dto: LookEditDto) {
        const userId = req.user?.userId;
        const result = await this.credits.charge(userId, 1, 'LOOK_EDIT', () => this.drapeService.processLookEdit(userId, dto));
        return { success: true, ...result, creditsLeft: await this.credits.balance(userId) };
    }

    @Post('animate')
    @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
    async animate(@Req() req: any, @Body() dto: AnimateDto) {
        const userId = req.user?.userId;
        const { videoCost } = await this.credits.settings();
        const result = await this.credits.charge(userId, videoCost, 'VIDEO', () => this.drapeService.processAnimate(dto));
        return { success: true, ...result, creditsLeft: await this.credits.balance(userId) };
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
