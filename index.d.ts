export interface WaitingRoomStatus {
  room: string;
  title?: string;
  state: 'open' | 'paused' | 'closed';
  admitted: number;
  issued: number;
  waiting: number;
  admit_per_minute: number;
  starts_at?: string;
  channel: string;
  at: number;
}

export interface QueueUpdate {
  number: number;
  /** 1 = next in line. */
  position: number;
  ahead: number;
  /** null while paused or before the start time. */
  etaMinutes: number | null;
  status: WaitingRoomStatus;
}

export interface Turn {
  pass: string;
  number: number;
  expiresAt: string;
  /** Sends the visitor to url with ?hibira_pass=... */
  redirect(url: string): void;
}

export interface JoinOptions {
  /** The app key (public). */
  key: string;
  room: string;
  /** Default https://ws.hibira.io */
  host?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  onUpdate?(update: QueueUpdate): void;
  onTurn?(turn: Turn): void;
  onClosed?(status: WaitingRoomStatus): void;
  onError?(error: Error): void;
  WebSocket?: typeof WebSocket | null;
  fetch?: typeof fetch | null;
}

export interface WaitingRoomHandle {
  leave(): void;
  readonly number: number;
  readonly status: WaitingRoomStatus | null;
}

export function joinWaitingRoom(options: JoinOptions): WaitingRoomHandle;
