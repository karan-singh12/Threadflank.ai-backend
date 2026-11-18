import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { BrandDropsService } from './drops/brand-drops.service';
import { BrandProfileService } from './profile/brand-profile.service';
import { BrandVideoService } from './ai-studio/brand-video.service';
import { CreateBrandVideoDto, CreateDropDto, CreateGarmentDto, UpdateGarmentDto } from './dto/brand-common.dto';

const errorsOf = async (cls: any, data: object) => (await validate(plainToInstance(cls, data))).map((e) => e.property);
const day = 86_400_000;
const drop = (over: object = {}) => ({ title: 'Diwali', collectionName: 'Zari', launchDate: new Date(Date.now() + 5 * day).toISOString(), bannerUrl: '', productsCount: 5, ...over });

describe('Drop validation', () => {
  it('accepts a valid drop with an empty banner', async () => {
    expect(await errorsOf(CreateDropDto, drop())).toEqual([]);
  });
  it('rejects absurd garment counts and non-https banners', async () => {
    expect(await errorsOf(CreateDropDto, drop({ productsCount: 99999999 }))).toContain('productsCount');
    expect(await errorsOf(CreateDropDto, drop({ productsCount: 0 }))).toContain('productsCount');
    expect(await errorsOf(CreateDropDto, drop({ bannerUrl: 'http://x.com/a.jpg' }))).toContain('bannerUrl');
  });
  it('blocks past launch dates on create and update before touching the database', async () => {
    const prisma: any = { brandDrop: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'd1' }), update: jest.fn() } };
    const svc = new BrandDropsService(prisma);
    await expect(svc.create('b', drop({ launchDate: '2020-01-01T00:00:00Z' }) as any)).rejects.toThrow(BadRequestException);
    await expect(svc.update('b', 'd1', { launchDate: '2020-01-01T00:00:00Z' })).rejects.toThrow(BadRequestException);
    expect(prisma.brandDrop.create).not.toHaveBeenCalled();
    expect(prisma.brandDrop.update).not.toHaveBeenCalled();
  });
});

describe('Garment and prompt validation', () => {
  const garment = { title: 'x', sku: 's', price: 1, images: [], category: 'c', buyUrl: 'https://a.com/p' };
  it('requires https buy links', async () => {
    expect(await errorsOf(CreateGarmentDto, garment)).toEqual([]);
    expect(await errorsOf(CreateGarmentDto, { ...garment, buyUrl: 'http://a.com' })).toContain('buyUrl');
    expect(await errorsOf(UpdateGarmentDto, { buyUrl: 'http://a.com' })).toContain('buyUrl');
    expect(await errorsOf(UpdateGarmentDto, { buyUrl: 'https://a.com' })).toEqual([]);
  });
  it('caps the AI prompt at 300 characters on the server and only accepts known looks and shapes', async () => {
    const base = { presetId: 'studio_turn' };
    expect(await errorsOf(CreateBrandVideoDto, { ...base, prompt: 'a'.repeat(300) })).toEqual([]);
    expect(await errorsOf(CreateBrandVideoDto, { ...base, prompt: 'a'.repeat(3050) })).toContain('prompt');
    expect(await errorsOf(CreateBrandVideoDto, { presetId: 'made_up' })).toContain('presetId');
    expect(await errorsOf(CreateBrandVideoDto, { ...base, aspectRatio: '4:3' })).toContain('aspectRatio');
  });
});

describe('Flagship store needs an address', () => {
  const build = (social: object) => {
    const prisma: any = {
      brand: {
        findUnique: jest.fn().mockResolvedValue({ id: 'b', isDeleted: false, name: 'N', socialLinks: social }),
        update: jest.fn().mockResolvedValue({ id: 'b' }),
      },
    };
    const auth: any = { toProfile: (x: any) => x, getProfile: jest.fn() };
    return { svc: new BrandProfileService(prisma, auth), prisma };
  };
  it('rejects flagship with no address, accepts online-only or an address', async () => {
    await expect(build({}).svc.updateProfile('b', { isOnlineOnly: false, physicalStoreAddress: '  ' })).rejects.toThrow(BadRequestException);
    await expect(build({}).svc.updateProfile('b', { isOnlineOnly: true, physicalStoreAddress: '' })).resolves.toBeTruthy();
    await expect(build({}).svc.updateProfile('b', { isOnlineOnly: false, physicalStoreAddress: 'Lodhi Colony' })).resolves.toBeTruthy();
  });
});

describe('AI Studio never charges when no video engine is connected', () => {
  it('returns 503 and leaves credits untouched', async () => {
    const prisma: any = { $queryRaw: jest.fn(), brandVideo: { count: jest.fn().mockResolvedValue(0), create: jest.fn() } };
    const svc = new BrandVideoService(prisma, {} as any, {} as any);
    svc.engines = [];
    await expect(svc.create('b', { customImageUrl: 'https://x/y.jpg', presetId: 'studio_turn' })).rejects.toThrow(ServiceUnavailableException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.brandVideo.create).not.toHaveBeenCalled();
  });
});
