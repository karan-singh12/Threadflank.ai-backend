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

interface Slot {
  rankPosition: number;
  category: string;
  title: string;
  impressionsEstimate: string;
  projectedAudience: { views: number; drapes: number };
  highestBid: number;
  leaderBrandId?: string;
  /** Latest bid per brand. */
  bids: Map<string, number>;
}

/**
 * The auction board is shared by all brands; each brand sees its own standing. In memory until
 * bid tables and an admin-side cycle manager exist. The slot list below is the platform's placeholder board.
 */
@Injectable()
export class BrandBiddingService {
  private readonly cycleEndsAt = Date.now() + 18 * 3_600_000;
  private readonly period = new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  private readonly slots: Slot[] = [
    { rankPosition: 1, category: 'All Fashion - Platform Hero Carousel', title: 'Hero Runway Board #1', impressionsEstimate: '4.5M Views / 650K Drapes', projectedAudience: { views: 4500000, drapes: 650000 }, highestBid: 45000, bids: new Map() },
    { rankPosition: 2, category: 'Ethnic Wear & Wedding Spotlight', title: 'Spotlight Runway Board #2', impressionsEstimate: '2.8M Views / 420K Drapes', projectedAudience: { views: 2800000, drapes: 420000 }, highestBid: 28000, bids: new Map() },
    { rankPosition: 3, category: 'Luxury Designer Bridal', title: 'Bridal Showcase Board #3', impressionsEstimate: '1.9M Views / 280K Drapes', projectedAudience: { views: 1900000, drapes: 280000 }, highestBid: 21000, bids: new Map() },
    { rankPosition: 4, category: 'Trending D2C Brands of the Month', title: 'Trending Ateliers Board #4', impressionsEstimate: '1.4M Views / 210K Drapes', projectedAudience: { views: 1400000, drapes: 210000 }, highestBid: 16500, bids: new Map() },
  ];

  private view(slot: Slot, brandId: string): Top10BidSlotEntity {
    const mine = slot.bids.get(brandId);
    return {
      rankPosition: slot.rankPosition,
      category: slot.category,
      period: this.period,
      title: slot.title,
      currentHighestBid: slot.highestBid,
      yourCurrentBid: mine,
      status: mine === undefined ? 'open' : slot.leaderBrandId === brandId ? 'winning' : 'outbid',
      impressionsEstimate: slot.impressionsEstimate,
      endsInHours: Math.max(0, Math.ceil((this.cycleEndsAt - Date.now()) / 3_600_000)),
      projectedAudience: slot.projectedAudience,
    };
  }

  findAll(brandId: string): Top10BidSlotEntity[] {
    return this.slots.map((s) => this.view(s, brandId));
  }

  placeBid(brandId: string, rankPosition: number, dto: PlaceBidDto) {
    const slot = this.slots.find((s) => s.rankPosition === rankPosition);
    if (!slot) throw new NotFoundException(`Runway spotlight slot at rank #${rankPosition} does not exist.`);

    if (dto.bidAmount <= slot.highestBid) {
      throw new BadRequestException(`Bid amount must be strictly greater than the current leading bid of ₹${slot.highestBid.toLocaleString('en-IN')}`);
    }

    slot.highestBid = dto.bidAmount;
    slot.leaderBrandId = brandId;
    slot.bids.set(brandId, dto.bidAmount);

    return {
      slot: this.view(slot, brandId),
      message: `You are now the leading bidder for Rank #${rankPosition} (${slot.category}) at ₹${dto.bidAmount.toLocaleString('en-IN')}.`,
    };
  }
}
