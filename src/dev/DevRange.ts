import * as THREE from "three";
import type { Game } from "../Game";
import { CameraMode, DevApp, DevCtx, DevPanel } from "./devTypes";
import { DevHUD } from "./DevHUD";
import { DevCamera } from "./DevCamera";
import { WeaponPanel } from "./panels/WeaponPanel";
import { StagePanel } from "./panels/StagePanel";
import { TargetsPanel } from "./panels/TargetsPanel";
import { CameraPanel } from "./panels/CameraPanel";
import { StatsPanel } from "./panels/StatsPanel";
import { AssetsPanel } from "./panels/AssetsPanel";
import { buildRange } from "./RangeStage";
import { buildShootingGallery } from "./gallery/ShootingGallery";
import { GalleryManager } from "./gallery/GalleryManager";

// ===== 開発者テストレンジ DEV RANGE（オーケストレータ）=====
//
// VITE_DEV_RANGE=true のときだけ動的 import される。本番ビルドには一切含まれない。
// Game.devContext() で内部参照だけを受け取り、テストレンジ用の独自ループを回す。
// タブ（WEAPON / STAGE / TARGETS / CAMERA / STATS）と、カメラモード（FPS/Free/Orbit）、
// グローバルトグル（回復 / 無敵 / 飛行 / 座標表示）を束ねる。

type TabId = "assets" | "weapon" | "stage" | "targets" | "camera" | "stats";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "assets", label: "ASSETS" },
  { id: "weapon", label: "WEAPON" },
  { id: "stage", label: "STAGE" },
  { id: "targets", label: "TARGETS" },
  { id: "camera", label: "CAMERA" },
  { id: "stats", label: "STATS" },
];

export class DevRange implements DevApp {
  readonly ctx: DevCtx;

  private hud!: DevHUD;
  private devCamera: DevCamera;

  private clock = new THREE.Clock();
  private eye = new THREE.Vector3();

  private content!: HTMLDivElement;
  private panelRoot: HTMLDivElement | null = null;
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private panels!: Record<TabId, DevPanel>;
  private activeTab: TabId = "assets";

  private cameraMode: CameraMode = "fps";
  private fullscreen = true; // パネル全画面（=一覧プレビュー）。false の間は FPS でバーは非表示。
  private running = false;
  private onExit: (() => void) | null = null;
  private canvasClick: (() => void) | null = null;
  private fsBtn: HTMLButtonElement | null = null; // 全画面トグルボタン（プレビュー側の「▽通常表示」）
  private onLockChange: (() => void) | null = null; // ESC等でポインタロックが外れたら一覧プレビューを開く
  private onEscKey: ((e: KeyboardEvent) => void) | null = null; // プレビュー中ESCで閉じる／未ロック時ESCで開く

  private galleryMgr: GalleryManager;

  constructor(game: Game) {
    this.ctx = game.devContext();
    this.devCamera = new DevCamera(this.ctx);
    this.galleryMgr = new GalleryManager(this.ctx);
  }

  start(onExit?: () => void): void {
    this.onExit = onExit ?? null;
    this.running = true;
    this.hud = new DevHUD(() => this.exit());
    this.injectStyle();
    this.panels = {
      assets: new AssetsPanel(this),
      weapon: new WeaponPanel(this),
      stage: new StagePanel(this),
      targets: new TargetsPanel(this),
      camera: new CameraPanel(this),
      stats: new StatsPanel(this),
    };
    this.buildPanel();
    this.mountTab(this.activeTab);

    // ゲーム画面クリックで視点ロック（FPS/Free のみ。Orbit はドラッグ操作のため除外）。
    this.canvasClick = () => {
      if (this.cameraMode !== "orbit") this.ctx.input.requestLock();
    };
    this.ctx.renderer.domElement.addEventListener("click", this.canvasClick);

    // ESC で一覧プレビューをトグル。FPS中はポインタロック中のためESCはブラウザがロック解除に使う。
    // よって「ロックが外れたら開く」をロック解除イベントで拾うのが確実（キー単体は届かないことがある）。
    this.onLockChange = () => {
      if (!document.pointerLockElement && !this.fullscreen) this.openPreview();
    };
    document.addEventListener("pointerlockchange", this.onLockChange);
    // 未ロック時のESC（プレビューを閉じる／ロックしていないFPSで開く）を capture で拾う。
    // パネルは keydown を stopPropagation するが、capture はそれより先に走るため確実に届く。
    this.onEscKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (this.fullscreen) this.closePreview();
      else if (!document.pointerLockElement) this.openPreview();
    };
    window.addEventListener("keydown", this.onEscKey, true);

    this.clock.start();
    this.loop();
  }

  // 終了：後始末してメニューへ戻すコールバックを呼ぶ。
  exit(): void {
    this.stop();
    if (this.onExit) this.onExit();
  }

  // 後始末：ループ停止・DOM撤去・的削除・トグル/フック/カメラを通常状態へ戻す。
  stop(): void {
    this.running = false;
    (this.panels.targets as TargetsPanel).dispose(); // 的削除＋命中フック解除
    (this.panels.weapon as WeaponPanel).resetAll(); // 武器スペックを既定へ復帰＋実モデル解除
    (this.panels.stage as StagePanel).clearStageTexture(); // ステージのテクスチャ試着を解除
    (this.panels.assets as AssetsPanel).dispose(); // ギャラリーの永続レンダラー解放
    this.galleryMgr.disable(); // SHOOTING GALLERY の的・敵を撤去＋フック解除・統計パネル非表示
    this.ctx.player.setFlyMode(false);
    this.ctx.health.setInvincible(false);
    this.ctx.input.setAdsActive(false);
    this.devCamera.setMode("fps"); // orbit リスナを外し FPS へ
    if (this.canvasClick) {
      this.ctx.renderer.domElement.removeEventListener("click", this.canvasClick);
      this.canvasClick = null;
    }
    if (this.onLockChange) {
      document.removeEventListener("pointerlockchange", this.onLockChange);
      this.onLockChange = null;
    }
    if (this.onEscKey) {
      window.removeEventListener("keydown", this.onEscKey, true);
      this.onEscKey = null;
    }
    this.fsBtn = null;
    if (this.panelRoot) {
      this.panelRoot.remove();
      this.panelRoot = null;
    }
    this.hud.dispose();
  }

  // ===== DevApp =====
  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.devCamera.setMode(mode);
    if (mode === "orbit") {
      if (document.exitPointerLock) document.exitPointerLock();
    } else {
      this.ctx.input.requestLock();
    }
  }

  getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  // 射撃場へ切り替える：専用レンジを読み込み、的＋敵を出して FPS で撃てる状態にする。
  enterRange(): void {
    this.cameraMode = "fps";
    this.devCamera.setMode("fps");
    this.galleryMgr.disable(); // 射撃場の的・フック・統計パネルを撤去してから簡易レンジへ
    this.ctx.stage.loadCustom(buildRange, "range");
    this.ctx.weapons.refreshShootables();
    const sp = this.ctx.stage.playerSpawn;
    this.ctx.player.respawn(sp.x, sp.y, sp.z);
    (this.panels.targets as TargetsPanel).spawnPreset();
    this.setFullscreen(false); // 射撃場に入ったら一覧プレビューを閉じてFPSへ
  }

  // 本格射撃場 SHOOTING GALLERY へ切り替える。
  enterGallery(): void {
    this.cameraMode = "fps";
    this.devCamera.setMode("fps");
    this.galleryMgr.clear();
    this.ctx.stage.loadCustom(buildShootingGallery, "gallery");
    this.ctx.weapons.refreshShootables();
    const sp = this.ctx.stage.playerSpawn;
    this.ctx.player.respawn(sp.x, sp.y, sp.z);
    this.galleryMgr.enable();
    this.galleryMgr.presetAccuracy(); // 初期は距離別の静止的
    this.setFullscreen(false); // 射撃場に入ったら一覧プレビューを閉じてFPSへ
  }

  getGallery(): GalleryManager {
    return this.galleryMgr;
  }

  // ===== 独自レンダーループ =====
  private loop = (): void => {
    if (!this.running) return; // stop() で停止
    requestAnimationFrame(this.loop);

    let dt = this.clock.getDelta();
    if (dt > 0.05) dt = 0.05;
    const now = performance.now() / 1000;

    // 全画面パネル表示中は 3D ビューがほぼ全面を覆われて見えない。
    // そのため 3D の更新・描画を丸ごと省き、表示中の DOM パネルと HUD だけ回す。
    // （ASSETS 等を眺めている間、裏で見えないシーンを毎フレーム描く無駄を止める。
    //   全画面を解除＝▽通常表示にすると下記の通常経路へ戻り、3D 描画が再開する。）
    if (this.fullscreen) {
      const panel = this.panels[this.activeTab];
      if (panel.update) panel.update(dt, now);
      this.hud.update(this.ctx.player);
      return;
    }

    const inputState = this.ctx.input.sample();

    if (this.cameraMode === "fps") {
      const active = this.ctx.input.isActive();
      if (!active) {
        inputState.forward = 0;
        inputState.right = 0;
        inputState.firing = false;
        inputState.aiming = false;
        inputState.jumpPressed = false;
      }
      this.ctx.player.update(dt, inputState);
      this.ctx.player.getEyePosition(this.eye);
      this.ctx.camera.position.copy(this.eye);
      this.ctx.camera.rotation.set(this.ctx.input.getPitch(), this.ctx.input.getYaw(), 0, "YXZ");
      this.ctx.input.setAdsActive(this.ctx.weapons.getScopeAds() > 0.5);
      this.ctx.weapons.update(dt, inputState, this.ctx.player.horizontalSpeed, now);
    } else {
      // Free / Orbit：プレイヤー・武器は更新せず、デバッグカメラがカメラを駆動する。
      this.devCamera.update(dt, inputState);
    }

    this.ctx.stage.updateTargets(now);
    this.galleryMgr.update(dt, now); // SHOOTING GALLERY の的・訓練敵（未使用時は空）

    const panel = this.panels[this.activeTab];
    if (panel.update) panel.update(dt, now);
    // 的はタブに関わらず常時更新（どのタブからでも撃って確認できるように）
    if (this.activeTab !== "targets") this.panels.targets.update?.(dt, now);

    this.hud.update(this.ctx.player);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
  };

  // ===== パネル構築 =====
  private buildPanel(): void {
    const root = document.createElement("div");
    root.id = "dev-range";
    // パネル内のキー入力をゲーム Input（window リスナ）へ漏らさない。
    root.addEventListener("keydown", (e) => e.stopPropagation());

    const bar = document.createElement("div");
    bar.className = "dr-bar";

    for (const t of TABS) {
      const b = document.createElement("button");
      b.className = "dr-tab" + (t.id === this.activeTab ? " active" : "");
      b.textContent = t.label;
      b.onclick = () => this.switchTab(t.id);
      this.tabButtons.set(t.id, b);
      bar.appendChild(b);
    }

    // 全画面トグル（プレビュー側の「▽通常表示」でFPSへ戻る）。状態は setFullscreen に集約。
    const fsBtn = document.createElement("button");
    fsBtn.className = "dr-tgl" + (this.fullscreen ? " on" : "");
    fsBtn.textContent = this.fullscreen ? "▽ 通常表示" : "△ 全画面";
    fsBtn.onclick = () => this.setFullscreen(!this.fullscreen);
    this.fsBtn = fsBtn;
    bar.appendChild(fsBtn);

    bar.appendChild(this.buildGlobalToggles());

    const content = document.createElement("div");
    content.className = "dr-content";

    root.appendChild(bar);
    root.appendChild(content);
    document.body.appendChild(root);

    this.panelRoot = root;
    this.content = content;
    this.applyFullscreen();
  }

  // 全画面表示の適用（this.fullscreen に従う。タブ切替では変えない）。
  private applyFullscreen(): void {
    this.panelRoot?.classList.toggle("dr-full", this.fullscreen);
    // ASSETS のプレビューは全画面でない時は隠す（ボタンで再表示）。
    (this.panels.assets as AssetsPanel).setHostFullscreen(this.fullscreen);
  }

  // 全画面（=一覧プレビュー）の表示状態を切り替える。ボタン・ESC・ポインタロック解除の
  // すべてがここを通すことで、ボタン表示と実状態がずれない。
  private setFullscreen(v: boolean): void {
    this.fullscreen = v;
    if (this.fsBtn) {
      this.fsBtn.classList.toggle("on", v);
      this.fsBtn.textContent = v ? "▽ 通常表示" : "△ 全画面";
    }
    this.applyFullscreen();
  }

  // 一覧プレビュー（ASSETS）を開く。FPS中にESCでロックが外れた時などに呼ぶ。
  private openPreview(): void {
    if (this.fullscreen) return;
    if (document.exitPointerLock) document.exitPointerLock();
    this.switchTab("assets"); // 開くのは一覧プレビュー
    this.setFullscreen(true);
  }

  // 一覧プレビューを閉じてFPSへ戻る（プレビュー中のESC／▽通常表示ボタン）。
  private closePreview(): void {
    if (!this.fullscreen) return;
    this.setFullscreen(false);
  }

  // グローバルトグル（回復 / 無敵 / 飛行 / 座標表示）をバー右側へ。
  private buildGlobalToggles(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "dr-globals";

    const heal = document.createElement("button");
    heal.className = "dr-tgl";
    heal.textContent = "HP回復";
    heal.onclick = () => {
      this.ctx.health.show();
      this.ctx.health.reset();
    };
    wrap.appendChild(heal);

    wrap.appendChild(
      this.toggle("無敵", (on) => {
        this.ctx.health.setInvincible(on);
        if (on) this.ctx.health.show();
      })
    );
    wrap.appendChild(
      this.toggle("飛行", (on) => {
        this.ctx.player.setFlyMode(on);
      })
    );
    wrap.appendChild(
      this.toggle("座標", (on) => {
        this.hud.setCoordsVisible(on);
      })
    );

    return wrap;
  }

  // ON/OFF を切り替えるトグルボタンを作る。
  private toggle(label: string, onChange: (on: boolean) => void): HTMLButtonElement {
    let on = false;
    const b = document.createElement("button");
    b.className = "dr-tgl";
    b.textContent = label;
    b.onclick = () => {
      on = !on;
      b.classList.toggle("on", on);
      onChange(on);
    };
    return b;
  }

  private switchTab(id: TabId): void {
    if (id === this.activeTab) return;
    this.panels[this.activeTab].onHide?.();
    this.activeTab = id;
    for (const [tid, btn] of this.tabButtons) btn.classList.toggle("active", tid === id);
    this.mountTab(id);
  }

  private mountTab(id: TabId): void {
    this.content.innerHTML = "";
    const panel = this.panels[id];
    this.content.appendChild(panel.element);
    panel.onShow?.();
  }

  private injectStyle(): void {
    if (document.getElementById("dev-range-style")) return; // 再入場時の二重注入を防ぐ
    const style = document.createElement("style");
    style.id = "dev-range-style";
    style.textContent = `
      #dev-range{position:fixed;left:0;right:0;bottom:0;z-index:9999;
        display:flex;flex-direction:column;
        font-family:system-ui,-apple-system,sans-serif;color:#e8eaed;
        background:rgba(8,10,14,0.92);border-top:2px solid #ffb83c;
        box-shadow:0 -6px 24px rgba(0,0,0,0.6);pointer-events:auto;}
      /* 全画面（=一覧プレビュー）でない間は FPS。下部バーを含むパネルを丸ごと隠す。
         （ESC で一覧プレビューを開くまで DEV RANGE のUIは出さない。左上バッジは hud 側で別管理） */
      #dev-range:not(.dr-full){display:none;}
      /* ASSETS タブは画面いっぱいに（DEV RANGE バッジ行のすぐ下から下端まで） */
      #dev-range.dr-full{top:46px;background:rgba(8,10,14,0.98);}
      #dev-range.dr-full .dr-content{height:auto;flex:1 1 auto;min-height:0;}
      #dev-range .dr-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
        padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.08);}
      #dev-range .dr-tab{padding:5px 14px;font-size:13px;font-weight:700;
        color:#c9d2dc;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);
        border-radius:6px;cursor:pointer;}
      #dev-range .dr-tab.active{color:#1a1a1a;background:#ffd27a;border-color:#ffd27a;}
      #dev-range .dr-globals{display:flex;gap:6px;margin-left:auto;}
      #dev-range .dr-tgl{padding:5px 10px;font-size:12px;font-weight:700;color:#c9d2dc;
        background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.16);
        border-radius:6px;cursor:pointer;}
      #dev-range .dr-tgl.on{color:#1a1a1a;background:#7be3a0;border-color:#7be3a0;}
      #dev-range .dr-content{height:200px;overflow-y:auto;padding:10px 12px;}
      #dev-range .dr-cur{font-size:13px;color:#ffce7a;font-weight:700;margin-bottom:8px;}
      #dev-range .dr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 22px;}
      #dev-range .dr-row{display:flex;align-items:center;gap:8px;font-size:12px;}
      #dev-range .dr-row label{flex:0 0 104px;color:#aeb6c0;}
      #dev-range .dr-row input[type=range]{flex:1;min-width:60px;accent-color:#ffb83c;}
      #dev-range .dr-row input[type=number]{flex:0 0 84px;background:rgba(255,255,255,0.06);
        color:#fff;border:1px solid rgba(255,255,255,0.2);border-radius:4px;padding:2px 6px;font-size:12px;}
      #dev-range .dr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center;}
      #dev-range .dr-btn{padding:5px 12px;font-size:12px;font-weight:700;color:#eee;
        background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.22);
        border-radius:6px;cursor:pointer;}
      #dev-range .dr-btn.on{color:#1a1a1a;background:#ffd27a;border-color:#ffd27a;}
      #dev-range .dr-chk{display:flex;align-items:center;gap:6px;font-size:12px;color:#aeb6c0;}
      #dev-range .dr-stages{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;}
      #dev-range .dr-info{font-size:12px;color:#aeb6c0;line-height:1.8;}
      #dev-range .dr-info b{color:#e8eaed;}
      #dev-range .dr-mats{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}
      #dev-range .dr-mat{display:flex;align-items:center;gap:6px;font-size:11px;color:#aeb6c0;
        background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);
        border-radius:5px;padding:3px 7px;}
      #dev-range .dr-sw{width:14px;height:14px;border-radius:3px;border:1px solid rgba(255,255,255,0.4);}
      #dev-range .dr-log{margin-top:8px;font:12px/1.6 ui-monospace,monospace;color:#cdd6e0;
        max-height:96px;overflow-y:auto;}
      #dev-range .dr-log .hs{color:#ff7b6b;font-weight:700;}
    `;
    document.head.appendChild(style);
  }
}
