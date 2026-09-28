import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContactService } from './contact.service';
import { CreateContactInquiryDto } from './dto/create-contact.dto';

@ApiTags('Contact & Support (Public)')
@Controller('contact')
export class ContactPublicController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a contact / support inquiry' })
  async submit(@Body() dto: CreateContactInquiryDto) {
    const inquiry = await this.contactService.create(dto);
    return {
      message: 'Your inquiry has been submitted successfully. We will get back to you shortly.',
      data: inquiry,
    };
  }
}
