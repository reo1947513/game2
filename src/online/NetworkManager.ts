import {
  ClientMessage,
  ServerMessage,
  PlayerState,
  PlayerInfo,
  WorldState,
  ErrorCode,
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
