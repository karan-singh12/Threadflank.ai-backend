import { privateR2Key } from './r2-objects';

const ACCOUNT = '0123456789abcdef0123456789abcdef';

describe('privateR2Key', () => {
    it('reads the key after the bucket when the bucket is in the path', () => {
        expect(privateR2Key(`https://${ACCOUNT}.r2.cloudflarestorage.com/outfit-checker/twin-images/1759-me.png`)).toBe('twin-images/1759-me.png');
    });

    it('reads the whole path when the bucket is in the hostname', () => {
        expect(privateR2Key(`https://outfit-checker.${ACCOUNT}.r2.cloudflarestorage.com/looks/1759-look.png`)).toBe('looks/1759-look.png');
    });

    it('ignores public and other URLs', () => {
        expect(privateR2Key('https://pub-abc.r2.dev/looks/1759-look.png')).toBeNull();
        expect(privateR2Key('https://example.com/a.png')).toBeNull();
        expect(privateR2Key('/public/twins/a.png')).toBeNull();
        expect(privateR2Key('data:image/png;base64,AAAA')).toBeNull();
    });
});
