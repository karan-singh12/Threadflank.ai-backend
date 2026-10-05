import { GarmentSlot } from './dto/tryon.dto';
import { GroupDrapeDto, GroupPosture, OutfitPieceDto, PersonSpecDto, SceneSpecDto } from './dto/group-drape.dto';

/**
 * Turns the Drape form (an array of people, each with a twin and outfit pieces) into
 * Gemini prompts. Pure functions so the wording can be unit-tested.
 *
 * A group is rendered in one request (`buildOnePassGroupPrompt`) when its images fit; larger groups use two passes:
 *  1. `buildPersonPrompt`: dress each twin alone on a plain backdrop.
 *  2. `buildGroupPrompt`: compose the dressed people into one photo, posed for their relation.
 */

export type PromptJob = { prompt: string; images: string[] };

const SLOT_NAMES: Record<GarmentSlot, string> = {
    [GarmentSlot.TOP]: 'Top',
    [GarmentSlot.BOTTOM]: 'Bottom',
    [GarmentSlot.DRESS]: 'Full outfit',
    [GarmentSlot.SHOES]: 'Footwear',
    [GarmentSlot.EYEWEAR]: 'Eyewear',
    [GarmentSlot.HEADWEAR]: 'Headwear',
    [GarmentSlot.BAG]: 'Bag',
    [GarmentSlot.JEWELRY]: 'Jewellery',
};

const SLOT_WEAR: Record<GarmentSlot, string> = {
    [GarmentSlot.TOP]: 'worn on the upper body',
    [GarmentSlot.BOTTOM]: 'worn on the lower body',
    [GarmentSlot.DRESS]: 'a full-length outfit replacing both top and bottom',
    [GarmentSlot.SHOES]: 'worn on the feet',
    [GarmentSlot.EYEWEAR]: 'worn on the face',
    [GarmentSlot.HEADWEAR]: 'worn on the head',
    [GarmentSlot.BAG]: 'carried naturally in hand or on the shoulder',
    [GarmentSlot.JEWELRY]: 'worn naturally',
};

/** How each group posture should look in the final photo. */
export const POSTURE_PROMPTS: Record<Exclude<GroupPosture, 'auto'>, string> = {
    couple:
        'They are a couple. They stand close together with their bodies angled slightly towards each other, one arm around the other\'s waist or their hands held, heads tilted in a little, with warm, affectionate, relaxed smiles. Keep it natural and tasteful, as in an engagement shoot.',
    friends:
        'They are close friends. They stand side by side, shoulder to shoulder, some with an arm casually over a friend\'s shoulder and others with a hand in a pocket. Candid laughs and easy, playful energy, as in a street-style photo.',
    family:
        'This is a family portrait. Arrange them warmly: adults at the back or centre, children in front or held close, hands resting on shoulders, everyone facing the camera with gentle smiles.',
    siblings:
        'They are siblings. They show comfortable, playful closeness, leaning into each other with an arm around a shoulder and easy laughter.',
    formal:
        'This is a formal group photo. Everyone stands upright in a neat row, evenly spaced and facing the camera, with composed, confident expressions.',
    walking:
        'They walk together towards the camera mid-stride and in step, with natural fabric movement, as in a runway or street-style shot.',
    seated:
        'Arrange them seated on a simple bench or steps, with anyone extra standing behind. Every full outfit, including footwear, stays visible.',
};

const isSelf = (p: PersonSpecDto) => p.ref === 'me' || p.relation?.toLowerCase() === 'you';

/**
 * Picks the group posture. An explicit choice wins; `auto` reads the relations
 * the owner gave each circle member (Partner → couple, Parent/Child → family…).
 */
export function resolvePosture(people: PersonSpecDto[], posture: GroupPosture = 'auto'): Exclude<GroupPosture, 'auto'> | null {
    if (people.length < 2) return null;
    if (posture !== 'auto') return posture;

    const relations = people.filter((p) => !isSelf(p)).map((p) => (p.relation ?? '').toLowerCase());
    if (people.length === 2 && relations.some((r) => ['partner', 'spouse', 'wife', 'husband', 'girlfriend', 'boyfriend', 'fiance', 'fiancé', 'fiancée'].includes(r))) {
        return 'couple';
    }
    if (relations.some((r) => ['parent', 'child', 'family', 'mother', 'father', 'son', 'daughter'].includes(r))) return 'family';
    if (relations.length > 0 && relations.every((r) => r === 'sibling')) return 'siblings';
    return 'friends';
}

/** "a 28-year-old man, 178 cm, 72 kg, honey (#c68642) skin tone" from whatever details exist. */
export function describeBody(person: PersonSpecDto): string {
    const b = person.body ?? {};
    const gender = b.gender?.toLowerCase();
    const noun = gender === 'male' ? 'man' : gender === 'female' ? 'woman' : 'person';
    const parts = [b.age ? `a ${b.age}-year-old ${noun}` : `a ${noun}`];
    if (b.heightCm) parts.push(`${b.heightCm} cm tall`);
    if (b.weightKg) parts.push(`${b.weightKg} kg`);
    if (b.skinTone) parts.push(`${b.skinTone} skin tone`);
    return parts.join(', ');
}

/** A dress replaces both top and bottom, so those slots are dropped when one is present. */
export function normalisePieces(pieces: OutfitPieceDto[]): OutfitPieceDto[] {
    const usable = pieces.filter((p) => p.image || p.description?.trim());
    const hasDress = usable.some((p) => p.slot === GarmentSlot.DRESS);
    return hasDress ? usable.filter((p) => p.slot !== GarmentSlot.TOP && p.slot !== GarmentSlot.BOTTOM) : usable;
}

/**
 * The setting line for the final photo. A scene photo is added to `images` (so it is numbered
 * after the people and garments); without one, the scene is described by name.
 */
function sceneRule(scene: SceneSpecDto | undefined, images: string[]): string {
    if (scene?.imageUrl) {
        images.push(scene.imageUrl);
        return `Place them in the setting shown in Image ${images.length} (${scene.name}). Match its perspective, light direction and colour temperature, with natural contact shadows on the ground. Don't copy any people from that image.`;
    }
    if (scene?.name) {
        const category = scene.category && scene.category !== scene.name ? `, ${scene.category.toLowerCase()}` : '';
        return `Setting: ${scene.name}${category}. Render it as a real photographic location that suits the outfits.`;
    }
    return 'Setting: a clean, softly lit photo studio.';
}

/**
 * Pass 1: dress one twin in all of their pieces. In a group this is a plain-backdrop render that
 * pass 2 composes; for a single person `scene` is given and this is the final photo, in the scene.
 */
export function buildPersonPrompt(person: PersonSpecDto, styling?: string, scene?: SceneSpecDto): PromptJob {
    const pieces = normalisePieces(person.outfit);
    const images = [person.twinImage];
    const lines: string[] = [];

    for (const piece of pieces) {
        const name = SLOT_NAMES[piece.slot];
        const label = piece.label ? ` "${piece.label}"` : '';
        let line: string;
        if (piece.image) {
            images.push(piece.image);
            line = `- ${name}${label} (Image ${images.length}), ${SLOT_WEAR[piece.slot]}. Reproduce it exactly: colour, print, fabric, texture, neckline, sleeves, length and fit.`;
            if (piece.description?.trim()) line += ` Details: ${piece.description.trim()}.`;
        } else {
            line = `- ${name}${label}, ${SLOT_WEAR[piece.slot]}: ${piece.description!.trim()}.`;
        }
        if (piece.drape?.trim()) line += ` ${piece.drape.trim()}`;
        lines.push(line);
    }

    const covered = new Set(pieces.map((p) => p.slot));
    const keepsOwn = covered.has(GarmentSlot.DRESS) || (covered.has(GarmentSlot.TOP) && covered.has(GarmentSlot.BOTTOM))
        ? 'For any part of the outfit not listed (such as footwear), choose simple items that suit the look.'
        : 'Keep any clothing not replaced by the list above as it is in Image 1.';

    const prompt = [
        `Virtual try-on photograph. Image 1 shows ${person.name}, ${describeBody(person)}.`,
        `Dress this exact person in the following pieces:`,
        ...lines,
        keepsOwn,
        'Keep their face, facial features, expression, hairstyle, hair colour, skin tone, body shape and proportions identical to Image 1. This must be clearly the same person.',
        person.notes?.trim() ? `Styling for ${person.name}: ${person.notes.trim()}.` : '',
        styling?.trim() ? `Overall styling: ${styling.trim()}.` : '',
        scene
            ? `${sceneRule(scene, images)} Output one full-body photo of this person alone: head to feet in frame, standing naturally, lit by the scene's own light as one coherent photograph. Photorealistic, high detail, with no text or watermark.`
            : 'Output one full-body photo of this person alone: head to feet in frame, standing naturally facing the camera, on a plain light-grey seamless studio background with soft, even lighting. Photorealistic, high detail, with no text or watermark.',
    ]
        .filter(Boolean)
        .join('\n');

    return { prompt, images };
}

/** Every reference image a one-request group render sends: each twin, each photographed piece, and the scene. */
export function groupImageCount(dto: GroupDrapeDto): number {
    const pieces = dto.people.reduce((n, p) => n + normalisePieces(p.outfit).filter((o) => o.image).length, 0);
    return dto.people.length + pieces + (dto.scene?.imageUrl ? 1 : 0);
}

/**
 * The whole group in one request: each person's twin followed by their own outfit pieces,
 * then the scene. The prompt lists every person (from the Drape form's array of people) with
 * the image numbers that belong to them, so each piece lands on the right person.
 */
export function buildOnePassGroupPrompt(dto: GroupDrapeDto): PromptJob {
    const people = dto.people;
    const images: string[] = [];
    const posture = resolvePosture(people, dto.posture ?? 'auto') ?? 'friends';

    const roster = people.map((person, i) => {
        images.push(person.twinImage);
        const twinImage = images.length;
        const relation = isSelf(person) ? '' : person.relation ? ` (${person.relation.toLowerCase()})` : '';
        const pieces = normalisePieces(person.outfit).map((piece) => {
            const label = piece.label ? ` "${piece.label}"` : '';
            let line: string;
            if (piece.image) {
                images.push(piece.image);
                line = `${SLOT_NAMES[piece.slot]}${label} from Image ${images.length}, ${SLOT_WEAR[piece.slot]}`;
                if (piece.description?.trim()) line += ` (${piece.description.trim()})`;
            } else {
                line = `${SLOT_NAMES[piece.slot]}${label}, ${SLOT_WEAR[piece.slot]}: ${piece.description!.trim()}`;
            }
            return piece.drape?.trim() ? `${line}. ${piece.drape.trim()}` : line;
        });
        const covered = new Set(normalisePieces(person.outfit).map((p) => p.slot));
        const rest = pieces.length === 0
            ? 'keeps the clothes they wear in their image'
            : covered.has(GarmentSlot.DRESS) || (covered.has(GarmentSlot.TOP) && covered.has(GarmentSlot.BOTTOM))
              ? 'anything not listed (such as footwear) is simple and suits the look'
              : 'any clothing not listed stays as in their image';
        return [
            `Person ${i + 1}: ${person.name}${relation}, ${describeBody(person)}. Face, hair, skin tone and body exactly as in Image ${twinImage}.`,
            pieces.length ? `  Wears: ${pieces.join('; ')}. Reproduce each piece exactly: colour, print, fabric, texture, neckline, sleeves, length and fit; ${rest}.` : `  ${rest[0].toUpperCase()}${rest.slice(1)}.`,
            person.notes?.trim() ? `  Styling for ${person.name}: ${person.notes.trim()}.` : '',
        ]
            .filter(Boolean)
            .join('\n');
    });

    const heights = people.filter((p) => p.body?.heightCm);
    const heightRule = heights.length >= 2 ? 'Keep their real relative heights from the details above, so taller people stand taller in the frame.' : '';

    const prompt = [
        `Create one photorealistic group photograph of exactly ${people.length} people together in the same place, captured in a single shot. From left to right:`,
        ...roster,
        'Each person must clearly be the same person as in their own image. Every garment goes only on the person it is listed for: never swap or blend clothes between people, and never add or remove anyone.',
        POSTURE_PROMPTS[posture],
        heightRule,
        sceneRule(dto.scene, images),
        'Light everyone with the same light source, as one coherent photograph rather than a collage. Show full bodies head to feet, shot at eye level with a 35mm lens and a fashion-editorial finish, with no text or watermark.',
        dto.styling?.trim() ? `Styling notes: ${dto.styling.trim()}.` : '',
    ]
        .filter(Boolean)
        .join('\n');

    return { prompt, images };
}

/**
 * Pass 2: put the dressed people into one photo, posed for their relation, in the scene.
 * `dressed[i]` is the pass-1 render (or the bare twin) of `dto.people[i]`.
 */
export function buildGroupPrompt(dto: GroupDrapeDto, dressed: string[]): PromptJob {
    const people = dto.people;
    const images = [...dressed];
    const posture = resolvePosture(people, dto.posture ?? 'auto') ?? 'friends';

    const roster = people.map((p, i) => {
        const relation = isSelf(p) ? '' : p.relation ? ` (${p.relation.toLowerCase()})` : '';
        const height = p.body?.heightCm ? `, ${p.body.heightCm} cm tall` : '';
        return `${i + 1}. ${p.name}${relation}: exactly as in Image ${i + 1}${height}.`;
    });

    const heights = people.filter((p) => p.body?.heightCm);
    const heightRule =
        heights.length >= 2 ? 'Keep their real relative heights from the numbers above, so taller people stand taller in the frame.' : '';

    const prompt = [
        `Create one photorealistic group photograph of exactly ${people.length} people together in the same place, captured in a single shot.`,
        `Images 1 to ${people.length} each show one of them, already dressed. From left to right:`,
        ...roster,
        'Each person keeps exactly their face, hairstyle, skin tone, body shape and every garment, colour, print, fabric and accessory from their own image. Never swap or blend clothes between people, and never add or remove anyone.',
        POSTURE_PROMPTS[posture],
        heightRule,
        sceneRule(dto.scene, images),
        'Light everyone with the same light source, as one coherent photograph rather than a collage. Show full bodies head to feet, shot at eye level with a 35mm lens and a fashion-editorial finish, with no text or watermark.',
        dto.styling?.trim() ? `Styling notes: ${dto.styling.trim()}.` : '',
    ]
        .filter(Boolean)
        .join('\n');

    return { prompt, images };
}
