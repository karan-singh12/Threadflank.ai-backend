import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PlaceBidDto } from '../dto/brand-common.dto';

export interface Top10BidSlotEntity {
  rankPosition: number;
  category: string;
  period: string;
  title?: string;
  currentHighestBid: number;
  yourCurrentBid?: number;
  status: 'winning' | 'outbid' | 'open';
  impressionsEstimate: string;
  endsInHours: number;
  projectedAudience?: { views: number; drapes: number };
}

@Injectable()
export class BrandBiddingService {
  private slots: Top10BidSlotEntity[] = [
    {
      rankPosition: 1,
      category: 'All Fashion - Platform Hero Carousel',
      period: 'Nov 2026',
      title: 'Hero Runway Board #1',
      currentHighestBid: 45000,
      yourCurrentBid: 38000,
      status: 'outbid',
      impressionsEstimate: '4.5M Views / 650K Drapes',
      endsInHours: 18,
      projectedAudience: { views: 4500000, drapes: 650000 },
    },
    {
      rankPosition: 2,
      category: 'Ethnic Wear & Wedding Spotlight',
      period: 'Nov 2026',
      title: 'Spotlight Runway Board #2',
      currentHighestBid: 28000,
      yourCurrentBid: 28000,
      status: 'winning',
      impressionsEstimate: '2.8M Views / 420K Drapes',
      endsInHours: 18,
      projectedAudience: { views: 2800000, drapes: 420000 },
    },
    {
      rankPosition: 3,
      category: 'Luxury Designer Bridal',
      period: 'Nov 2026',
      title: 'Bridal Showcase Board #3',
      currentHighestBid: 21000,
      status: 'open',
      impressionsEstimate: '1.9M Views / 280K Drapes',
      endsInHours: 18,
      projectedAudience: { views: 1900000, drapes: 280000 },
    },
    {
      rankPosition: 4,
      category: 'Trending D2C Brands of the Month',
      period: 'Nov 2026',
      title: 'Trending Ateliers Board #4',
      currentHighestBid: 16500,
      status: 'open',
      impressionsEstimate: '1.4M Views / 210K Drapes',
      endsInHours: 18,
      projectedAudience: { views: 1400000, drapes: 210000 },
    },
  ];

  findAll(): Top10BidSlotEntity[] {
    return this.slots;
  }

  placeBid(rankPosition: number, dto: PlaceBidDto) {
    const slot = this.slots.find((s) => s.rankPosition === rankPosition);
    if (!slot) {
      throw new NotFoundException(`Runway spotlight slot at rank #${rankPosition} does not exist.`);
    }

    if (dto.bidAmount <= slot.currentHighestBid) {
      throw new BadRequestException(
        `Bid amount must be strictly greater than the current leading bid of ₹${slot.currentHighestBid.toLocaleString('en-IN')}`,
      );
    }

    slot.currentHighestBid = dto.bidAmount;
    slot.yourCurrentBid = dto.bidAmount;
    slot.status = 'winning';

    return {
      success: true,
      slot,
      message: `Congratulations! You are now the leading bidder for Rank #${rankPosition} (${slot.category}) at ₹${dto.bidAmount.toLocaleString('en-IN')}.`,
    };
  }
}

