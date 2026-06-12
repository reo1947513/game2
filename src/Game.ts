import * as THREE from "three";
import { Input } from "./Input";
import { Stage, StageId, STAGE_LIST } from "./Stage";
import { GauntletRun } from "./modes/GauntletRun";
import { KeepMoving } from "./modes/KeepMoving";
import { TowerMode } from "./modes/TowerMode";
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
import { HomeScreen } from "./ui/HomeScreen";
import {
  PlayerState,
  WorldState,
  GameEvent,
  Team,
  ServerEnemyState,
  ZiplineState,
  roofSpawnPoints,
  BUILDINGS,
  type BuildingId,
  type BuildingDef,
} from "./online/netTypes";
import { ClientPredictor } from "./online/ClientPredictor";
import { RemoteProjectile } from "./online/RemoteProjectile";
import { RemoteEnemy } from "./online/RemoteEnemy";
import { TeamHUD } from "./ui/TeamHUD";
import { CoopHUD } from "./ui/CoopHUD";
import { RooftopHUD } from "./ui/RooftopHUD";
import { SettingsUI } from "./ui/SettingsUI";
import { InputState, WeaponKind } from "./types";
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
  private settings!: SettingsUI;
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
  private home = new HomeScreen();
  private remotePlayers = new Map<string, RemotePlayer>();
  private online = false; // オンラインセッション中か
  private onlineWired = false; // ネットワークイベントを結線済みか
  private predictor = new ClientPredictor(); // 入力seq管理（将来の移動予測の土台）
  private remoteProjectiles = new Map<string, RemoteProjectile>(); // サーバー権威の弾
  private onlineSeq = 0; // 直近の入力seq
  private onlineThrowCd = 0; // オンライン投擲の共通クールダウン
  private onlineMode = ""; // 現在のオンラインモード（"online"=自由 / "tdm" / "coop"）
  private teamHud = new TeamHUD(); // チームデスマッチ用HUD
  private tdmResultShown = false; // リザルトを表示済みか
  private coopHud = new CoopHUD(); // コープ用HUD
  private remoteEnemies = new Map<string, RemoteEnemy>(); // サーバー権威の敵ゴースト
  private coopResultShown = false; // コープのリザルトを表示済みか
  private rooftopHud = new RooftopHUD(); // ROOFTOP DUEL 用HUD
  private rooftopResultShown = false; // ルーフトップのリザルトを表示済みか
  private rooftopZiplines: ZiplineState[] = []; // 直近のジップライン状態（乗降判定用）
  private ziplineRide: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  private ePrev = false; // Eキーのエッジ検出用（ジップライン乗降）
  private rooftopRound = 0; // サバイバルの現在ラウンド（ラウンド切替時の再配置検知用）
  private spectatingTarget: string | null = null; // サバイバル脱落後に追従する生存者ID
  private swayPhase = 0; // スナイパー息継ぎ揺れの位相
  private holdBreathTime = 0; // 止息（Shift長押し）の経過秒
  // ルーフトップの演出：収縮ゾーンの赤フォグ markers と、ジップライン滑走スパーク。
  private dangerMarkers = new Map<BuildingId, THREE.Object3D>();
  private sparks: Array<{ mesh: THREE.Mesh; life: number; vel: THREE.Vector3 }> = [];
  private sparkGeo = new THREE.PlaneGeometry(0.09, 0.09);
  private sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private scoreboardHeld = false; // TAB長押し（TDMスコアボード表示）

  private pauseOverlay: HTMLElement | null = null; // PC版Escの一時停止オーバーレイ

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
    this.sound = new SoundSystem();
    this.settings = new SettingsUI(this.input, this.sound);

    // ステージ・プレイヤー・武器・HUD
    this.stage = new Stage(this.scene);
    this.player = new PlayerController(this.stage.colliders);
    this.hud = new HUD();
    this.weapons = new WeaponSystem(this.camera, this.scene, this.input, this.stage, this.hud, this.sound);
    this.knifeVm = new KnifeViewmodel(this.camera);
    this.kickVm = new KickViewmodel(this.camera);
    this.slashTrail = new SlashTrail(this.scene);
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
      new TowerMode(),
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

    // Esc（ポインタロック解除）でプレイ中なら一時停止メニューを出す（PCのみ）
    document.addEventListener("pointerlockchange", () => {
      if (
        document.pointerLockElement === null &&
        this.screen === "playing" &&
        !this.suppressUnlockMenu &&
        !TouchControls.isTouchDevice()
      ) {
        this.showPauseMenu();
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

  // ホーム画面（SKYFRAMEロビー）を表示する（プレイは一時停止）
  private showMenu(): void {
    this.hidePauseOverlay();
    this.screen = "menu";
    this.paused = true;
    this.melee.cancel();
    if (this.online) this.leaveOnline();
    this.modeManager.stop(this.ctx);
    const modes = this.modeManager.list().map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
    }));
    // 旧モード選択UIは隠し、ホーム画面に切り替える（リザルト表示には ModeUI を引き続き使用）
    this.ui.hideAll();
    // ホーム画面ではタッチ操作UIを隠す（プレイ中だけ表示する）
    if (TouchControls.isTouchDevice()) this.touch.setPlayVisible(false);
    this.home.show({
      modes,
      onPlay: (id: string) => this.beginMode(id),
      onOnline: () => {
        this.home.hide();
        this.openLobby();
      },
      stages: STAGE_LIST.map((s) => ({ id: s.id, label: s.label })),
      selectedStage: this.selectedStageId,
      onStage: (sid: string) => {
        this.selectedStageId = sid as StageId;
      },
      difficulties: [
        { id: "normal", label: "NORMAL" },
        { id: "hard", label: "HARD" },
      ],
      selectedDifficulty: this.selectedDifficulty,
      onDifficulty: (did: string) => {
        this.selectedDifficulty = did === "hard" ? "hard" : "normal";
      },
      onSettings: () => this.settings.open(),
    });
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
    this.home.hide();
    this.screen = "playing";
    this.suppressUnlockMenu = false;
    // 端末に応じて操作方式を有効化（タッチ or マウス固定）。
    // タッチ端末ではプレイ中だけタッチUIを表示する。
    if (TouchControls.isTouchDevice()) {
      this.touch.setPlayVisible(true);
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
    this.weapons.unlock(); // オフラインモードでは武器固定を解除（ROOFTOP DUEL対策）
    this.modeManager.start(id, this.ctx, now);
    // ステージのスポーン地点から開始する（SKYFRAMEは南ゲート前）
    const s = this.stage.playerSpawn;
    this.player.respawn(s.x, s.y, s.z);
    this.paused = false;
  }

  // 接続先のWebSocket URL（本番は VITE_WS_URL、未設定ならローカル）。
  private wsUrl(): string {
    // import.meta.env.VITE_WS_URL は Vite がビルド時に静的置換する。
    // 中間変数へ入れると置換されないため、必ずこの形のまま直接参照する（型のため最小キャスト）。
    const url = (import.meta as unknown as { env: { VITE_WS_URL?: string } })
      .env.VITE_WS_URL;
    return url || "ws://localhost:8080";
  }

  // ロビーを開く。ネットワークイベントを1回だけ結線し、作成/参加の操作を受ける。
  private openLobby(): void {
    this.wireNetwork();
    const url = this.wsUrl();
    this.lobby.show({
      onCreate: (mode: string, maxPlayers: number) => {
        this.ensureConnected(url)
          .then(() =>
            this.network
              .createRoom(
                maxPlayers,
                mode,
                mode === "rooftop" || mode === "rooftop_sv" ? "skyline" : this.selectedStageId
              )
              .then(({ roomCode }) => {
                this.lobby.setCode(roomCode);
                this.lobby.setRoster(
                  this.network.players.length,
                  this.network.maxPlayers,
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
                  this.network.maxPlayers,
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
        this.showMenu(); // ホーム画面に戻す（素のステージに取り残されるのを防ぐ）
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
      this.lobby.setRoster(players.length, this.network.maxPlayers, this.network.isHost);
    });
    this.network.on("gameStart", (info) => this.onGameStart(info.mode, info.stage));
    this.network.on("worldState", (world) => this.onWorldState(world));
    this.network.on("playerLeft", (info) => this.removeGhost(info.playerId));
    this.network.on("error", (e) => this.lobby.setError(this.errMessage(e)));
    this.network.on("close", () => {
      if (this.online) this.leaveOnline();
    });
  }

  // ホストの「ゲーム開始」でサーバーから GAME_START が来たとき。
  // mode が "tdm" ならチームデスマッチ、それ以外は自由移動（ゴースト表示）。
  private onGameStart(mode: string, stage: string): void {
    this.onlineMode = mode;
    this.lobby.hide();
    this.ui.hideAll();
    this.screen = "playing";
    this.suppressUnlockMenu = false;
    if (TouchControls.isTouchDevice()) this.touch.setPlayVisible(true);
    else this.input.requestLock();

    this.melee.cancel();
    this.modeManager.stop(this.ctx);
    const sid: StageId =
      stage === "dusk" || stage === "skyframe" || stage === "skyline"
        ? (stage as StageId)
        : this.selectedStageId;
    this.switchStage(sid);
    // ROOFTOP DUEL はスナイパー専用。武器を固定する（他オンラインモードでは解除）。
    if (mode === "rooftop" || mode === "rooftop_sv") this.weapons.lockTo(WeaponKind.Sniper);
    else this.weapons.unlock();
    const sp = this.stage.playerSpawn;
    this.player.respawn(sp.x, sp.y, sp.z);
    this.health.reset(100);

    // フェーズ2：戦闘をサーバー権威にする結線
    this.predictor.reset();
    this.onlineSeq = 0;
    this.onlineThrowCd = 0;
    this.health.show();
    this.grenades.setEnabled(false); // ローカル投擲は使わずサーバー権威に任せる
    this.weapons.onShot = (origin, dir, damage) =>
      this.network.sendShot(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: dir.x, y: dir.y, z: dir.z },
        this.onlineSeq,
        damage
      );
    // ホストはステージの当たり判定をサーバーへ送る（グレネード物理・遮蔽判定用）
    if (this.network.isHost) {
      this.network.sendColliders(
        this.stage.colliders.map((b) => ({
          min: { x: b.min.x, y: b.min.y, z: b.min.z },
          max: { x: b.max.x, y: b.max.y, z: b.max.z },
        }))
      );
    }
    this.network.startPing();

    // モード別HUD・近接通知・速度制限の初期化
    this.teamHud.hide();
    this.coopHud.hide();
    this.rooftopHud.hide();
    this.ziplineRide = null;
    this.rooftopRound = 0;
    this.spectatingTarget = null;
    this.clearRooftopFx();
    this.melee.onSwingHit = null;
    this.player.setSpeedCap(null);
    if (mode === "tdm") {
      this.tdmResultShown = false;
      this.teamHud.show();
      this.melee.onSwingHit = (kind) => this.network.sendMelee(kind);
    } else if (mode === "coop") {
      this.coopResultShown = false;
      this.coopHud.show();
      // コープでも近接は敵に当たる
      this.melee.onSwingHit = (kind) => this.network.sendMelee(kind);
    } else if (mode === "rooftop" || mode === "rooftop_sv") {
      this.rooftopResultShown = false;
      this.rooftopHud.show();
      // ルーフトップでも近接（ナイフ／キック）は有効
      this.melee.onSwingHit = (kind) => this.network.sendMelee(kind);
    }
    // タッチ端末のインタラクト(E)ボタン：コープ＝蘇生／ルーフトップ＝ジップライン乗降で表示する
    if (mode === "coop") this.touch.setInteractVisible(true, "蘇生");
    else if (mode === "rooftop" || mode === "rooftop_sv") this.touch.setInteractVisible(true, "ジップ");
    else this.touch.setInteractVisible(false, "蘇生");
    // 止息はルーフトップのみ、スコアボードはTDM/ルーフトップで表示（PC操作との親和性）
    const rooftopMode = mode === "rooftop" || mode === "rooftop_sv";
    this.touch.setHoldBreathVisible(rooftopMode);
    this.touch.setScoreboardVisible(rooftopMode || mode === "tdm");

    this.online = true;
    this.paused = false;
  }

  // 自分の状態送信＋オンライン用グレネード入力＋ゴースト補間（毎フレーム）。
  // ROOFTOP DUEL 系（デスマッチ／サバイバル）かどうか。
  private isRooftop(): boolean {
    const m = this.onlineMode;
    return m === "rooftop" || m === "rooftop_sv";
  }

  // サバイバルのラウンド切替時、自分を棟の屋上スポーンへ再配置する（IDで棟を分散）。
  private respawnToRooftopSpawn(): void {
    const spawns = roofSpawnPoints();
    if (spawns.length === 0) return;
    let h = 0;
    const id = this.network.playerId || "";
    for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % spawns.length;
    const s = spawns[h].pos;
    this.player.respawn(s.x, s.y, s.z);
    this.ziplineRide = null;
  }

  // ===== ルーフトップ演出（収縮ゾーンの赤フォグ／ジップライン滑走スパーク）=====
  private makeDangerMarker(b: BuildingDef): THREE.Object3D {
    const g = new THREE.Group();
    const h = 8;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(b.sizeX, h, b.sizeZ),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.12, depthWrite: false })
    );
    box.position.set(b.cx, b.roofY + h / 2, b.cz);
    g.add(box);
    const light = new THREE.PointLight(0xff3020, 1.2, 32, 2);
    light.position.set(b.cx, b.roofY + 4, b.cz);
    g.add(light);
    return g;
  }

  private disposeMarker(m: THREE.Object3D): void {
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && typeof mat.dispose === "function") mat.dispose();
    });
  }

  // 危険ゾーン（サバイバル収縮）の赤フォグを world.rooftop.dangerZones と同期する。
  private syncDangerZones(zones: BuildingId[]): void {
    for (const id of zones) {
      if (!this.dangerMarkers.has(id)) {
        const b = BUILDINGS.find((x) => x.id === id);
        if (b) {
          const m = this.makeDangerMarker(b);
          this.scene.add(m);
          this.dangerMarkers.set(id, m);
        }
      }
    }
    for (const [id, m] of this.dangerMarkers) {
      if (!zones.includes(id)) {
        this.scene.remove(m);
        this.disposeMarker(m);
        this.dangerMarkers.delete(id);
      }
    }
  }

  // ジップライン滑走中、ワイヤ接点（プレイヤー頭上）に白いスパークを散らす。
  private spawnZiplineSpark(): void {
    if (this.sparks.length > 40) return;
    const p = this.player.position;
    const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
    m.position.set(
      p.x + (Math.random() - 0.5) * 0.25,
      p.y + 1.75 + (Math.random() - 0.5) * 0.12,
      p.z + (Math.random() - 0.5) * 0.25
    );
    this.scene.add(m);
    this.sparks.push({
      mesh: m,
      life: 0.25,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, -Math.random() * 2.5, (Math.random() - 0.5) * 2),
    });
  }

  // 毎フレーム：スパークの寿命更新と、危険ゾーン光の脈動。
  private updateRooftopFx(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0, s.life / 0.25));
      s.mesh.lookAt(this.camera.position);
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
      }
    }
    if (this.dangerMarkers.size > 0) {
      const pulse = 1.0 + Math.sin(performance.now() / 220) * 0.45;
      for (const m of this.dangerMarkers.values()) {
        for (const c of m.children) {
          const light = c as THREE.PointLight;
          if (light.isPointLight) light.intensity = pulse;
        }
      }
    }
  }

  // ルーフトップ演出を全消去（開始/離脱時）。
  private clearRooftopFx(): void {
    for (const m of this.dangerMarkers.values()) {
      this.scene.remove(m);
      this.disposeMarker(m);
    }
    this.dangerMarkers.clear();
    for (const s of this.sparks) this.scene.remove(s.mesh);
    this.sparks = [];
  }

  // ROOFTOP DUEL：ジップラインの乗降。滑走中は true を返して通常移動をスキップさせる。
  // サーバーへ承認要求（useZipline）を送りつつ、クライアントがワイヤ上を滑走する。
  // 起点付近で[E]→滑走開始、滑走中に[E]→途中離脱（落下）、終点到達で自動降車。
  private updateZiplineRide(dt: number, input: InputState): boolean {
    if (!this.isRooftop()) return false;
    const ePress = input.interactHeld && !this.ePrev;
    this.ePrev = input.interactHeld;

    if (this.ziplineRide) {
      const r = this.ziplineRide;
      if (ePress) {
        // 途中離脱 → 通常物理へ戻して落下させる
        this.ziplineRide = null;
        this.rooftopHud.setZiplinePrompt(false);
        return false;
      }
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      this.player.position.set(
        r.from.x + (r.to.x - r.from.x) * k,
        r.from.y + (r.to.y - r.from.y) * k - 1.6,
        r.from.z + (r.to.z - r.from.z) * k
      );
      this.player.velocity.set(0, 0, 0);
      this.spawnZiplineSpark();
      if (k >= 1) {
        this.ziplineRide = null;
        this.rooftopHud.setZiplinePrompt(false);
      }
      return true;
    }

    // 起点アンカー付近の空きジップラインを探す
    let near: ZiplineState | null = null;
    for (const z of this.rooftopZiplines) {
      if (z.inUse && z.inUse !== this.network.playerId) continue;
      if (z.cooldown > 0) continue;
      const dx = this.player.position.x - z.from.x;
      const dz = this.player.position.z - z.from.z;
      if (Math.hypot(dx, dz) <= 2.5 && Math.abs(this.player.position.y - (z.from.y - 1.1)) <= 2.5) {
        near = z;
        break;
      }
    }
    this.rooftopHud.setZiplinePrompt(!!near);
    if (near && ePress) {
      this.network.useZipline(near.id);
      this.ziplineRide = {
        from: new THREE.Vector3(near.from.x, near.from.y, near.from.z),
        to: new THREE.Vector3(near.to.x, near.to.y, near.to.z),
        t: 0,
        dur: Math.max(0.5, near.length / near.speed),
      };
      this.rooftopHud.setZiplinePrompt(false);
      return true;
    }
    return false;
  }

  private updateOnline(inputState: InputState, dt: number): void {
    const p = this.player;
    this.onlineSeq = this.predictor.nextSeq();
    const state: PlayerState = {
      playerId: this.network.playerId,
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      velocity: { x: p.velocity.x, y: p.velocity.y, z: p.velocity.z },
      yaw: this.input.getYaw(),
      pitch: this.input.getPitch(),
      hp: this.health.getCurrent(),
      onGround: p.grounded,
      seq: this.onlineSeq,
    };
    this.network.sendPlayerState(state);
    this.predictor.record(this.onlineSeq, state.position);

    // グレネード投擲（サーバーが弾道を計算）。共通0.5秒クールダウン。
    this.onlineThrowCd = Math.max(0, this.onlineThrowCd - dt);
    if (this.onlineThrowCd <= 0) {
      let gtype: "frag" | "flash" | null = null;
      if (inputState.fragReleased) gtype = "frag";
      else if (inputState.flashThrow) gtype = "flash";
      if (gtype) {
        const t = this.grenades.computeThrow();
        this.network.throwGrenade(
          gtype,
          { x: t.origin.x, y: t.origin.y, z: t.origin.z },
          { x: t.velocity.x, y: t.velocity.y, z: t.velocity.z }
        );
        this.weapons.triggerThrowDip();
        this.onlineThrowCd = 0.5;
      }
    }

    for (const rp of this.remotePlayers.values()) rp.update(100); // renderDelay 100ms

    // TDM：TAB長押しでスコアボード表示（onWorldStateで反映）
    this.scoreboardHeld = inputState.scoreboardHeld;

    // コープ：敵ゴーストを毎フレーム滑らかに寄せ、蘇生入力（E長押し）を送る。
    if (this.onlineMode === "coop") {
      for (const re of this.remoteEnemies.values()) re.update(dt);
      this.network.sendRevive(inputState.interactHeld);
    }
  }

  // 受信した世界状態でゴースト・サーバー弾・HP・イベントを反映する。
  private onWorldState(world: WorldState): void {
    if (!this.online) return;
    // プレイヤー（自分のHPはサーバー権威、他はゴースト）
    for (const ps of world.players) {
      if (ps.playerId === this.network.playerId) {
        this.health.set(ps.hp);
        continue;
      }
      let rp = this.remotePlayers.get(ps.playerId);
      if (!rp) {
        rp = new RemotePlayer(ps.playerId);
        this.remotePlayers.set(ps.playerId, rp);
        this.scene.add(rp.group);
      }
      rp.receiveState(ps);
    }
    // サーバー権威のグレネード弾
    const seen = new Set<string>();
    for (const pr of world.projectiles) {
      seen.add(pr.id);
      const existing = this.remoteProjectiles.get(pr.id);
      if (!existing) {
        const rp = new RemoteProjectile(pr);
        this.remoteProjectiles.set(pr.id, rp);
        this.scene.add(rp.group);
      } else {
        existing.update(pr);
      }
    }
    for (const id of [...this.remoteProjectiles.keys()]) {
      if (!seen.has(id)) this.removeProjectile(id);
    }
    // 単発イベント（命中・撃破・爆発）
    for (const ev of world.events) this.applyEvent(ev);

    // チームデスマッチ：スコア・タイマー・死亡表示の更新、終了時のリザルト。
    if (this.onlineMode === "tdm" && world.tdm) {
      const nameOf = (id: string): string => this.playerName(id);
      this.teamHud.update(world.tdm, this.network.playerId, nameOf, this.scoreboardHeld);
      if (world.tdm.phase === "RESULT" && !this.tdmResultShown) {
        this.tdmResultShown = true;
        this.suppressUnlockMenu = true;
        if (document.exitPointerLock) document.exitPointerLock();
        this.teamHud.showResult(world.tdm, this.network.playerId, nameOf, () => this.showMenu());
      }
    }

    // コープ：敵描画・HUD更新・ダウン時の移動制限・終了時のリザルト。
    if (this.onlineMode === "coop" && world.coop) {
      this.syncEnemies(world.coop.enemies);
      this.coopHud.update(world.coop, this.network.playerId, (id) => this.playerName(id));
      const me = world.coop.players.find((p) => p.playerId === this.network.playerId);
      if (me) {
        if (me.status === "DOWN") this.player.setSpeedCap(1.5);
        else if (me.status === "DEAD") this.player.setSpeedCap(0);
        else this.player.setSpeedCap(null);
      }
      if (world.coop.phase === "RESULT" && !this.coopResultShown) {
        this.coopResultShown = true;
        this.suppressUnlockMenu = true;
        if (document.exitPointerLock) document.exitPointerLock();
        this.coopHud.showResult(world.coop, () => this.showMenu());
      }
    }

    if (this.isRooftop() && world.rooftop) {
      this.rooftopZiplines = world.rooftop.ziplines;
      this.syncDangerZones(world.rooftop.dangerZones);
      // サバイバル：ラウンドが進んだら自分を屋上スポーンへ再配置する（サーバーは全員HP全快）。
      if (world.rooftop.rule === "survival" && world.rooftop.round > this.rooftopRound) {
        const prev = this.rooftopRound;
        this.rooftopRound = world.rooftop.round;
        if (prev > 0) this.respawnToRooftopSpawn();
      }
      // サバイバル：脱落後は生存者を観戦する（サーバー指定の spectatingId を追従）。
      const meP = world.rooftop.players.find((p) => p.playerId === this.network.playerId);
      if (world.rooftop.rule === "survival" && world.rooftop.phase === "PLAYING" && meP && !meP.isAlive) {
        this.spectatingTarget = meP.spectatingId;
        this.rooftopHud.setSpectating(meP.spectatingId ? this.playerName(meP.spectatingId) : null);
      } else {
        this.spectatingTarget = null;
        this.rooftopHud.setSpectating(null);
      }
      this.rooftopHud.update(world.rooftop, this.network.playerId, (id) => this.playerName(id));
      if (world.rooftop.phase === "RESULT" && !this.rooftopResultShown) {
        this.rooftopResultShown = true;
        this.suppressUnlockMenu = true;
        if (document.exitPointerLock) document.exitPointerLock();
        this.rooftopHud.showResult(
          world.rooftop,
          this.network.playerId,
          (id) => this.playerName(id),
          () => this.showMenu()
        );
      }
    }
  }

  // サーバー権威の敵ゴーストを生成・更新・破棄する。
  private syncEnemies(list: ServerEnemyState[]): void {
    const seen = new Set<string>();
    for (const es of list) {
      seen.add(es.id);
      let re = this.remoteEnemies.get(es.id);
      if (!re) {
        re = new RemoteEnemy(es);
        this.remoteEnemies.set(es.id, re);
        this.scene.add(re.group);
      } else {
        re.setState(es);
      }
    }
    for (const id of [...this.remoteEnemies.keys()]) {
      if (!seen.has(id)) this.removeEnemy(id);
    }
  }

  private removeEnemy(id: string): void {
    const re = this.remoteEnemies.get(id);
    if (re) {
      this.scene.remove(re.group);
      re.dispose();
      this.remoteEnemies.delete(id);
    }
  }

  // KILLイベントのキルフィード文言（種別アイコン）。
  private killNote(killType: unknown): string {
    if (killType === "melee") return "🔪";
    if (killType === "grenade") return "💣";
    if (killType === "high") return "🎯";
    return "🔫";
  }

  private playerName(id: string): string {
    const info = this.network.players.find((pl) => pl.playerId === id);
    return info ? info.name : "Player";
  }

  private applyEvent(ev: GameEvent): void {
    const self = this.network.playerId;
    const p = ev.payload;
    if (ev.type === "HIT") {
      if (p.shooterId === self) this.hud.flashHitmarker(); // 自分が当てた → ヒットマーカー
    } else if (ev.type === "KILL") {
      if (p.targetId === self) {
        const sp = this.stage.playerSpawn;
        this.player.respawn(sp.x, sp.y, sp.z); // 自分が倒された → スポーンへ
      }
      if (this.onlineMode === "tdm") {
        // チームカラー付きキルフィード
        const team = (p.team === "BLUE" ? "BLUE" : "RED") as Team;
        this.teamHud.addKill(
          this.playerName(String(p.shooterId)),
          this.playerName(String(p.targetId)),
          team,
          this.killNote(p.killType)
        );
      } else if (this.isRooftop()) {
        // ルーフトップのキルフィード（ヘッドショット／近接を強調）
        const tag = p.melee ? "近接" : p.headshot ? "HEADSHOT" : "";
        this.rooftopHud.addKill(
          this.playerName(String(p.shooterId)),
          this.playerName(String(p.targetId)),
          tag,
          p.shooterId === self
        );
      } else if (p.shooterId === self) {
        this.hud.addKillFeed("🎯 ELIMINATED");
      }
    } else if (ev.type === "GRENADE_EXPLODE") {
      this.grenades.explodeFragAt(Number(p.x), Number(p.y), Number(p.z));
    } else if (ev.type === "FLASHBANG_EXPLODE") {
      this.grenades.explodeFlashAt(Number(p.x), Number(p.y), Number(p.z));
    } else if (ev.type === "COOP_BONUS") {
      // コープの協力ボーナス（フォローキル＋300／フラッシュアシスト＋150）
      const name = this.playerName(String(p.playerId));
      const label = p.kind === "FOLLOW_KILL" ? "FOLLOW KILL" : "FLASH ASSIST";
      this.coopHud.addFeed(`${name}  ${label} +${Number(p.points)}`);
    }
  }

  private removeProjectile(id: string): void {
    const rp = this.remoteProjectiles.get(id);
    if (rp) {
      this.scene.remove(rp.group);
      rp.dispose();
      this.remoteProjectiles.delete(id);
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
    this.onlineMode = "";
    this.weapons.onShot = null;
    this.melee.onSwingHit = null;
    this.teamHud.hide();
    this.coopHud.hide();
    this.rooftopHud.hide();
    this.ziplineRide = null;
    this.rooftopRound = 0;
    this.spectatingTarget = null;
    this.clearRooftopFx();
    this.touch.setReviveVisible(false);
    this.touch.setHoldBreathVisible(false);
    this.touch.setScoreboardVisible(false);
    this.player.setSpeedCap(null);
    this.network.stopPing();
    for (const id of [...this.remotePlayers.keys()]) this.removeGhost(id);
    for (const id of [...this.remoteProjectiles.keys()]) this.removeProjectile(id);
    for (const id of [...this.remoteEnemies.keys()]) this.removeEnemy(id);
    this.predictor.reset();
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

  // ===== PC版 Esc の一時停止メニュー =====
  // Escでポインタロックが外れたら、対戦から抜けずにこのメニューを出す。
  private showPauseMenu(): void {
    this.paused = true;
    this.melee.cancel();
    if (!this.pauseOverlay) this.pauseOverlay = this.buildPauseOverlay();
    this.pauseOverlay.style.display = "flex";
  }

  // 「再開」：ポインタロックを取り直してゲームに戻る（クリックがユーザー操作なのでロック可能）。
  private resumeFromPause(): void {
    this.hidePauseOverlay();
    this.paused = false;
    this.input.requestLock();
  }

  private hidePauseOverlay(): void {
    if (this.pauseOverlay) this.pauseOverlay.style.display = "none";
  }

  private buildPauseOverlay(): HTMLElement {
    const ov = document.createElement("div");
    ov.id = "pc-pause";
    ov.style.cssText =
      "position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:rgba(8,10,14,0.72);font-family:system-ui,sans-serif;";

    const title = document.createElement("div");
    title.textContent = "一時停止";
    title.style.cssText =
      "color:#ffe6b0;font-size:40px;font-weight:900;letter-spacing:0.12em;text-shadow:0 2px 10px rgba(0,0,0,0.9);";

    const hint = document.createElement("div");
    hint.textContent = "「再開」でゲームに戻ります（オンライン対戦は進行したままです）";
    hint.style.cssText = "color:#c9d2dc;font-size:13px;";

    const resume = document.createElement("button");
    resume.textContent = "再開";
    resume.style.cssText =
      "padding:12px 34px;font-size:17px;font-weight:800;color:#1a1a1a;background:#ffd27a;border:none;border-radius:10px;cursor:pointer;";
    resume.onclick = () => this.resumeFromPause();

    const settingsBtn = document.createElement("button");
    settingsBtn.textContent = "設定";
    settingsBtn.style.cssText =
      "padding:10px 28px;font-size:14px;font-weight:800;color:#eee;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);border-radius:10px;cursor:pointer;";
    settingsBtn.onclick = () => this.settings.open();

    const toMenu = document.createElement("button");
    toMenu.textContent = "メニューに戻る";
    toMenu.style.cssText =
      "padding:10px 28px;font-size:14px;font-weight:800;color:#eee;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.25);border-radius:10px;cursor:pointer;";
    toMenu.onclick = () => {
      this.hidePauseOverlay();
      this.showMenu();
    };

    ov.appendChild(title);
    ov.appendChild(hint);
    ov.appendChild(resume);
    ov.appendChild(settingsBtn);
    ov.appendChild(toMenu);
    document.body.appendChild(ov);
    return ov;
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

    // プレイヤー更新（ROOFTOP DUEL：ジップライン滑走中は通常移動を止めワイヤ上を移動）
    if (!this.updateZiplineRide(dt, inputState)) {
      this.player.update(dt, inputState);
    }

    // カメラ位置＝目線、向き＝マウスで作ったyaw/pitch（反動はInput側に加算済み）
    this.player.getEyePosition(this.eye);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.input.getPitch(), this.input.getYaw(), 0, "YXZ");

    // スナイパー息継ぎ：スコープADS中、照準をゆっくり楕円に揺らす（周期3秒、世界が揺れるので実弾もブレる）。
    // 止息（Shift）を押している間2秒までは揺れが1/3に収束し、2秒を超えると息切れで元に戻る。
    const scopeAds = this.weapons.getScopeAds();
    this.input.setAdsActive(scopeAds > 0.5); // スコープ中はADS感度に切替
    if (scopeAds > 0.5) {
      this.swayPhase += dt;
      if (inputState.sprint) this.holdBreathTime += dt;
      else this.holdBreathTime = 0;
      const holding = inputState.sprint && this.holdBreathTime < 2.0;
      const amp = 0.007 * scopeAds * (holding ? 1 / 3 : 1);
      const w = (Math.PI * 2) / 3; // 周期3秒
      this.camera.rotation.y += Math.sin(this.swayPhase * w) * amp;
      this.camera.rotation.x += Math.cos(this.swayPhase * w) * amp * 0.6;
    } else {
      this.holdBreathTime = 0;
    }

    // ルーフトップ演出（スパーク寿命・危険ゾーン脈動）を毎フレーム更新
    this.updateRooftopFx(dt);

    // オンライン中：自分の状態を送信し、他プレイヤーのゴーストを補間更新する
    if (this.online) this.updateOnline(inputState, dt);

    // 観戦カメラ：サバイバルで脱落後、生存者を三人称で追ってカメラを上書きする
    if (this.spectatingTarget) {
      const rp = this.remotePlayers.get(this.spectatingTarget);
      if (rp) {
        const yaw = rp.group.rotation.y;
        const t = rp.group.position;
        this.camera.position.set(t.x + Math.sin(yaw) * 4, t.y + 2.6, t.z + Math.cos(yaw) * 4);
        this.camera.lookAt(t.x, t.y + 1.6, t.z);
      }
    }

    // 武器更新（速度連動FOVにランジ状態を反映）
    this.weapons.setMeleeLunging(this.melee.lungeActive());
    this.weapons.update(dt, inputState, this.player.horizontalSpeed, now);
    // グレネード（フラグG／フラッシュC、押した瞬間に投擲）。カメラ確定後に処理する。
    // 戦闘中の死亡→復活の瞬間に、所持・投擲物・ホワイトアウトをリセットする。
    // オンライン中はグレネードをサーバー権威で扱うため、ローカルの投擲入力は処理しない
    // （投擲は updateOnline からサーバーへ送る）。爆発などの演出更新のみ毎フレーム回す。
    if (!this.online) {
      this.grenades.setProvider(this.ctx.meleeProvider ?? null);
      if (this.wasDead && !dead) this.grenades.reset();
      this.wasDead = dead;
      this.grenades.handleInput(inputState, !dead);
    }
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
