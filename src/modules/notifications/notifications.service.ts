import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PushNotificationGateway } from "./gateways/push-notification.gateway";

export interface NotificationInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly pushGateway: PushNotificationGateway,
    private readonly prisma: PrismaService,
  ) {}

  /** Sends a generic socket notification to a specific user */
  async sendNotification(userId: string, event: string, payload: Record<string, any>) {
    this.pushGateway.notify(userId, event, payload);
  }

  /** Sends a socket notification for a new friend request */
  async sendFriendRequestNotification(targetUserId: string, request: Record<string, any>) {
    this.pushGateway.notifyFriendRequest(targetUserId, request);
  }

  /** Sends a socket notification for a accepted friend request */
  async sendFriendAcceptedNotification(targetUserId: string, friendship: Record<string, any>) {
    this.pushGateway.notifyFriendAccepted(targetUserId, friendship);
  }

  /** Sends a socket notification for a new message */
  async sendNewMessageNotification(targetUserId: string, message: Record<string, any>) {
    this.pushGateway.notifyNewMessage(targetUserId, message);
  }

  /**
   * Stores an in-app notification (so it survives being offline) and pushes it
   * live as `notification:new`. Never throws — a failed notification must not
   * break the action that triggered it.
   */
  async create(userId: string, input: NotificationInput) {
    try {
      const row = await this.prisma.notification.create({
        data: {
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          data: (input.data as any) ?? undefined,
        },
      });
      this.pushGateway.notify(userId, "notification:new", { notification: row });
      return row;
    } catch {
      return null;
    }
  }

  async createMany(userIds: string[], input: NotificationInput) {
    await Promise.all([...new Set(userIds)].map((id) => this.create(id, input)));
  }

  async list(userId: string, limit = 30) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: Math.min(limit, 100),
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
