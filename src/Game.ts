import * as THREE from "three";
import { Input } from "./Input";
import { Stage, StageId, STAGE_LIST } from "./Stage";
import { GauntletRun } from "./modes/GauntletRun";
import { KeepMoving } from "./modes/KeepMoving";
import { PlayerController } from "./PlayerController";
import { WeaponSystem } from "./WeaponSystem";
import { HUD } from "./HUD";
import { TouchControls } from "./TouchControls";
import { ModeUI } from "./ModeUI";
import { GameContext, ModeManager, TargetRush, MovingRange, Parkour, WaveSurvival, BotDeathmatch } from "./GameModes";
import { Health } from "./Health";
import { NetworkManager } from "./online/NetworkManager";
import { RemotePlayer } from "./online/RemotePlayer";
import { RoomLobbyUI } from "./ui/RoomLobbyUI";
import { PlayerState, WorldState } from "./online/netTypes";
import { GrenadeSystem } from "./combat/GrenadeSystem";
import { KnifeViewmodel } from "./combat/KnifeViewmodel";
import { KickViewmodel } from "./combat/KickViewmodel";
import { SlashTrail } from "./combat/SlashTrail";
import { SoundSystem } from "./SoundSystem";
import { MeleeSystem } from "./combat/MeleeSystem";

// すべてのシステムを組み合わせて毎フレーム動かす中心クラスです。
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private input: Input;
  private stage: Stage;
  private player: PlayerController;
  private weapons: WeaponSystem;
  private knifeVm: KnifeViewmodel;
  private kickVm: KickViewmodel;
  private slashTrail: SlashTrail;
  private sound: SoundSystem;
  private melee: MeleeSystem;
  private grenades: GrenadeSystem;
  private hud: HUD;
  private touch: TouchControls;
  private ui: ModeUI;
  private health: Health;
  private modeManager: ModeManager;
  private ctx: GameContext;

  private clock = new THREE.Clock();
  private eye = new THREE.Vector3();
  private running = false;
  private paused = false;
  private wasDead = false; // 前フレームの戦闘中死亡状態（復活検知に使う）
  private currentStageId: StageId = "skyframe"; // 現在ロード中のステージ
  private selectedStageId: StageId = "skyframe"; // メニューで選択中のステージ
  private selectedDifficulty: "normal" | "hard" = "normal"; // メニューで選択中の難易度
  private currentModeId = ""; // 現在のモードID（リスタート用）

  // ===== オンライン対戦（フェーズ1：座標同期・ゴースト表示） =====
  private network = new NetworkManager();
  private lobby = new RoomLobbyUI();
  private remotePlayers = new Map<string, RemotePlayer>();
  private online = false; // オンラインセッション中か
  private onlineWired = false; // ネットワークイベントを結線済みか

  // 画面の状態。"menu"=モード選択、"playing"=プレイ中、"result"=結果表示
  private screen: "menu" | "playing" | "result" = "menu";
  // 結果表示などで意図的にロックを外したときに、メニューを開かないようにする目印
  private suppressUnlockMenu = false;

  constructor(container: HTMLElement) {
    // レンダラー
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // カメラ
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.05,
      300
    );

    // 入力（ポインタロックの対象はcanvas）
    this.input = new Input(this.renderer.domElement);

    // ステージ・プレイヤー・武器・HUD
    this.stage = new Stage(this.scene);
    this.player = new PlayerController(this.stage.colliders);
    this.hud = new HUD();
    this.weapons = new WeaponSystem(this.camera, this.scene, this.input, this.stage, this.hud);
    this.knifeVm = new KnifeViewmodel(this.camera);
    this.kickVm = new KickViewmodel(this.camera);
    this.slashTrail = new SlashTrail(this.scene);
    this.sound = new SoundSystem();
    this.melee = new MeleeSystem(
      this.camera,
      this.player,
      this.weapons,
      this.hud,
      this.sound,
      this.knifeVm,
      this.kickVm,
      this.slashTrail
    );
    this.health = new Health();
    this.grenades = new GrenadeSystem(
      this.scene,
      this.camera,
      this.player,
      this.health,
      this.weapons,
      this.melee,
      this.hud,
      this.sound
    );

    // タッチ操作レイヤー（スマホ・タブレット用）。一時停止メニューから設定を開く。
    this.touch = new TouchControls(this.input, {
      onPause: () => this.setPaused(true),
      onResume: () => this.setPaused(false),
    });

    // モード関連（選択画面・結果画面・モード中の表示と、モードの管理）
    this.ui = new ModeUI();
    this.modeManager = new ModeManager([
      new TargetRush(),
      new MovingRange(),
      new Parkour(),
      new WaveSurvival(),
      new BotDeathmatch(),
      new GauntletRun("fixed"),
      new GauntletRun("free"),
      new KeepMoving(),
    ]);
    this.ctx = {
      scene: this.scene,
      stage: this.stage,
      weapons: this.weapons,
      ui: this.ui,
      player: this.player,
      health: this.health,
      finish: (lines: string[], canRestart?: boolean) =>
        this.onModeFinish(lines, canRestart),
      difficulty: this.selectedDifficulty,
      grenadeSystem: this.grenades,
      meleeProvider: null,
      sound: this.sound,
    };

    // Escなどでポインタロックが外れたら、プレイ中ならモード選択に戻す
    document.addEventListener("pointerlockchange", () => {
      if (
        document.pointerLockElement === null &&
        this.screen === "playing" &&
        !this.suppressUnlockMenu &&
        !TouchControls.isTouchDevice()
      ) {
        this.showMenu();
      }
    });

    window.addEventListener("resize", this.onResize);
  }

  // 開始オーバーレイをタップ／クリックしたら、まずモード選択を表示する
  start(): void {
    if (TouchControls.isTouchDevice()) {
      // スマホ・タブレット向けCSS（縦画面の回転案内・モバイルHUD最適化）を
      // 有効化する目印。これを起点に、横画面案内や開始画面の出し分けをCSSで制御する。
      document.body.classList.add("touch-device");
      // タッチ端末ではモード選択画面でも縦画面の回転案内を効かせたいので、
      // 早い段階でタッチ操作レイヤーを有効化しておく。
      this.touch.enable();
    }
    this.ensureLoop();
    this.showMenu();
  }

  // ループを動かし始める（最初の1回だけ）
  private ensureLoop(): void {
    if (!this.running) {
      this.running = true;
      this.clock.start();
      this.loop();
    }
  }

  // モード選択画面を表示する（プレイは一時停止）
  private showMenu(): void {
    this.screen = "menu";
    this.paused = true;
    this.melee.cancel();
    if (this.online) this.leaveOnline();
    this.modeManager.stop(this.ctx);
    const items = this.modeManager.list().map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
    }));
    items.push({
      id: "__online__",
      label: "オンライン対戦",
      description: "ルームコードで対戦（フェーズ1：座標同期）",
    });
    this.ui.showMenu(
      items,
      (id: string) =>
        id === "__online__" ? this.openLobby() : this.beginMode(id),
      STAGE_LIST,
      this.selectedStageId,
      (sid: string) => {
        this.selectedStageId = sid as StageId;
      },
      [
        { id: "normal", label: "NORMAL" },
        { id: "hard", label: "HARD" },
      ],
      this.selectedDifficulty,
      (did: string) => {
        this.selectedDifficulty = did === "hard" ? "hard" : "normal";
      }
    );
  }

  // ステージを切り替える。コライダー配列の参照は維持されるが、射撃対象は集め直す。
  private switchStage(id: StageId): void {
    if (id === this.currentStageId) return;
    this.stage.load(id);
    this.currentStageId = id;
    this.weapons.refreshShootables();
  }

  // 選んだモードで開始する
  private beginMode(id: string): void {
    this.ui.hideAll();
    this.screen = "playing";
    this.suppressUnlockMenu = false;
    // 端末に応じて操作方式を有効化（タッチ or マウス固定）。
    // タッチ端末では start() で既に enable 済みのため、ここではマウス側のみ要求する。
    if (TouchControls.isTouchDevice()) {
      this.touch.enable();
    } else {
      this.input.requestLock();
    }
    const now = performance.now() / 1000;
    // モードに固定ステージがあればそれを、無ければ選択中のステージをロードする
    const mode = this.modeManager.get(id);
    this.switchStage(mode?.fixedStage ?? this.selectedStageId);
    this.currentModeId = id;
    this.ctx.difficulty = this.selectedDifficulty;
    this.melee.cancel();
    this.modeManager.start(id, this.ctx, now);
    // ステージのスポーン地点から開始する（SKYFRAMEは南ゲート前）
    const s = this.stage.playerSpawn;
    this.player.respawn(s.x, s.y, s.z);
    this.paused = false;
  }

  // 接続先のWebSocket URL（本番は VITE_WS_URL、未設定ならローカル）。
  private wsUrl(): string {
    const meta = import.meta as unknown as {
      env?: { VITE_WS_URL?: string };
    };
    return meta.env?.VITE_WS_URL || "ws://localhost:8080";
  }

  // ロビーを開く。ネットワークイベントを1回だけ結線し、作成/参加の操作を受ける。
  private openLobby(): void {
    this.wireNetwork();
    const url = this.wsUrl();
    this.lobby.show({
      onCreate: () => {
        this.ensureConnected(url)
          .then(() =>
            this.network
              .createRoom(2, "online", this.selectedStageId)
              .then(({ roomCode }) => {
                this.lobby.setCode(roomCode);
                this.lobby.setRoster(
                  this.network.players.length,
                  2,
                  this.network.isHost
                );
              })
          )
          .catch(() => this.lobby.setError("サーバーに接続できませんでした"));
      },
      onJoin: (code: string) => {
        this.ensureConnected(url)
          .then(() =>
            this.network
              .joinRoom(code)
              .then(() => {
                this.lobby.setCode(code);
                this.lobby.setRoster(
                  this.network.players.length,
                  2,
                  this.network.isHost
                );
              })
              .catch((e: unknown) => this.lobby.setError(this.errMessage(e)))
          )
          .catch(() => this.lobby.setError("サーバーに接続できませんでした"));
      },
      onStart: () => this.network.startGame(),
      onClose: () => {
        this.lobby.hide();
        this.network.disconnect();
      },
    });
  }

  private ensureConnected(url: string): Promise<void> {
    if (this.network.isConnected()) return Promise.resolve();
    return this.network.connect(url);
  }

  // ネットワークイベントの結線（1回だけ）。
  private wireNetwork(): void {
    if (this.onlineWired) return;
    this.onlineWired = true;
    this.network.on("roomUpdate", (players) => {
      this.lobby.setRoster(players.length, 2, this.network.isHost);
    });
    this.network.on("gameStart", (info) => this.onGameStart(info.stage));
    this.network.on("worldState", (world) => this.reconcileGhosts(world));
    this.network.on("playerLeft", (info) => this.removeGhost(info.playerId));
    this.network.on("error", (e) => this.lobby.setError(this.errMessage(e)));
    this.network.on("close", () => {
      if (this.online) this.leaveOnline();
    });
  }

  // ホストの「ゲーム開始」でサーバーから GAME_START が来たとき。
  // フェーズ1はモードを起動せず、自由移動でゴースト表示のみ行う。
  private onGameStart(stage: string): void {
    this.lobby.hide();
    this.ui.hideAll();
    this.screen = "playing";
    this.suppressUnlockMenu = false;
    if (TouchControls.isTouchDevice()) this.touch.enable();
    else this.input.requestLock();

    this.melee.cancel();
    this.modeManager.stop(this.ctx);
    const sid: StageId =
      stage === "dusk" || stage === "skyframe"
        ? (stage as StageId)
        : this.selectedStageId;
    this.switchStage(sid);
    const sp = this.stage.playerSpawn;
    this.player.respawn(sp.x, sp.y, sp.z);
    this.health.reset(100);
    this.online = true;
    this.paused = false;
  }

  // 自分の状態送信＋全ゴーストの補間更新（毎フレーム）。
  private updateOnline(): void {
    const p = this.player;
    const state: PlayerState = {
      playerId: this.network.playerId,
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      velocity: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      yaw: this.input.getYaw(),
      pitch: this.input.getPitch(),
      hp: this.health.getCurrent(),
      onGround: p.grounded,
    };
    this.network.sendPlayerState(state);
    for (const rp of this.remotePlayers.values()) rp.update(100); // renderDelay 100ms
  }

  // 受信した世界状態でゴーストを作成/更新する。
  private reconcileGhosts(world: WorldState): void {
    if (!this.online) return;
    for (const ps of world.players) {
      if (ps.playerId === this.network.playerId) continue;
      let rp = this.remotePlayers.get(ps.playerId);
      if (!rp) {
        rp = new RemotePlayer(ps.playerId);
        this.remotePlayers.set(ps.playerId, rp);
        this.scene.add(rp.group);
      }
      rp.receiveState(ps);
    }
  }

  private removeGhost(id: string): void {
    const rp = this.remotePlayers.get(id);
    if (rp) {
      this.scene.remove(rp.group);
      rp.dispose();
      this.remotePlayers.delete(id);
    }
  }

  // オンラインセッションを抜ける（ゴースト除去・切断）。
  private leaveOnline(): void {
    this.online = false;
    for (const id of [...this.remotePlayers.keys()]) this.removeGhost(id);
    this.network.leaveRoom();
    this.network.disconnect();
  }

  private errMessage(e: unknown): string {
    const o = e as { code?: string; message?: string };
    return `${o.message ?? "エラー"}（コード: ${o.code ?? "ERR"}）`;
  }

  // モードが終了したとき（結果を表示し、操作を止める）
  private onModeFinish(lines: string[], canRestart?: boolean): void {
    this.screen = "result";
    this.paused = true;
    this.melee.cancel();
    this.suppressUnlockMenu = true;
    if (document.exitPointerLock) document.exitPointerLock();
    this.ui.showResult(
      lines,
      () => this.showMenu(),
      canRestart ? () => this.restartMode() : undefined
    );
  }

  // 結果画面のリスタートボタンから、同じモードを即やり直す。
  private restartMode(): void {
    this.ui.hideAll();
    this.beginMode(this.currentModeId);
  }

  // 一時停止の切り替え（タッチのポーズメニューから呼ばれる）
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private loop = (): void => {
    requestAnimationFrame(this.loop);

    // 経過時間。タブ復帰などで跳ねないよう上限を設ける。
    let dt = this.clock.getDelta();
    if (dt > 0.05) dt = 0.05;
    const now = performance.now() / 1000;

    // 一時停止中は画面を止めたまま描画だけ続ける
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // ポインタロック中、またはタッチ操作有効のときだけ操作を受け付ける
    const active = this.input.isActive();
    const inputState = this.input.sample();
    if (!active) {
      // 未操作時は移動入力を無効化（視点は固定）
      inputState.forward = 0;
      inputState.right = 0;
      inputState.firing = false;
      inputState.aiming = false;
      inputState.jumpPressed = false;
    }

    // 戦闘モード（provider あり）での死亡中は、近接・投擲を止める。
    const inCombat = this.ctx.meleeProvider != null;
    const dead = inCombat && this.health.isDead();

    // 近接：対象提供者を現在モードから受け取り、死亡中はスイングを畳む。
    // プレイヤー更新の前に行い、ランジ速度を移動へ反映させる。
    this.melee.setProvider(this.ctx.meleeProvider ?? null);
    if (dead) {
      this.melee.cancel();
    } else {
      this.melee.handleInput(inputState, now, dt);
    }
    this.player.setLungeOverride(
      this.melee.lungeActive(),
      this.melee.lungeVelX(),
      this.melee.lungeVelZ()
    );

    // プレイヤー更新
    this.player.update(dt, inputState);

    // カメラ位置＝目線、向き＝マウスで作ったyaw/pitch（反動はInput側に加算済み）
    this.player.getEyePosition(this.eye);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.input.getPitch(), this.input.getYaw(), 0, "YXZ");

    // オンライン中：自分の状態を送信し、他プレイヤーのゴーストを補間更新する
    if (this.online) this.updateOnline();

    // 武器更新（速度連動FOVにランジ状態を反映）
    this.weapons.setMeleeLunging(this.melee.lungeActive());
    this.weapons.update(dt, inputState, this.player.horizontalSpeed, now);
    // グレネード（フラグG／フラッシュC、押した瞬間に投擲）。カメラ確定後に処理する。
    // 戦闘中の死亡→復活の瞬間に、所持・投擲物・ホワイトアウトをリセットする。
    this.grenades.setProvider(this.ctx.meleeProvider ?? null);
    if (this.wasDead && !dead) this.grenades.reset();
    this.wasDead = dead;
    this.grenades.handleInput(inputState, !dead);
    this.grenades.update(dt, this.stage.colliders);
    this.stage.updateTargets(now);
    // 現在のモードの更新（スコア・残り時間・的の動き・終了判定など）
    this.modeManager.update(this.ctx, dt, now);
    this.hud.update(dt);
    this.hud.setStance(this.player.stance);
    this.hud.setSpeed(this.player.horizontalSpeed);

    // 近接の毎フレーム進行（アニメ・命中・トレイル・シェイク量の更新）。
    this.melee.update(dt, now);
    // カメラへのリーン・シェイク適用は最後（描画直前）にまとめて行う。
    this.melee.applyCameraShake();

    this.renderer.render(this.scene, this.camera);
  };
}
