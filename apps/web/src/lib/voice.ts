import { APP_CONFIG } from '@nexa/shared';
import { RealtimeConnection, type RealtimeEvent } from './realtime';

interface SignalEnvelope {
  userId: string;
  signal: { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };
}

export class VoiceRoom {
  private connection: RealtimeConnection | null = null;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private userId = '';
  private muted = false;

  constructor(
    private readonly channelId: string,
    private readonly onRemoteStream: (userId: string, stream: MediaStream | null) => void,
    private readonly onState: (state: 'connecting' | 'connected' | 'closed' | 'error') => void,
  ) {}

  async join(): Promise<void> {
    this.onState('connecting');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Voice capture is not supported.');
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    this.connection = new RealtimeConnection('voice', this.channelId);
    this.connection.subscribe((event) => void this.handleEvent(event));
    this.connection.connect();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    for (const track of this.localStream?.getAudioTracks() ?? []) track.enabled = !muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  leave(): void {
    this.connection?.close();
    this.connection = null;
    for (const [userId, peer] of this.peers) {
      peer.close();
      this.onRemoteStream(userId, null);
    }
    this.peers.clear();
    for (const track of this.localStream?.getTracks() ?? []) track.stop();
    this.localStream = null;
    this.onState('closed');
  }

  private async handleEvent(event: RealtimeEvent): Promise<void> {
    if (event.type === 'ready') {
      const ready = event.data as { userId: string; participants?: string[] };
      this.userId = ready.userId;
      const participants = (ready.participants ?? []).filter((id) => id !== this.userId);
      if (participants.length + 1 > APP_CONFIG.maxVoicePeers) {
        this.leave();
        throw new Error('Voice room is full.');
      }
      for (const participant of participants) {
        const peer = this.ensurePeer(participant);
        if (this.userId.localeCompare(participant) < 0) {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          this.signal(participant, { description: offer });
        }
      }
      this.onState('connected');
      return;
    }
    if (event.type === 'presence') {
      const presence = event.data as { userId?: string; status?: string };
      if (presence.status === 'offline' && presence.userId) this.removePeer(presence.userId);
      return;
    }
    if (event.type !== 'signal') return;
    const envelope = event.data as SignalEnvelope;
    if (!envelope.userId || !envelope.signal) return;
    const peer = this.ensurePeer(envelope.userId);
    if ('description' in envelope.signal) {
      await peer.setRemoteDescription(envelope.signal.description);
      if (envelope.signal.description.type === 'offer') {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.signal(envelope.userId, { description: answer });
      }
    } else if ('candidate' in envelope.signal) {
      await peer.addIceCandidate(envelope.signal.candidate);
    }
  }

  private ensurePeer(remoteUserId: string): RTCPeerConnection {
    const existing = this.peers.get(remoteUserId);
    if (existing) return existing;
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
      ],
      bundlePolicy: 'max-bundle',
    });
    for (const track of this.localStream?.getTracks() ?? []) {
      peer.addTrack(track, this.localStream!);
    }
    peer.addEventListener('icecandidate', (event) => {
      if (event.candidate) this.signal(remoteUserId, { candidate: event.candidate.toJSON() });
    });
    peer.addEventListener('track', (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.onRemoteStream(remoteUserId, stream);
    });
    peer.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        this.removePeer(remoteUserId);
      }
    });
    this.peers.set(remoteUserId, peer);
    return peer;
  }

  private signal(targetUserId: string, signal: SignalEnvelope['signal']): void {
    this.connection?.send('signal', { targetUserId, signal });
  }

  private removePeer(userId: string): void {
    this.peers.get(userId)?.close();
    this.peers.delete(userId);
    this.onRemoteStream(userId, null);
  }
}
