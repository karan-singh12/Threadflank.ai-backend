import { PartialType } from '@nestjs/swagger';
import { CreateStudioBackgroundDto } from './create-studio-background.dto';

export class UpdateStudioBackgroundDto extends PartialType(CreateStudioBackgroundDto) {}
