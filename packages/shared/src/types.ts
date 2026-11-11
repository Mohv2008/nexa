export type Id = string;
export type IsoDateTime = string;

export interface UserSummary {
  id: Id;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  status: 'online' | 'idle' | 'dnd' | 'offline';
}

export interface UserProfile extends UserSummary {
  bio: string;
  locale: 'en' | 'ar';
  createdAt: IsoDateTime;
  followerCount: number;
  followingCount: number;
  isFollowing?: boolean;
  isBlocked?: boolean;
}

export interface Attachment {
  id: Id;
  url: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface Post {
  id: Id;
  author: UserSummary;
  body: string;
  visibility: 'public' | 'followers' | 'friends';
  media: Attachment[];
  likeCount: number;
  commentCount: number;
  shareCount: number;
  liked: boolean;
  createdAt: IsoDateTime;
  editedAt: IsoDateTime | null;
}

export interface Message {
  id: Id;
  channelId: Id | null;
  conversationId: Id | null;
  author: UserSummary;
  content: string;
  clientNonce: string;
  replyTo: Id | null;
  threadId: Id | null;
  attachments: Attachment[];
  reactions: Array<{ emoji: string; count: number; reacted: boolean }>;
  createdAt: IsoDateTime;
  editedAt: IsoDateTime | null;
  deletedAt: IsoDateTime | null;
}

export interface Channel {
  id: Id;
  serverId: Id;
  categoryId: Id | null;
  name: string;
  topic: string;
  type: 'text' | 'voice' | 'announcement';
  position: number;
  slowModeSeconds: number;
  unreadCount?: number;
}

export interface Community {
  id: Id;
  name: string;
  description: string;
  iconUrl: string | null;
  ownerId: Id;
  visibility: 'private' | 'public';
  memberCount: number;
  channels: Channel[];
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type RealtimeClientEvent =
  | { type: 'message.create'; data: unknown }
  | { type: 'message.update'; data: { id: Id; content: string } }
  | { type: 'message.delete'; data: { id: Id } }
  | { type: 'typing'; data: { active: boolean } }
  | { type: 'read'; data: { messageId: Id } }
  | {
      type: 'presence';
      data: { status: 'online' | 'idle' | 'dnd' | 'offline' };
    }
  | { type: 'signal'; data: { targetUserId: Id; signal: unknown } };

export type RealtimeServerEvent =
  | { type: 'ready'; data: { roomId: Id; userId: Id } }
  | {
      type: 'message.created' | 'message.updated' | 'message.deleted';
      data: unknown;
    }
  | { type: 'typing'; data: { userId: Id; active: boolean } }
  | { type: 'read'; data: { userId: Id; messageId: Id } }
  | { type: 'presence'; data: { userId: Id; status: string } }
  | { type: 'signal'; data: { userId: Id; signal: unknown } }
  | { type: 'error'; data: { code: string; message: string } };
