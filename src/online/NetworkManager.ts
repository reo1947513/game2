import {
  ClientMessage,
  ServerMessage,
  PlayerState,
  PlayerInfo,
  WorldState,
  ErrorCode,
  Vec3,
  Box,
} from "./netTypes";

// 受け取れるイベントとそのデータ型。
export interface NetEvents {
  open: void;
  close: void;
  worldState: WorldState;
  playerJoined: PlayerInfo;
  playerLeft: { playerId: string };
  gameStart: { mode: string; stage: string };
  roomUpdate: PlayerInfo[];
  error: { code: ErrorCode; message: string };
}

type Handler = (data: unknown) => void;

// WebSocket 接続とメッセージ送受信を担う。ルーム作成/入室は Promise で返す。
export class NetworkManager {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Handler[]> = new Map();

  playerId = "";
  roomCode = "";
  isHost = false;
  players: PlayerInfo[] = [];
  maxPlayers = 2; // 現在のルームの定員（ROOM_CREATED/ROOM_JOINEDで更新）

  private rtt = 0; // 直近のRTT（ms）
  private pingTimer: number | null = null;

  private createResolve: ((v: { roomCode: string; playerId: string }) => void) | null = null;
  private joinResolve: (() => void) | null = null;
  private joinReject: ((e: { code: ErrorCode; message: string }) => void) | null = null;

  // 接続を確立する。
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.emit("open", undefined);
        resolve();
      };
      ws.onclose = () => this.emit("close", undefined);
      ws.onerror = () => reject(new Error("接続に失敗しました"));
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  createRoom(
    maxPlayers: number,
    mode: string,
    stage: string
  ): Promise<{ roomCode: string; playerId: string }> {
    return new Promise((resolve) => {
      this.createResolve = resolve;
      this.send({ type: "CREATE_ROOM", payload: { maxPlayers, mode, stage } });
    });
  }

  joinRoom(roomCode: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.joinResolve = resolve;
      this.joinReject = reject;
      this.send({ type: "JOIN_ROOM", payload: { roomCode } });
    });
  }

  startGame(): void {
    this.send({ type: "START_GAME" });
  }

  sendPlayerState(state: PlayerState): void {
    this.send({ type: "PLAYER_STATE", payload: state });
  }

  // ===== フェーズ2：戦闘 =====
  getRtt(): number {
    return this.rtt;
  }

  // ステージの当たり判定（ホストが開始時に送る）。
  sendColliders(colliders: Box[]): void {
    this.send({ type: "SET_COLLIDERS", payload: { colliders } });
  }

  // 射撃（サーバー権威の命中判定へ）。rtt はラグ補償に使われる。
  sendShot(origin: Vec3, direction: Vec3, seq: number, damage: number): void {
    this.send({ type: "SHOT", payload: { origin, direction, seq, rtt: this.rtt, damage } });
  }

  // グレネード投擲（サーバーが弾道を計算）。
  throwGrenade(gtype: "frag" | "flash", origin: Vec3, velocity: Vec3): void {
    this.send({ type: "THROW_GRENADE", payload: { gtype, origin, velocity } });
  }

  // 近接攻撃の命中試行（サーバーが距離判定してダメージ処理）。TDMの近接キル用。
  sendMelee(kind: "knife" | "kick"): void {
    this.send({ type: "MELEE_HIT", payload: { kind } });
  }

  // 5秒ごとに PING を送って RTT を計測する。
  startPing(): void {
    this.stopPing();
    const ping = () => {
      if (this.isConnected()) this.send({ type: "PING", payload: { clientTime: performance.now() } });
    };
    ping();
    this.pingTimer = window.setInterval(ping, 5000);
  }

  stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  leaveRoom(): void {
    if (this.isConnected()) this.send({ type: "LEAVE_ROOM" });
  }

  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // 無視
      }
      this.ws = null;
    }
    this.players = [];
    this.roomCode = "";
    this.playerId = "";
    this.isHost = false;
    this.createResolve = null;
    this.joinResolve = null;
    this.joinReject = null;
  }

  on<K extends keyof NetEvents>(event: K, handler: (data: NetEvents[K]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as Handler);
    this.handlers.set(event, list);
  }

  private emit<K extends keyof NetEvents>(event: K, data: NetEvents[K]): void {
    const list = this.handlers.get(event);
    if (list) for (const h of list) h(data as unknown);
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private onMessage(ev: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "ROOM_CREATED": {
        this.playerId = msg.payload.playerId;
        this.roomCode = msg.payload.roomCode;
        this.isHost = true;
        this.players = msg.payload.players;
        this.maxPlayers = msg.payload.maxPlayers;
        this.createResolve?.({ roomCode: this.roomCode, playerId: this.playerId });
        this.createResolve = null;
        this.emit("roomUpdate", this.players);
        break;
      }
      case "ROOM_JOINED": {
        this.playerId = msg.payload.playerId;
        this.roomCode = msg.payload.roomCode;
        this.isHost = false;
        this.players = msg.payload.players;
        this.maxPlayers = msg.payload.maxPlayers;
        this.joinResolve?.();
        this.joinResolve = null;
        this.joinReject = null;
        this.emit("roomUpdate", this.players);
        break;
      }
      case "PLAYER_JOINED": {
        if (!this.players.some((p) => p.playerId === msg.payload.playerId)) {
          this.players.push(msg.payload);
        }
        this.emit("playerJoined", msg.payload);
        this.emit("roomUpdate", this.players);
        break;
      }
      case "PLAYER_LEFT": {
        this.players = this.players.filter((p) => p.playerId !== msg.payload.playerId);
        this.emit("playerLeft", msg.payload);
        this.emit("roomUpdate", this.players);
        break;
      }
      case "GAME_START": {
        this.emit("gameStart", msg.payload);
        break;
      }
      case "WORLD_STATE": {
        this.emit("worldState", msg.payload);
        break;
      }
      case "PONG": {
        this.rtt = performance.now() - msg.payload.clientTime;
        // eslint-disable-next-line no-console
        console.log(`[online] RTT: ${this.rtt.toFixed(0)}ms`);
        break;
      }
      case "ERROR": {
        if (this.joinReject) {
          this.joinReject(msg.payload);
          this.joinReject = null;
          this.joinResolve = null;
        }
        this.emit("error", msg.payload);
        break;
      }
    }
  }
}
