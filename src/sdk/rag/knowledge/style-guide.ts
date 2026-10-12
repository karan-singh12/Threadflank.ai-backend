import { RagDocument } from '../ingestion/loader';

/** Pinecone namespace the Occasion Planner retrieves dress-code rules from. */
export const STYLE_GUIDE_NAMESPACE = 'style';

interface StyleGuideEntry {
  id: string;
  title: string;
  text: string;
}

/**
 * Curated occasion / dress-code knowledge for the Occasion Planner (RAG source).
 * Each entry is one self-contained rule set so a single chunk carries the whole
 * rule. Edit here, then run `npm run rag:ingest:style` to re-index.
 */
const STYLE_GUIDE: StyleGuideEntry[] = [
  // ─── Indian wedding functions ───────────────────────────────────────────────
  {
    id: 'haldi',
    title: 'Haldi ceremony',
    text: 'Daytime, often outdoors, and turmeric paste will stain clothes. Wear yellow, marigold, mustard, lime green or white-with-yellow. Choose light cotton, mulmul or chanderi that you do not mind staining. Women: cotton anarkali, sharara, light lehenga or kurta set. Men: cotton kurta-pyjama, short kurta. Avoid silk, heavy embroidery, velvet and expensive pieces. Flat sandals, kolhapuris or juttis; minimal or floral jewellery.',
  },
  {
    id: 'mehendi',
    title: 'Mehendi ceremony',
    text: 'Daytime or early evening, relaxed and colourful. Green is traditional; bright pinks, oranges, teal and multicolour prints also work. Women: sharara, gharara, short lehenga, or a lightweight anarkali; prefer short or three-quarter sleeves so henna on hands and arms is not smudged. Men: printed or pastel kurta with churidar or pyjama, optional Nehru jacket. Comfortable flats since guests often sit on the floor. Light fabrics: georgette, cotton silk, chanderi.',
  },
  {
    id: 'sangeet',
    title: 'Sangeet night',
    text: 'Evening dance party, the most glamorous pre-wedding function. Sequins, mirror work, metallics, jewel tones and bold colours are welcome. Women: flared lehenga, embellished sharara, indo-western gown, saree with a statement blouse; outfits must allow dancing. Men: embroidered kurta with Nehru jacket, indo-western bandhgala, or a sharp suit. Avoid very long trains or heavy outfits that restrict movement; block heels or embellished juttis over stilettos.',
  },
  {
    id: 'wedding-ceremony',
    title: 'Indian wedding ceremony (pheras / nikah / anand karaj)',
    text: 'Most traditional function; dress respectfully and festively. Women: silk or Banarasi saree, kanjeevaram, rich lehenga or anarkali; heavier jewellery is fine. Men: sherwani, bandhgala, or silk kurta with churidar and stole. As a guest, do not wear bridal red with heavy gold work that competes with the bride. Many traditional families consider all-white or all-black inauspicious at Hindu ceremonies — add colour. For Sikh ceremonies in a gurdwara, carry a scarf or dupatta to cover the head and wear something you can sit cross-legged in. Shoulders and knees covered is the safe default at religious venues.',
  },
  {
    id: 'reception',
    title: 'Wedding reception',
    text: 'Evening, more modern and formal than the ceremony. Women: embellished saree, pre-draped or concept saree, gown, or a glamorous lehenga; pastels, champagne, metallics, deep jewel tones. Men: tuxedo, well-tailored suit, bandhgala or indo-western jacket. Black is generally acceptable at receptions even when avoided at the ceremony. Polished heels or formal shoes, statement but not heavy jewellery.',
  },
  {
    id: 'engagement-roka',
    title: 'Engagement / roka / ring ceremony',
    text: 'Semi-formal family function, sits between sangeet and reception in formality. Pastels, rose gold, ivory with colour accents, and soft jewel tones are popular. Women: light lehenga, saree, anarkali or indo-western set. Men: kurta with Nehru jacket, bandhgala, or a suit without tie. Keep it elegant rather than heavily embellished.',
  },
  {
    id: 'cocktail',
    title: 'Cocktail party',
    text: 'Evening, Western or fusion. Women: cocktail dress at or below knee, jumpsuit, co-ord set, saree gown, or a sleek saree with a modern blouse; metallics, black, wine, emerald. Men: suit or blazer with trousers, open collar or tie, loafers or oxfords; velvet or textured blazers for winter. Avoid casual denim, sneakers and daywear cottons.',
  },
  // ─── Festive and religious ──────────────────────────────────────────────────
  {
    id: 'festive-diwali',
    title: 'Diwali / festive gathering',
    text: 'Bright, celebratory ethnic wear. Gold, red, maroon, royal blue, emerald, mustard and pink. Women: silk saree, anarkali, lehenga, sharara or festive kurta set. Men: silk or brocade kurta, Nehru jacket, bandhgala. Be careful with long loose dupattas, synthetic fabrics and flowing hems near diyas and firecrackers — prefer natural fabrics and secured drapes.',
  },
  {
    id: 'eid',
    title: 'Eid celebration',
    text: 'Festive and modest. Whites, pastels, mint, ivory and soft jewel tones. Women: anarkali, sharara, gharara, salwar kameez with dupatta, or kaftan; covered shoulders and full or three-quarter sleeves. Men: kurta pyjama or pathani suit, optionally with a Nehru jacket; white and pastel kurtas are classic. Mojaris or juttis.',
  },
  {
    id: 'puja-temple',
    title: 'Puja / temple / religious visit',
    text: 'Modest, clean and comfortable. Shoulders and knees covered, avoid short hemlines, sheer fabrics and leather (belts, bags, shoes) at many temples. Cotton or silk saree, salwar kameez, kurta set; men in kurta-pyjama or shirt and trousers. Easy-to-remove footwear since shoes are taken off. Avoid black at many traditional pujas.',
  },
  {
    id: 'funeral',
    title: 'Funeral / condolence / prayer meet',
    text: 'Subdued and respectful. In Hindu, Sikh and Jain traditions wear white, off-white or very pale neutrals; in Christian and Western settings wear black, navy or charcoal. Simple cotton or linen, no embellishment, no bright colours, minimal or no jewellery and makeup. Men: plain white kurta-pyjama or dark suit; women: plain white or pastel salwar kameez or saree, or a dark modest dress.',
  },
  // ─── Western dress codes ────────────────────────────────────────────────────
  {
    id: 'black-tie',
    title: 'Black tie',
    text: 'The most formal evening dress code after white tie. Men: black or midnight-blue tuxedo, white dress shirt, black bow tie, patent or polished oxfords; a black bandhgala with formal trousers is an accepted Indian equivalent. Women: floor-length gown, or a luxurious silk or embellished saree, or a formal lehenga; elegant heels and fine jewellery. Knee-length dresses, lounge suits and casual fabrics are not black tie.',
  },
  {
    id: 'formal-gala',
    title: 'Formal / gala',
    text: 'Formal evening but slightly more flexible than black tie. Men: dark suit (navy, charcoal, black) with tie, or bandhgala. Women: long gown, elegant midi or cocktail dress in luxe fabric, or a rich saree. Satin, silk, velvet and crepe; avoid cotton casualwear and sneakers.',
  },
  {
    id: 'business',
    title: 'Business / work meeting',
    text: 'Polished and conservative. Men: suit or blazer with trousers, collared shirt, tie optional in Indian offices, leather shoes and matching belt. Women: tailored trousers or pencil skirt with blouse, blazer, sheath dress, or a crisp kurta set or cotton-silk saree. Neutrals (navy, grey, beige, white, black) with one muted accent. Avoid loud prints, sequins, distressed denim and open-toe casual sandals.',
  },
  {
    id: 'smart-casual',
    title: 'Smart casual',
    text: 'Relaxed but put-together. Men: chinos or dark jeans with a shirt, polo or fine knit, optional unstructured blazer; loafers, clean sneakers or desert boots. Women: dark jeans or trousers with a nice top, midi dress, co-ord set, or a short kurta with straight pants; block heels, flats or clean sneakers. No athleisure, ripped denim or flip-flops.',
  },
  {
    id: 'casual',
    title: 'Casual outing',
    text: 'Comfort first. Jeans, chinos, shorts in warm weather, t-shirts, casual shirts, sundresses, short kurtis, sneakers and sandals. Dress for the activity: walking-friendly shoes for sightseeing or malls, breathable cottons and linens outdoors.',
  },
  {
    id: 'date-night',
    title: 'Date night',
    text: 'Look intentional but not overdressed for the venue. Fine dining: dress like smart casual to cocktail — slip or wrap dress, satin top with tailored trousers; men in a blazer or well-fitted shirt with chinos and loafers. Casual cafe or movie: dark jeans with a nice top or shirt. One focal point (a colour, a statement earring, a great jacket) beats many competing pieces.',
  },
  {
    id: 'party-night-out',
    title: 'Party / night out',
    text: 'Evening, expressive. Women: mini or midi dress, satin or sequin top with trousers, co-ord set, jumpsuit; heels or statement boots. Men: printed or dark shirt, fitted t-shirt with blazer, dark jeans or trousers, clean sneakers or Chelsea boots. Black, metallics and bold colours; leave daytime cotton prints for the day.',
  },
  // ─── Destination, travel and climate ────────────────────────────────────────
  {
    id: 'beach-destination',
    title: 'Beach / destination wedding (Goa, Kerala, coastal)',
    text: 'Hot and humid, often outdoors on sand. Breathable linen, cotton, organza, georgette and chiffon; pastels, whites with colour, florals and sea tones. Women: light lehenga, ruffle saree, flowy maxi or kaftan. Men: linen kurta, linen shirt with trousers, light suit without tie. Avoid velvet, heavy silk and brocade. Flat sandals or wedges — stilettos sink in sand. Pack sunglasses and waterproof makeup.',
  },
  {
    id: 'desert-palace',
    title: 'Rajasthan / palace destination (Udaipur, Jaipur, Jodhpur)',
    text: 'Regal settings suit rich colours: royal blue, emerald, ruby, mustard and gold, bandhani and leheriya prints, gota patti work. Days are hot most of the year, so prefer lighter fabrics for daytime functions; deserts get cold at night from November to February, so add a shawl, velvet jacket or bandhgala for evening events. Men: safa or bandhgala fits the palace theme.',
  },
  {
    id: 'hill-winter',
    title: 'Winter / hill-station / North India December–February',
    text: 'Plan layers. Velvet, wool, pashmina, brocade and raw silk. Women: velvet lehenga or anarkali, full-sleeve blouse, pashmina shawl over a saree, long coat over a dress, closed shoes or boots. Men: velvet or wool bandhgala, sherwani with a shawl, overcoat over a suit. Darker jewel tones (wine, emerald, navy, bottle green) suit winter evenings.',
  },
  {
    id: 'summer-monsoon',
    title: 'Indian summer and monsoon',
    text: 'Summer (April–June): cotton, linen, mulmul and chanderi in light colours; avoid polyester, velvet and dark heavy outfits for daytime events. Monsoon (July–September): quick-dry fabrics such as georgette, crepe and chiffon; avoid light-coloured fabrics that turn see-through when wet, avoid floor-sweeping hems and suede; waterproof or rubber-soled footwear.',
  },
  {
    id: 'travel',
    title: 'Travel',
    text: 'Comfortable, wrinkle-resistant and layerable. Joggers or stretch trousers, breathable tees, a light jacket or shrug for cold flights, slip-on shoes for airport security. Pack mix-and-match pieces in a shared colour palette so fewer items make more outfits.',
  },
  // ─── Cross-cutting rules ────────────────────────────────────────────────────
  {
    id: 'guest-etiquette',
    title: 'Guest etiquette and colour rules',
    text: 'Never outshine the host or the bride: as a wedding guest avoid bridal red-and-gold heavy lehengas and all-white gowns at Western weddings. Match the formality of the venue and time: daytime is lighter in colour and fabric, evening allows darker tones, shine and embellishment. When the dress code is unclear, aim one level above casual. Dress codes printed on an invite override general rules.',
  },
  {
    id: 'budget-gap-items',
    title: 'Completing a look on a budget',
    text: 'When an outfit is missing a piece, prioritise high-impact, re-wearable accessories: statement earrings, a potli or clutch, a dupatta or stole, juttis, a belt, a pocket square or a Nehru jacket that elevates an existing kurta. One versatile Nehru jacket or embroidered dupatta can upgrade many plain outfits. Prefer gap items that work for several upcoming events.',
  },
];

/** Style guide entries as ingestable RAG documents (the title is part of the embedded text). */
export function styleGuideDocuments(): RagDocument[] {
  return STYLE_GUIDE.map((entry) => ({
    sourceType: 'style-guide',
    sourceId: entry.id,
    text: `${entry.title}: ${entry.text}`,
    metadata: { title: entry.title },
  }));
}
