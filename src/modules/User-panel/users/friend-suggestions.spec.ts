import { UsersService } from './users.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

/**
 * Friend suggestions are rendered by three clients — the web panel, the phone app and the brand
 * panel — and all three read them as a FriendUser and send the request by username or email. When
 * this endpoint answered with `{ name, detail }` instead, the web panel's Suggested tab threw on
 * `(undefined)[0]` and took the Messages page down, and no client could add a suggested person.
 */
describe('UsersService.getFriendSuggestions', () => {
  const rows = [
    { id: 'u2', email: 'asha@example.com', username: 'asha', avatar: null, bio: 'Saree stylist' },
    { id: 'u3', email: 'ravi@example.com', username: null, avatar: '/a/ravi.png', bio: null },
  ];

  const build = (friendships: { senderId: string; receiverId: string }[] = []) => {
    const userFindMany = jest.fn().mockResolvedValue(rows);
    const prisma = {
      friendship: { findMany: jest.fn().mockResolvedValue(friendships) },
      user: { findMany: userFindMany },
    } as unknown as PrismaService;
    const service = new UsersService(prisma, {} as NotificationsService);
    return { service, userFindMany };
  };

  it('returns each suggestion as a FriendUser, with the fields the clients read', async () => {
    const { service } = build();
    const out = await service.getFriendSuggestions('u1');

    expect(out).toEqual(rows);
    for (const s of out) {
      expect(Object.keys(s).sort()).toEqual(['avatar', 'bio', 'email', 'id', 'username']);
    }
  });

  it('gives every suggestion something to send the request by, even without a username', async () => {
    const { service } = build();
    const out = await service.getFriendSuggestions('u1');

    for (const s of out) expect(s.username || s.email).toBeTruthy();
  });

  it('leaves out the caller and anyone already a friend or with a request either way', async () => {
    const { service, userFindMany } = build([
      { senderId: 'u1', receiverId: 'u7' },
      { senderId: 'u8', receiverId: 'u1' },
    ]);
    await service.getFriendSuggestions('u1');

    const excluded = userFindMany.mock.calls[0][0].where.id.notIn as string[];
    expect(new Set(excluded)).toEqual(new Set(['u1', 'u7', 'u8']));
  });
});
