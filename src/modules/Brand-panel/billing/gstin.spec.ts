import { isValidGstin } from './gstin';

describe('isValidGstin', () => {
  it('accepts well-formed numbers with the right check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('24AAACC1206D1ZM')).toBe(true);
    expect(isValidGstin(' 27aapfu0939f1zv ')).toBe(true);
  });
  it('rejects a wrong check character, shape or length', () => {
    expect(isValidGstin('27AAPFU0939F1ZA')).toBe(false);
    expect(isValidGstin('99AAPFU0939F1ZV')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin('')).toBe(false);
  });
});
