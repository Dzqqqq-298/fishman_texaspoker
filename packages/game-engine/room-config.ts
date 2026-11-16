export interface RoomConfig {
  smallBlind: number; bigBlind: number; straddleMax: number; squidEnabled: boolean; squidUnit: number;
  maxPlayers: number; defaultBuyIn: number; minBuyIn: number; maxBuyIn: number;
  durationMinutes: number; allowTopup: boolean; allowLateJoin: boolean;
  maxRunouts:1|2;showdownMode:'auto'|'all';
}
export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  smallBlind: 10, bigBlind: 20, straddleMax: 8, squidEnabled: false, squidUnit: 100,
  maxPlayers: 11, defaultBuyIn: 2000, minBuyIn: 2000, maxBuyIn: 100000,
  durationMinutes: 120, allowTopup: true, allowLateJoin: true,
  maxRunouts:2,showdownMode:'auto',
};
export interface MatchPlayer {
  id: number; name: string; buyIn: number; cashOut: number; squidProfit: number; hands: number;
}
export interface MatchSession {
  id: string; name: string; createdAt: number; startedAt: number | null; endsAt: number | null;
  endRequested: boolean; endReason: string | null; handCount: number; players: MatchPlayer[];
}
export interface MatchResult {
  id: string; name: string; startedAt: number | null; endedAt: number; reason: string;
  handCount: number; config: RoomConfig; players: (MatchPlayer & { profit: number })[];
}
