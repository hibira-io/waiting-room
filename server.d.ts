export interface PassClaims {
  appId: string;
  room: string;
  /** The visitor's queue number. */
  number: number;
  /** The queue ticket's id: record it to allow one checkout per number. */
  ticketId: string;
  /** The signed user ID, in rooms with one place per signed-in customer. */
  userId?: string;
  /** Unix seconds. */
  issuedAt: number;
  /** Unix seconds. */
  expiresAt: number;
}

export interface VerifyOptions {
  /** The app secret; an array during a secret rotation. */
  secret: string | string[];
  room?: string;
  appId?: string;
  /** Milliseconds, default Date.now(). */
  now?: number;
}

export interface GuardOptions extends VerifyOptions {
  appKey: string;
  room: string;
  /** Default https://ws.hibira.io */
  host?: string;
  lang?: 'en' | 'zh-TW' | 'zh-CN' | 'ja' | 'ko' | 'th' | 'vi';
  /** Default hibira_wr_<room> */
  cookieName?: string;
}

export type Decision =
  | { action: 'allow'; claims: PassClaims }
  | { action: 'redirect'; location: string; setCookie?: string; claims?: PassClaims }
  | { action: 'deny' };

export function verifyPass(pass: string | null | undefined, options: VerifyOptions): Promise<PassClaims | null>;
export function waitingRoomUrl(options: { appKey: string; room: string; returnUrl?: string; host?: string; lang?: string; user?: string }): string;
export function decide(request: { url: string; method?: string; cookie?: string | null }, options: GuardOptions): Promise<Decision>;
/** null: let the request through. Otherwise return the Response. */
export function protect(request: Request, options: GuardOptions): Promise<Response | null>;
export function expressWaitingRoom(options: GuardOptions): (req: any, res: any, next: (err?: unknown) => void) => void;

/** Signs a user token for rooms with one place per signed-in customer. */
export function signUser(options: { secret: string; room: string; userId: string; ttlSeconds?: number; now?: number }): Promise<string>;
