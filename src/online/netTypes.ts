// ARENA STRIKE オンライン（フェーズ1〜2）の共通メッセージ・状態の型。
// サーバー側（~/game2-server/src/netTypes.ts）と同一内容に保つこと。

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// プレイヤー1人の状態（自分が送り、サーバーが中継してブロードキャストする）。
// hp はフェーズ2でサーバー権威となり、サーバーが上書きして配る。
export interface PlayerState {
  playerId: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  hp: number;
  onGround: boolean;
  seq: number; // クライアントの入力シーケンス番号（lastProcessedSeq用）
}

// サーバー権威で物理計算するグレネードの飛行状態。
export interface ProjectileState {
  id: string;
  type: "frag" | "flash";
  position: Vec3;
  velocity: Vec3;
  fuse: number;
}

// 命中・撃破・爆発などの単発イベント。
export interface GameEvent {
  type: "HIT" | "KILL" | "GRENADE_EXPLODE" | "FLASHBANG_EXPLODE";
  payload: Record<string, unknown>;
  tick: number;
}

// ステージの当たり判定箱（ホストが開始時に送る）。
export interface Box {
  min: Vec3;
  max: Vec3;
}

export type Team = "RED" | "BLUE";

// チームデスマッチの共有状態（WorldStateに同梱されて配られる）。
export interface TDMShared {
  phase: "PLAYING" | "RESULT";
  timeRemaining: number; // 秒
  scores: { RED: number; BLUE: number };
  kills: { RED: number; BLUE: number };
  killLimit: number;
  teams: Record<string, Team>; // playerId → チーム
  respawn: Record<string, number>; // playerId → 復活までの残り秒（0=生存）
  winner?: Team | "DRAW";
}

// ===== コープ・ガントレット =====
export type EnemyType = "grunt" | "fast" | "boss";

export interface ServerEnemyState {
  id: string;
  etype: EnemyType;
  position: Vec3;
  hp: number;
  maxHp: number;
}

export type CoopStatus = "ALIVE" | "DOWN" | "DEAD";

export interface CoopPlayerShared {
  playerId: string;
  status: CoopStatus;
  hp: number;
  downTimer: number; // 0..5（フィニッシュまでの秒）
  reviveProgress: number; // 0..5（蘇生完了までの秒）
  score: number;
}

export interface CoopShared {
  phase: "WAVE" | "REST" | "RESULT";
  currentWave: number;
  restCountdown: number;
  enemiesRemaining: number;
  enemies: ServerEnemyState[];
  players: CoopPlayerShared[];
  totalScore: number;
  wipe?: boolean;
}

// ロビーに出すプレイヤー情報。
export interface PlayerInfo {
  playerId: string;
  name: string;
  isHost: boolean;
}

// 20tick/s でブロードキャストされる世界状態。
export interface WorldState {
  tick: number;
  timestamp: number;
  players: PlayerState[];
  projectiles: ProjectileState[];
  events: GameEvent[];
  lastProcessedSeq: Record<string, number>;
  tdm?: TDMShared; // チームデスマッチ時のみ
  coop?: CoopShared; // コープ・ガントレット時のみ
}

export type ErrorCode =
  | "ERR_ROOM_NOT_FOUND"
  | "ERR_ROOM_FULL"
  | "ERR_BAD_MESSAGE"
  | "ERR_NOT_IN_ROOM";

// ===== クライアント → サーバー =====
export type ClientMessage =
  | { type: "IDENTIFY"; payload: { playerId: string } } // 端末固定ID（戦績の累積キー）
  | { type: "CREATE_ROOM"; payload: { maxPlayers: number; mode: string; stage: string } }
  | { type: "JOIN_ROOM"; payload: { roomCode: string } }
  | { type: "PLAYER_STATE"; payload: PlayerState }
  | { type: "START_GAME" }
  | { type: "LEAVE_ROOM" }
  // フェーズ2：戦闘
  | { type: "SET_COLLIDERS"; payload: { colliders: Box[] } }
  | { type: "SHOT"; payload: { origin: Vec3; direction: Vec3; seq: number; rtt: number; damage: number } }
  | { type: "THROW_GRENADE"; payload: { gtype: "frag" | "flash"; origin: Vec3; velocity: Vec3 } }
  | { type: "MELEE_HIT"; payload: { kind: "knife" | "kick" } }
  | { type: "REVIVE"; payload: { active: boolean } }
  | { type: "PING"; payload: { clientTime: number } };

// ===== サーバー → クライアント =====
export type ServerMessage =
  | { type: "ROOM_CREATED"; payload: { roomCode: string; playerId: string; players: PlayerInfo[]; maxPlayers: number } }
  | { type: "ROOM_JOINED"; payload: { roomCode: string; playerId: string; players: PlayerInfo[]; maxPlayers: number } }
  | { type: "PLAYER_JOINED"; payload: PlayerInfo }
  | { type: "PLAYER_LEFT"; payload: { playerId: string } }
  | { type: "GAME_START"; payload: { mode: string; stage: string } }
  | { type: "WORLD_STATE"; payload: WorldState }
  | { type: "PONG"; payload: { clientTime: number; serverTime: number } }
  | { type: "ERROR"; payload: { code: ErrorCode; message: string } };
