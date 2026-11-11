import type { Channel, Community, Message, Post, UserProfile, UserSummary } from '@nexa/shared';

export interface Account extends UserSummary {
  email: string;
  emailVerified: boolean;
  bio?: string;
  locale: 'en' | 'ar';
  totpEnabled?: boolean;
  createdAt?: string;
}

export interface ServerSummary extends Omit<Community, 'channels'> {
  createdAt?: string;
}

export interface ServerDetail extends ServerSummary {
  permissions: number;
  channels: Channel[];
  categories: Array<{ id: string; name: string; position: number }>;
  roles: Array<{
    id: string;
    name: string;
    color: string;
    permissions: number;
    position: number;
    everyone: boolean;
  }>;
  automod: {
    maxMessages: number;
    windowSeconds: number;
    blockLinks: boolean;
    bannedWords: string[];
  };
}

export interface ClientMessage extends Message {
  forwardedFrom?: string | null;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  ownerId: string | null;
  members: Array<UserSummary & { role: 'owner' | 'admin' | 'member' }>;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
}

export interface ServerMember {
  user: UserSummary;
  nickname: string | null;
  mutedUntil: string | null;
  joinedAt: string;
  roleIds: string[];
}

export interface AppNotification {
  id: string;
  type: string;
  entityId: string | null;
  payload: unknown;
  read: boolean;
  createdAt: string;
  actor: UserSummary | null;
}

export interface ApiData<T> {
  data: T;
}

export type { Channel, Post, UserProfile, UserSummary };
