import { Injectable } from '@nestjs/common';
import { RedisService } from '../../cache/redis.service';
import { ChatMessage } from '../core/providers/provider.types';

const DEFAULT_TTL_SECONDS = 60 * 60; // 1h
const MAX_MESSAGES = 20;

/** Short-lived per-user conversation memory for agent sessions (e.g. a multi-turn
 * occasion-planner refinement), backed by the existing shared Redis client/config. */
@Injectable()
export class ConversationMemoryStore {
  constructor(private readonly redis: RedisService) {}

  private key(userId: string, sessionKey: string): string {
    return `sdk:memory:${userId}:${sessionKey}`;
  }

  async get(userId: string, sessionKey: string): Promise<ChatMessage[]> {
    const raw = await this.redis.get(this.key(userId, sessionKey));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ChatMessage[];
    } catch {
      return [];
    }
  }

  async append(userId: string, sessionKey: string, messages: ChatMessage[]): Promise<void> {
    const existing = await this.get(userId, sessionKey);
    const merged = [...existing, ...messages].slice(-MAX_MESSAGES);
    await this.redis.set(this.key(userId, sessionKey), JSON.stringify(merged), DEFAULT_TTL_SECONDS);
  }

  async clear(userId: string, sessionKey: string): Promise<void> {
    await this.redis.del(this.key(userId, sessionKey));
  }
}
