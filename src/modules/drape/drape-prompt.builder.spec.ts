import 'reflect-metadata';
import { GarmentSlot } from './dto/tryon.dto';
import { GroupDrapeDto, PersonSpecDto } from './dto/group-drape.dto';
import { buildGroupPrompt, buildOnePassGroupPrompt, buildPersonPrompt, groupImageCount, normalisePieces, resolvePosture } from './drape-prompt.builder';

const person = (over: Partial<PersonSpecDto> = {}): PersonSpecDto => ({
    ref: 'me',
    name: 'Karan',
    relation: 'You',
    twinImage: 'data:image/png;base64,TWIN',
    body: { gender: 'male', age: 28, heightCm: 178 },
    outfit: [],
    ...over,
});

describe('drape prompt builder', () => {
    describe('resolvePosture', () => {
        it('reads a partner as a couple', () => {
            expect(resolvePosture([person(), person({ ref: 'a', name: 'Priya', relation: 'Partner' })])).toBe('couple');
        });

        it('reads parents or children as a family', () => {
            const people = [person(), person({ ref: 'a', relation: 'Parent' }), person({ ref: 'b', relation: 'Friend' })];
            expect(resolvePosture(people)).toBe('family');
        });

        it('reads all siblings as siblings and anyone else as friends', () => {
            expect(resolvePosture([person(), person({ ref: 'a', relation: 'Sibling' })])).toBe('siblings');
            expect(resolvePosture([person(), person({ ref: 'a', relation: 'Friend' })])).toBe('friends');
        });

        it('lets an explicit posture win and skips single people', () => {
            expect(resolvePosture([person(), person({ ref: 'a', relation: 'Partner' })], 'walking')).toBe('walking');
            expect(resolvePosture([person()])).toBeNull();
        });
    });

    it('drops top and bottom when a dress is chosen', () => {
        const pieces = normalisePieces([
            { slot: GarmentSlot.TOP, image: 'top' },
            { slot: GarmentSlot.DRESS, description: 'red saree' },
            { slot: GarmentSlot.SHOES, image: 'shoes' },
            { slot: GarmentSlot.BAG },
        ]);
        expect(pieces.map((p) => p.slot)).toEqual([GarmentSlot.DRESS, GarmentSlot.SHOES]);
    });

    it('numbers each garment image after the twin', () => {
        const job = buildPersonPrompt(
            person({
                outfit: [
                    { slot: GarmentSlot.TOP, image: 'top.png', label: 'Linen shirt' },
                    { slot: GarmentSlot.BOTTOM, description: 'white churidar' },
                    { slot: GarmentSlot.SHOES, image: 'shoes.png' },
                ],
            }),
        );
        expect(job.images).toEqual(['data:image/png;base64,TWIN', 'top.png', 'shoes.png']);
        expect(job.prompt).toContain('Image 1 shows Karan, a 28-year-old man, 178 cm tall');
        expect(job.prompt).toContain('Top "Linen shirt" (Image 2)');
        expect(job.prompt).toContain('Footwear (Image 3)');
        expect(job.prompt).toContain('white churidar');
    });

    it('renders a plain backdrop for a group member, and places a single person straight into the scene', () => {
        const outfit = [{ slot: GarmentSlot.TOP, image: 'top.png' }];
        const plain = buildPersonPrompt(person({ outfit }));
        expect(plain.prompt).toContain('plain light-grey seamless studio background');

        const inScene = buildPersonPrompt(person({ outfit }), undefined, { name: 'Sunlit Terrace', imageUrl: 'terrace.jpg' });
        expect(inScene.images).toEqual(['data:image/png;base64,TWIN', 'top.png', 'terrace.jpg']);
        expect(inScene.prompt).toContain('Image 3 (Sunlit Terrace)');
        expect(inScene.prompt).not.toContain('light-grey seamless');
    });

    it('renders the whole group in one request, each piece numbered under its own person', () => {
        const dto: GroupDrapeDto = {
            people: [
                person({ outfit: [{ slot: GarmentSlot.TOP, image: 'kurta.png', label: 'Linen kurta' }, { slot: GarmentSlot.SHOES, description: 'tan juttis' }] }),
                person({ ref: 'a', name: 'Priya', relation: 'Partner', twinImage: 'priya.png', body: { gender: 'female', heightCm: 165 }, outfit: [{ slot: GarmentSlot.DRESS, image: 'saree.png' }] }),
            ],
            scene: { name: 'Haveli courtyard', imageUrl: 'scene.jpg' },
        };
        expect(groupImageCount(dto)).toBe(5);
        const job = buildOnePassGroupPrompt(dto);
        expect(job.images).toEqual(['data:image/png;base64,TWIN', 'kurta.png', 'priya.png', 'saree.png', 'scene.jpg']);
        expect(job.prompt).toContain('Person 1: Karan');
        expect(job.prompt).toContain('exactly as in Image 1');
        expect(job.prompt).toContain('Top "Linen kurta" from Image 2');
        expect(job.prompt).toContain('tan juttis');
        expect(job.prompt).toContain('Person 2: Priya (partner)');
        expect(job.prompt).toContain('exactly as in Image 3');
        expect(job.prompt).toContain('Full outfit from Image 4');
        expect(job.prompt).toContain('Image 5 (Haveli courtyard)');
        expect(job.prompt).toContain('They are a couple');
    });

    it('composes the group with the posture for their relation and the scene image last', () => {
        const dto: GroupDrapeDto = {
            people: [person(), person({ ref: 'a', name: 'Priya', relation: 'Partner', body: { gender: 'female', heightCm: 165 } })],
            scene: { name: 'Haveli courtyard', imageUrl: 'scene.jpg' },
        };
        const job = buildGroupPrompt(dto, ['karan.png', 'priya.png']);
        expect(job.images).toEqual(['karan.png', 'priya.png', 'scene.jpg']);
        expect(job.prompt).toContain('exactly 2 people');
        expect(job.prompt).toContain('2. Priya (partner): exactly as in Image 2, 165 cm tall.');
        expect(job.prompt).toContain('They are a couple');
        expect(job.prompt).toContain('Image 3 (Haveli courtyard)');
        expect(job.prompt).toContain('relative heights');
    });
});
