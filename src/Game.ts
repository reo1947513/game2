import * as THREE from "three";
import { Input } from "./Input";
import { Stage } from "./Stage";
import { PlayerController } from "./PlayerController";
import { WeaponSystem } from "./WeaponSystem";
import { HUD } from "./HUD";
import { TouchControls } from "./TouchControls";
import { ModeUI } from "./ModeUI";
import { GameContext, ModeManager, TargetRush, MovingRange, Parkour, WaveSurvival, BotDeathmatch } from "./GameModes";
import { Health } from "./Health";
import { KickView } from "./KickView";

// すべてのシステムを組み合わせて毎フレーム動かす中心クラスです。
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private input: Input;
  private stage: Stage;
  private player: PlayerController;
  private weapons: WeaponSystem;
  private kickView: KickView;
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
    this.kickView = new KickView(this.camera);

    // タッチ操作レイヤー（スマホ・タブレット用）。一時停止メニューから設定を開く。
    this.touch = new TouchControls(this.input, {
      onPause: () => this.setPaused(true),
      onResume: () => this.setPaused(false),
    });

    // モード関連（選択画面・結果画面・モード中の表示と、モードの管理）
    this.ui = new ModeUI();
    this.health = new Health();
    this.modeManager = new ModeManager([new TargetRush(), new MovingRange(), new Parkour(), new WaveSurvival(), new BotDeathmatch()]);
    this.ctx = {
      scene: this.scene,
      stage: this.stage,
      weapons: this.weapons,
      ui: this.ui,
      player: this.player,
      health: this.health,
      finish: (lines: string[]) => this.onModeFinish(lines),
      kickView: this.kickView,
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
    this.modeManager.stop(this.ctx);
    this.ui.showMenu(
      this.modeManager.list().map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
      })),
      (id: string) => this.beginMode(id)
    );
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
    this.modeManager.start(id, this.ctx, now);
    this.paused = false;
  }

  // モードが終了したとき（結果を表示し、操作を止める）
  private onModeFinish(lines: string[]): void {
    this.screen = "result";
    this.paused = true;
    this.suppressUnlockMenu = true;
    if (document.exitPointerLock) document.exitPointerLock();
    this.ui.showResult(lines, () => this.showMenu());
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

    // プレイヤー更新
    this.player.update(dt, inputState);

    // カメラ位置＝目線、向き＝マウスで作ったyaw/pitch（反動はInput側に加算済み）
    this.player.getEyePosition(this.eye);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.input.getPitch(), this.input.getYaw(), 0, "YXZ");

    // 武器・的・HUD更新
    this.weapons.update(dt, inputState, this.player.horizontalSpeed, now);
    this.kickView.update(dt);
    this.stage.updateTargets(now);
    // モードが蹴りや投擲の判定に使えるよう、その瞬間の入力を渡す
    this.ctx.frameInput = inputState;
    // 現在のモードの更新（スコア・残り時間・的の動き・終了判定など）
    this.modeManager.update(this.ctx, dt, now);
    this.hud.update(dt);
    this.hud.setStance(this.player.stance);
    this.hud.setSpeed(this.player.horizontalSpeed);

    this.renderer.render(this.scene, this.camera);
  };
}
