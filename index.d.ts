export interface WaitingRoomStatus {
  room: string;
  title?: string;
  state: 'open' | 'paused' | 'closed';
  admitted: number;
  issued: number;
  waiting: number;
  admit_per_minute: number;
  starts_at?: string;
  /** Early arrivals get random places at starts_at. */
  shuffle?: boolean;
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
  /** True until the start time's draw deals this visitor a place (number and position are 0 meanwhile). */
  drawPending: boolean;
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
  /** A user token signed by your server, for rooms with one place per signed-in customer. */
  user?: string;
  /** WebSocket base URL. Defaults to https://ws-edge.hibira.io with the default host (the edge, where queued visitors have a connection pool of their own), else to host. */
  wsHost?: string;
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
