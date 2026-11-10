import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';
import { BrandAuthService } from '../auth/brand-auth.service';

export interface ProductItemEntity {
  id: string;
  title: string;
  sku: string;
  price: number;
  originalPrice?: number;
  images: string[];
  category: string;
  occasions: string[];
  colors: string[];
  sizes: string[];
  stock: number;
  isDrapeReady: boolean;
  drapeScore: number;
  fitScore?: number;
  drapesCount: number;
  clicksCount: number;
  buyUrl: string;
  featured: boolean;
  newDrop: boolean;
}

@Injectable()
export class BrandCatalogService {
  // In-memory backing cache synchronized with initial luxury catalog
  private products: ProductItemEntity[] = [
    {
      id: 'prod_01',
      title: 'Varanasi Gold Zari Tissue Lehenga',
      sku: 'RM-LEH-01',
      price: 84000,
      originalPrice: 95000,
      images: [
        'https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b?w=800&auto=format&fit=crop&q=80',
        'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80',
      ],
      category: 'Ethnic Wear',
      occasions: ['Shaadi', 'Reception', 'Sangeet'],
      colors: ['Antique Gold', 'Blush Pink'],
      sizes: ['XS', 'S', 'M', 'L', 'Custom'],
      stock: 14,
      isDrapeReady: true,
      drapeScore: 98,
      fitScore: 95,
      drapesCount: 3840,
      clicksCount: 520,
      buyUrl: 'https://rawmango.com/shop/lehengas/varanasi-gold',
      featured: true,
      newDrop: true,
    },
    {
      id: 'prod_02',
      title: 'Gulab Chanderi Silk Kurta Set',
      sku: 'RM-KRT-09',
      price: 32000,
      images: [
        'https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?w=800&auto=format&fit=crop&q=80',
      ],
      category: 'Suits & Sets',
      occasions: ['Mehendi', 'Haldi', 'Diwali'],
      colors: ['Rani Pink', 'Emerald Green'],
      sizes: ['S', 'M', 'L', 'XL'],
      stock: 28,
      isDrapeReady: true,
      drapeScore: 94,
      fitScore: 92,
      drapesCount: 2910,
      clicksCount: 410,
      buyUrl: 'https://rawmango.com/shop/sets/gulab-chanderi',
      featured: true,
      newDrop: false,
    },
    {
      id: 'prod_03',
      title: 'Pithora Hand-Painted Silk Organza Saree',
      sku: 'RM-SAR-44',
      price: 48000,
      images: [
        'https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&auto=format&fit=crop&q=80',
      ],
      category: 'Sarees',
      occasions: ['Cocktail', 'Reception', 'Engagement'],
      colors: ['Ivory Mist', 'Sage Green'],
      sizes: ['Free Size'],
      stock: 8,
      isDrapeReady: true,
      drapeScore: 96,
      fitScore: 98,
      drapesCount: 4210,
      clicksCount: 680,
      buyUrl: 'https://rawmango.com/shop/sarees/pithora-organza',
      featured: true,
      newDrop: true,
    },
    {
      id: 'prod_04',
      title: 'Marigold Brocade Sherwani & Stole',
      sku: 'RM-SHR-03',
      price: 92000,
      images: [
        'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&auto=format&fit=crop&q=80',
      ],
      category: 'Menswear',
      occasions: ['Shaadi', 'Sangeet'],
      colors: ['Ochre Gold', 'Deep Maroon'],
      sizes: ['38', '40', '42', '44'],
      stock: 5,
      isDrapeReady: false,
      drapeScore: 68,
      fitScore: 70,
      drapesCount: 890,
      clicksCount: 110,
      buyUrl: 'https://rawmango.com/shop/mens/marigold-sherwani',
      featured: false,
      newDrop: true,
    },
    {
      id: 'prod_05',
      title: 'Neelambari Velvet Jacket & Sharara',
      sku: 'RM-JKT-18',
      price: 54000,
      images: [
        'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&auto=format&fit=crop&q=80',
      ],
      category: 'Indo-Western',
      occasions: ['Cocktail', 'Sangeet'],
      colors: ['Midnight Blue', 'Aubergine'],
      sizes: ['XS', 'S', 'M', 'L'],
      stock: 12,
      isDrapeReady: true,
      drapeScore: 92,
      fitScore: 89,
      drapesCount: 1980,
      clicksCount: 340,
      buyUrl: 'https://rawmango.com/shop/indo-western/neelambari',
      featured: false,
      newDrop: false,
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: BrandAuthService,
  ) {}

  async findAll(): Promise<ProductItemEntity[]> {
    return this.products;
  }

  async findOne(id: string): Promise<ProductItemEntity> {
    const item = this.products.find((p) => p.id === id);
    if (!item) {
      throw new NotFoundException(`Garment with ID ${id} not found in catalog.`);
    }
    return item;
  }

  async create(dto: CreateGarmentDto): Promise<ProductItemEntity> {
    const newId = `prod_${Date.now()}`;
    const garment: ProductItemEntity = {
      id: newId,
      title: dto.title,
      sku: dto.sku || `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      price: dto.price,
      originalPrice: dto.originalPrice,
      images: dto.images.length > 0 ? dto.images : ['https://images.unsplash.com/photo-1583391733956-3750e0ff4e8b'],
      category: dto.category || 'Ethnic Wear',
      occasions: dto.occasions || ['Celebration'],
      colors: dto.colors || ['Custom'],
      sizes: dto.sizes || ['Free Size'],
      stock: dto.stock ?? 10,
      isDrapeReady: dto.isDrapeReady ?? true,
      drapeScore: dto.drapeScore ?? 92,
      fitScore: 90,
      drapesCount: 0,
      clicksCount: 0,
      buyUrl: dto.buyUrl,
      featured: dto.featured ?? false,
      newDrop: dto.newDrop ?? true,
    };

    this.products.unshift(garment);
    return garment;
  }

  async update(id: string, dto: UpdateGarmentDto): Promise<ProductItemEntity> {
    const index = this.products.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new NotFoundException(`Garment with ID ${id} not found.`);
    }

    const current = this.products[index];
    const updated: ProductItemEntity = {
      ...current,
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
      ...(dto.price !== undefined ? { price: dto.price } : {}),
      ...(dto.originalPrice !== undefined ? { originalPrice: dto.originalPrice } : {}),
      ...(dto.images !== undefined ? { images: dto.images } : {}),
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.occasions !== undefined ? { occasions: dto.occasions } : {}),
      ...(dto.colors !== undefined ? { colors: dto.colors } : {}),
      ...(dto.sizes !== undefined ? { sizes: dto.sizes } : {}),
      ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
      ...(dto.isDrapeReady !== undefined ? { isDrapeReady: dto.isDrapeReady } : {}),
      ...(dto.drapeScore !== undefined ? { drapeScore: dto.drapeScore } : {}),
      ...(dto.buyUrl !== undefined ? { buyUrl: dto.buyUrl } : {}),
      ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
      ...(dto.newDrop !== undefined ? { newDrop: dto.newDrop } : {}),
    };

    this.products[index] = updated;
    return updated;
  }

  async remove(id: string): Promise<{ success: boolean; id: string }> {
    const initialLen = this.products.length;
    this.products = this.products.filter((p) => p.id !== id);
    if (this.products.length === initialLen) {
      throw new NotFoundException(`Garment with ID ${id} not found.`);
    }
    return { success: true, id };
  }

  incrementClick(id: string) {
    const garment = this.products.find((p) => p.id === id);
    if (garment) {
      garment.clicksCount = (garment.clicksCount || 0) + 1;
    }
  }

  incrementDrape(id: string) {
    const garment = this.products.find((p) => p.id === id);
    if (garment) {
      garment.drapesCount = (garment.drapesCount || 0) + 1;
    }
  }
}

