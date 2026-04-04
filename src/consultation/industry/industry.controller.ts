import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IndustryService } from './industry.service';
import { SearchIndustryDto } from './dto/search-industry.dto';

@ApiTags('Industries')
@Controller('industries')
export class IndustryController {
  constructor(private industryService: IndustryService) {}

  @Get()
  list(@Query() query: SearchIndustryDto) {
    return this.industryService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.industryService.findById(id);
  }
}
