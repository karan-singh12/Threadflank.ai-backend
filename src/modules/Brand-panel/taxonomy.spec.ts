import { BadRequestException, ConflictException } from '@nestjs/common';
import { TaxonomyService, slugOf } from './taxonomy/taxonomy.service';

const entry = (name: string, over: object = {}) => ({ id: `id-${name}`, kind: 'CATEGORY', name, slug: slugOf(name), sortOrder: 0, isActive: true, ...over });

function build(rows: any[]) {
  const prisma: any = {
    discoverCategory: {
      findMany: jest.fn().mockResolvedValue(rows),
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 4 } }),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', ...data })),
    },
  };
  return { svc: new TaxonomyService(prisma), prisma };
}

describe('slugOf', () => {
  it('matches names however they are typed', () => {
    expect(slugOf('Navratri Men')).toBe('navratri-men');
    expect(slugOf('  navratri   MEN ')).toBe('navratri-men');
    expect(slugOf('Suits & Sets')).toBe('suits-and-sets');
    expect(slugOf('Navratri / Garba')).toBe('navratri-garba');
    expect(slugOf('!!!')).toBe('');
  });
});

describe('a piece must use a category the admin listed', () => {
  it('returns the admin\'s exact spelling for any casing', async () => {
    const { svc } = build([entry('Navratri Men'), entry('Streetwear')]);
    expect(await svc.requireCategory('navratri  men')).toBe('Navratri Men');
    expect(await svc.requireCategory('STREETWEAR')).toBe('Streetwear');
  });
  it('rejects one that is not in the list and names the choices', async () => {
    const { svc } = build([entry('Denim'), entry('Streetwear')]);
    await expect(svc.requireCategory('Haute Couture')).rejects.toThrow(BadRequestException);
    await expect(svc.requireCategory('Haute Couture')).rejects.toThrow(/Denim, Streetwear/);
  });
  it('accepts anything before an admin has set up any list (fresh install)', async () => {
    expect(await build([]).svc.requireCategory('  Anything  ')).toBe('Anything');
  });
  it('only active entries count: a turned-off category is refused', async () => {
    const { svc, prisma } = build([entry('Denim')]);
    await svc.requireCategory('Denim');
    expect(prisma.discoverCategory.findMany.mock.calls[0][0].where).toEqual({ kind: 'CATEGORY', isActive: true });
  });
  it('occasions are checked one by one and de-duplicated', async () => {
    const { svc } = build([entry('Haldi', { kind: 'OCCASION' }), entry('Mehendi', { kind: 'OCCASION' })]);
    expect(await svc.requireOccasions(['haldi', 'HALDI', 'Mehendi'])).toEqual(['Haldi', 'Mehendi']);
    await expect(svc.requireOccasions(['Haldi', 'Garba'])).rejects.toThrow(/Garba/);
  });
});

describe('admin list', () => {
  it('adds to the end and refuses a duplicate in a different casing', async () => {
    const { svc, prisma } = build([]);
    const row = await svc.create('CATEGORY', '  Office   Chic ');
    expect(row).toMatchObject({ name: 'Office Chic', slug: 'office-chic', sortOrder: 5 });
    prisma.discoverCategory.findUnique.mockResolvedValue({ id: 'x' });
    await expect(svc.create('CATEGORY', 'office chic')).rejects.toThrow(ConflictException);
    await expect(svc.create('CATEGORY', '***')).rejects.toThrow(BadRequestException);
  });
});
