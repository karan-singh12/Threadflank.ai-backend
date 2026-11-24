/**
 * Indian festivals and wedding seasons, so brands can plan edits ahead (blueprint 3.6). Fixed-date
 * days are exact; lunar festivals move every year and are marked `approximate` (the panel says
 * "around"). Admins run the actual platform campaigns; this list only helps brands plan. Extend it
 * once a year.
 */
export interface FestivalDate {
  id: string;
  name: string;
  kind: 'festival' | 'wedding_season';
  /** YYYY-MM-DD. */
  start: string;
  end?: string;
  approximate: boolean;
  /** An occasion from the admin list this matches, for "tag your pieces" hints. */
  occasion?: string;
}

const F = (id: string, name: string, start: string, approximate: boolean, occasion?: string, end?: string): FestivalDate => ({ id, name, kind: 'festival', start, approximate, ...(occasion ? { occasion } : {}), ...(end ? { end } : {}) });
const W = (id: string, start: string, end: string): FestivalDate => ({ id, name: 'Wedding season', kind: 'wedding_season', start, end, approximate: true, occasion: 'Wedding' });

export const FESTIVALS: FestivalDate[] = [
  F('dhanteras-2026', 'Dhanteras', '2026-11-06', true, 'Diwali'),
  F('diwali-2026', 'Diwali', '2026-11-08', true, 'Diwali'),
  F('bhai-dooj-2026', 'Bhai Dooj', '2026-11-11', true),
  F('chhath-2026', 'Chhath Puja', '2026-11-15', true),
  W('weddings-2026-winter', '2026-11-20', '2026-12-15'),
  F('christmas-2026', 'Christmas', '2026-12-25', false),
  F('lohri-2027', 'Lohri', '2027-01-13', false),
  F('sankranti-2027', 'Makar Sankranti & Pongal', '2027-01-14', true),
  W('weddings-2027-spring', '2027-01-15', '2027-03-10'),
  F('republic-day-2027', 'Republic Day', '2027-01-26', false),
  F('valentines-2027', "Valentine's Day", '2027-02-14', false, 'Date Night'),
  F('shivratri-2027', 'Maha Shivratri', '2027-03-06', true),
  F('eid-fitr-2027', 'Eid al-Fitr', '2027-03-10', true, 'Eid'),
  F('holi-2027', 'Holi', '2027-03-22', true, 'Holi'),
  F('baisakhi-2027', 'Baisakhi', '2027-04-14', false),
  W('weddings-2027-summer', '2027-04-15', '2027-06-30'),
  F('akshaya-tritiya-2027', 'Akshaya Tritiya', '2027-05-09', true),
  F('eid-adha-2027', 'Eid al-Adha', '2027-05-17', true, 'Eid'),
  F('teej-2027', 'Hariyali Teej', '2027-08-05', true, 'Teej'),
  F('independence-2027', 'Independence Day', '2027-08-15', false),
  F('rakhi-2027', 'Raksha Bandhan', '2027-08-17', true),
  F('janmashtami-2027', 'Janmashtami', '2027-08-25', true),
  F('ganesh-2027', 'Ganesh Chaturthi', '2027-09-04', true),
  F('navratri-2027', 'Navratri', '2027-09-30', true, 'Navratri', '2027-10-08'),
  F('dussehra-2027', 'Dussehra', '2027-10-09', true),
  F('karva-chauth-2027', 'Karva Chauth', '2027-10-18', true, 'Karva Chauth'),
  F('diwali-2027', 'Diwali', '2027-10-29', true, 'Diwali'),
  W('weddings-2027-winter', '2027-11-10', '2027-12-15'),
  F('christmas-2027', 'Christmas', '2027-12-25', false),
];

/** Festivals whose day (or season) hasn't ended yet, within the next `days` days, soonest first. */
export function upcomingFestivals(now = new Date(), days = 365): FestivalDate[] {
  const today = now.toISOString().slice(0, 10);
  const until = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return FESTIVALS.filter((f) => (f.end ?? f.start) >= today && f.start <= until).sort((a, b) => a.start.localeCompare(b.start));
}
