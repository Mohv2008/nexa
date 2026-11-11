import { config } from './config';
import { currentPreferences } from './preferences';

export interface RealtimeEvent<T = unknown> {
  type: string;
  data: T;
}

export class RealtimeConnection {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private closedByUser = false;
  private readonly listeners = new Set<(event: RealtimeEvent) => void>();

  constructor(
    private readonly kind: 'channel' | 'conversation' | 'voice',
    private readonly roomId: string,
  ) {
    document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  connect(): void {
    if (
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    this.closedByUser = false;
    const url = new URL(config.apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/$/u, '')}/realtime/${this.kind}/${this.roomId}`;
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      this.attempts = 0;
      this.scheduleHeartbeat();
    });
    this.socket.addEventListener('message', (message) => {
      try {
        const event = JSON.parse(String(message.data)) as RealtimeEvent;
        for (const listener of this.listeners) listener(event);
      } catch {
        // Invalid server events are ignored rather than rendered as user content.
      }
    });
    this.socket.addEventListener('close', (event) => {
      this.stopHeartbeat();
      if (!this.closedByUser && event.code !== 4001) this.scheduleReconnect();
    });
  }

  subscribe(listener: (event: RealtimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(type: string, data: unknown = {}): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ type, data }));
    return true;
  }

  close(): void {
    this.closedByUser = true;
    this.cancelReconnect();
    this.stopHeartbeat();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.socket?.close(1000, 'View changed');
    this.socket = null;
    this.listeners.clear();
  }

  private readonly visibilityChanged = (): void => {
    if (document.hidden) {
      this.stopHeartbeat();
      this.cancelReconnect();
    } else {
      this.connect();
      this.scheduleHeartbeat();
    }
  };

  private scheduleReconnect(): void {
    if (document.hidden || this.reconnectTimer !== null) return;
    const delay = Math.min(30_000, 500 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
    this.attempts += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleHeartbeat(): void {
    this.stopHeartbeat();
    if (document.hidden) return;
    const delay = currentPreferences().lowPower ? 90_000 : 45_000;
    this.heartbeatTimer = window.setTimeout(() => {
      this.send('ping');
      this.scheduleHeartbeat();
    }, delay);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) window.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}
