import { BrandAccountRole } from '@prisma/client';

/**
 * What each brand role may do, decided from the route alone so every /brand/* endpoint is covered
 * by the guard without per-controller annotations.
 *
 *   OWNER    everything, including billing and the team
 *   MANAGER  everything except billing and the team (those endpoints check for the owner themselves)
 *   CONTENT  creates and edits content: catalog, AI Studio, launches, store page, community, campaign picks
 *   ANALYST  read-only, including deep insights, payment history and invoices
 *   VIEWER   read-only, without deep insights or billing
 *
 * Every role may manage its own sign-in (change password, see itself).
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Areas (the first path segment after /brand/) a CONTENT member may change. */
const CONTENT_WRITABLE = new Set(['catalog', 'ai-studio', 'drops', 'store', 'community', 'campaigns', 'upload', 'taxonomy']);

/** Areas only some roles may even read. */
const VIEWER_HIDDEN = ['billing', 'analytics/insights', 'analytics/missed-pieces'];
const CONTENT_HIDDEN = ['billing'];

export const ROLE_LABELS: Record<BrandAccountRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  CONTENT: 'Content',
  ANALYST: 'Analyst',
  VIEWER: 'Viewer',
};

/** The roles an owner can give a teammate. */
export const ASSIGNABLE_ROLES = ['MANAGER', 'CONTENT', 'ANALYST', 'VIEWER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** "/api/brand/catalog/abc?x=1" → "catalog/abc". Empty when the path is not under /brand/. */
export function brandArea(url: string): string {
  const path = url.split('?')[0];
  const at = path.indexOf('/brand/');
  return at < 0 ? '' : path.slice(at + '/brand/'.length).replace(/\/+$/, '');
}

const under = (area: string, prefix: string) => area === prefix || area.startsWith(prefix + '/');

/** Null when allowed, or the message to refuse with. */
export function roleRefusal(role: BrandAccountRole, method: string, url: string): string | null {
  const area = brandArea(url);
  // Everyone manages their own sign-in.
  if (under(area, 'auth')) return null;
  const read = READ_METHODS.has(method.toUpperCase());
  const top = area.split('/')[0];

  switch (role) {
    case 'OWNER':
    case 'MANAGER':
      return null;
    case 'CONTENT':
      if (CONTENT_HIDDEN.some((p) => under(area, p))) return 'Billing is for the brand owner.';
      if (read || CONTENT_WRITABLE.has(top)) return null;
      return 'Your Content role can edit the catalog, AI Studio, launches, store page and community. Ask the brand owner for more access.';
    case 'ANALYST':
      // Recording a click from the panel's own links is not a change to the brand.
      if (read || area === 'analytics/track-click') return null;
      return 'Your Analyst role is view-only. Ask the brand owner for more access.';
    case 'VIEWER':
      if (VIEWER_HIDDEN.some((p) => under(area, p))) return 'Your Viewer role can’t open this. Ask the brand owner for Analyst access.';
      if (read || area === 'analytics/track-click') return null;
      return 'Your role is view-only. Ask the brand owner for more access.';
    default:
      return 'Your role can’t do that.';
  }
}
