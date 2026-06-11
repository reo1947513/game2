import { Input } from "./Input";
import { WeaponKind } from "./types";

// スマホ・タブレット向けのタッチ操作レイヤーです。
// 画面上に移動スティック・視点エリア・各アクションのボタンを生成し、
// その入力を Input クラスへ流し込みます。配置・大きさ・透明度を設定でき、
// 3つの保存枠に記録できます。ゲーム中の一時停止メニューから設定を開きます。
//
// ボタンの大きさは「全体の基準サイズ(size)」×「各ボタンの倍率(scales)」で決まり、
// 全体スライダーで一括調整したうえで、配置編集画面でボタンごとに微調整できます。
// 3パターンの保存・読込も配置編集画面の中で行います。
//
// スプリント（ダッシュ）は専用ボタンを廃止し、移動スティックを前方へ深く倒し
// 続けると一定時間（SPRINT_DELAY）で発動する方式にしています。
// 武器切替はトグル式の1ボタンに統合しています。

type ActionType = "hold" | "tap";

interface ActionDef {
  key: string;
  label: string;
  type: ActionType;
}

interface Vec2 {
  x: number;
  y: number;
}

interface Layout {
  size: number; // ボタンの基準サイズ(px)。全体スライダーで変える。
  opacity: number; // 0〜1
  pos: Record<string, Vec2>; // 各要素の位置(画面に対する%)
  scales: Record<string, number>; // 各要素の大きさ倍率(既定1.0)。ボタンごとに変える。
}

interface TouchCallbacks {
  onPause: () => void;
  onResume: () => void;
}

type Mode = "play" | "pause" | "settings" | "edit";

// 押しっぱなし系のアクション（sprintはスティック前傾で制御するためボタンは持たない）
type HoldKey = "fire" | "ads" | "sprint" | "crouch";

// スプリント発動までの保持時間(ミリ秒)と、前方「深倒し」と判定するしきい値(0〜1)
const SPRINT_DELAY = 500;
const SPRINT_DEEP = 0.85;

// 個別サイズ倍率の下限・上限（％はこの値×100）
const SCALE_MIN = 0.6;
const SCALE_MAX = 2.5;

const ACTIONS: ActionDef[] = [
  { key: "fire", label: "射撃", type: "hold" },
  { key: "ads", label: "ADS", type: "hold" },
  { key: "jump", label: "JUMP", type: "tap" },
  { key: "reload", label: "R", type: "tap" },
  { key: "crouch", label: "しゃがむ", type: "hold" },
  { key: "prone", label: "伏せ", type: "tap" },
  // 武器切替トグル（タップでアサルト⇔スナイパー）。ラベルは現在の武器名を表示。
  { key: "weapon", label: "ASSAULT", type: "tap" },
  // 蹴り（タップ）と手榴弾（長押しで軌道表示、離すと投擲）
  { key: "kick", label: "蹴り", type: "tap" },
  { key: "knife", label: "ナイフ", type: "tap" },
  { key: "grenade", label: "手榴弾", type: "hold" },
];

// サイズ編集の見出しに使う、要素ごとの表示名
const DISPLAY_NAMES: Record<string, string> = {
  move: "移動",
  fire: "射撃",
  ads: "ADS",
  jump: "ジャンプ",
  reload: "リロード",
  crouch: "しゃがむ",
  prone: "伏せ",
  weapon: "武器",
  kick: "蹴り",
  knife: "ナイフ",
  grenade: "手榴弾",
};

// 既定の配置（画面に対する%。FPSは横画面前提で右手側に射撃系を寄せています）
const DEFAULT_LAYOUT: Layout = {
  size: 64,
  opacity: 0.55,
  pos: {
    move: { x: 15, y: 74 },
    fire: { x: 86, y: 74 },
    ads: { x: 73, y: 64 },
    jump: { x: 92, y: 52 },
    reload: { x: 64, y: 84 },
    crouch: { x: 80, y: 86 },
    prone: { x: 55, y: 84 },
    weapon: { x: 50, y: 10 },
    kick: { x: 88, y: 36 },
    knife: { x: 60, y: 24 },
    grenade: { x: 73, y: 28 },
  },
  scales: {},
};

const LS_LAST = "arena_touch_last";
function lsSlot(n: number): string {
  return `arena_touch_slot${n}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// 簡単な要素生成ヘルパー
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class TouchControls {
  // この端末がタッチ主体（スマホ・タブレット）かどうか
  static isTouchDevice(): boolean {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      (navigator.maxTouchPoints ?? 0) > 0 ||
      "ontouchstart" in window
    );
  }

  private root: HTMLElement;
  private lookLayer: HTMLElement;
  private controls: HTMLElement;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private pauseBtn: HTMLElement;
  private pauseMenu: HTMLElement;
  private settingsPanel: HTMLElement;
  private editBanner: HTMLElement;
  private sizeSlider: HTMLInputElement;
  private opacitySlider: HTMLInputElement;

  // 配置編集画面で使う、選択中ボタンの大きさスライダーとその見出し
  private editSizeSlider: HTMLInputElement;
  private editSizeLabel: HTMLElement;

  private btnMap: Record<string, HTMLElement> = {};

  private mode: Mode = "play";
  private enabled = false;

  private layout: Layout;

  // 視点ドラッグ用
  private lookId: number | null = null;
  private lookLast: Vec2 = { x: 0, y: 0 };

  // 移動スティック用
  private joyId: number | null = null;
  private joyCenter: Vec2 = { x: 0, y: 0 };

  // 押しっぱなしボタンの担当ポインタ
  private holdId: Record<string, number | null> = {};

  // 配置編集（ドラッグ移動）用
  private dragKey: string | null = null;
  private dragEl: HTMLElement | null = null;
  private dragId: number | null = null;

  // 配置編集パネル（バナー）自体のドラッグ移動用
  private bannerDragId: number | null = null;
  private bannerStartX = 0;
  private bannerStartY = 0;
  private bannerLeft = 0;
  private bannerTop = 0;
  // 一度でも手動で動かしたら true（中央寄せ→絶対px配置へ切り替え）
  private bannerPlaced = false;

  // 配置編集で「大きさ調整の対象」として選んでいるボタン（move含む）
  private selectedKey: string | null = null;

  // 武器切替トグルの現在状態（ゲーム開始時はアサルト）
  private touchWeapon: WeaponKind = WeaponKind.Assault;
  // 武器ボタンで循環させる順番（4丁）
  private readonly weaponOrder: WeaponKind[] = [
    WeaponKind.Assault,
    WeaponKind.Sniper,
    WeaponKind.Shotgun,
    WeaponKind.Smg,
  ];

  // スティック前傾スプリントの状態
  private sprintActive = false;
  private sprintTimer: number | null = null;

  constructor(private input: Input, private callbacks: TouchCallbacks) {
    this.layout = this.loadLast();
    this.injectStyle();

    // ---- ルートと各レイヤーの生成 ----
    this.root = el("div");
    this.root.id = "touch-root";
    this.root.style.display = "none";

    this.lookLayer = el("div", "tc-look");
    this.controls = el("div", "tc-controls");

    // 移動スティック
    this.joyBase = el("div", "tc-joy");
    this.joyKnob = el("div", "tc-joy-knob");
    this.joyBase.appendChild(this.joyKnob);
    this.controls.appendChild(this.joyBase);

    // アクションボタン
    for (const def of ACTIONS) {
      const b = el("div", "tc-btn", def.label);
      b.dataset.action = def.key;
      this.btnMap[def.key] = b;
      this.holdId[def.key] = null;
      this.controls.appendChild(b);
    }

    // 一時停止ボタン（左上）
    this.pauseBtn = el("div", "tc-pause-btn", "❚❚");

    // 一時停止メニュー
    this.pauseMenu = el("div", "tc-overlay");
    const pmCard = el("div", "tc-card");
    pmCard.appendChild(el("div", "tc-card-title", "一時停止"));
    const btnOpenSettings = el("button", "tc-menu-btn", "操作設定");
    const btnResume = el("button", "tc-menu-btn tc-menu-btn-primary", "再開");
    pmCard.appendChild(btnOpenSettings);
    pmCard.appendChild(btnResume);
    this.pauseMenu.appendChild(pmCard);

    // 操作設定パネル
    this.settingsPanel = el("div", "tc-overlay");
    const setCard = el("div", "tc-card tc-card-wide");
    setCard.appendChild(el("div", "tc-card-title", "操作設定"));

    // 大きさスライダー（全体一括の基準サイズ）
    const sizeRow = el("div", "tc-row");
    sizeRow.appendChild(el("span", "tc-row-label", "全体の大きさ"));
    this.sizeSlider = el("input", "tc-slider") as HTMLInputElement;
    this.sizeSlider.type = "range";
    this.sizeSlider.min = "44";
    this.sizeSlider.max = "120";
    this.sizeSlider.step = "1";
    sizeRow.appendChild(this.sizeSlider);
    setCard.appendChild(sizeRow);

    // 透明度スライダー
    const opacityRow = el("div", "tc-row");
    opacityRow.appendChild(el("span", "tc-row-label", "ボタンの透明度"));
    this.opacitySlider = el("input", "tc-slider") as HTMLInputElement;
    this.opacitySlider.type = "range";
    this.opacitySlider.min = "20";
    this.opacitySlider.max = "100";
    this.opacitySlider.step = "1";
    opacityRow.appendChild(this.opacitySlider);
    setCard.appendChild(opacityRow);

    // 配置・大きさ編集ボタン
    const btnEdit = el("button", "tc-menu-btn", "ボタンの配置と大きさを編集");
    setCard.appendChild(btnEdit);

    // 操作のヒント（スプリントの操作方法）
    setCard.appendChild(
      el(
        "div",
        "tc-section-label",
        "移動スティックを前へ深く倒し続けるとダッシュします"
      )
    );

    const btnBack = el("button", "tc-menu-btn tc-menu-btn-primary", "戻る");
    setCard.appendChild(btnBack);
    this.settingsPanel.appendChild(setCard);

    // ---- 配置編集パネル（画面上部に表示。プレイUIは下に見えたまま編集する） ----
    this.editBanner = el("div", "tc-edit-banner");

    // パネル自体をドラッグ移動するためのつまみ（ここを掴んだときだけ移動する）
    const editGrip = el("div", "tc-edit-grip", "⠿ ドラッグでこのパネルを移動");
    editGrip.addEventListener("pointerdown", (e) => this.startBannerDrag(e));
    editGrip.addEventListener("pointermove", (e) => this.onBannerDrag(e));
    editGrip.addEventListener("pointerup", (e) => this.endBannerDrag(e));
    editGrip.addEventListener("pointercancel", (e) => this.endBannerDrag(e));
    this.editBanner.appendChild(editGrip);

    // 1段目：説明＋完了ボタン
    const editTop = el("div", "tc-edit-top");
    editTop.appendChild(
      el("span", "tc-edit-text", "タップで選択 → 大きさ調整／ドラッグで移動")
    );
    const btnEditDone = el("button", "tc-edit-done", "完了");
    editTop.appendChild(btnEditDone);
    this.editBanner.appendChild(editTop);

    // 2段目：選択中ボタンの大きさスライダー
    const sizeEditRow = el("div", "tc-row");
    this.editSizeLabel = el("span", "tc-row-label", "大きさ（ボタンを選択）");
    sizeEditRow.appendChild(this.editSizeLabel);
    this.editSizeSlider = el("input", "tc-slider") as HTMLInputElement;
    this.editSizeSlider.type = "range";
    this.editSizeSlider.min = String(Math.round(SCALE_MIN * 100));
    this.editSizeSlider.max = String(Math.round(SCALE_MAX * 100));
    this.editSizeSlider.step = "5";
    this.editSizeSlider.disabled = true;
    sizeEditRow.appendChild(this.editSizeSlider);
    this.editBanner.appendChild(sizeEditRow);

    // 3段目：3パターンの保存・読込
    this.editBanner.appendChild(
      el("div", "tc-section-label", "配置パターンの保存（3つまで）")
    );
    for (let n = 1; n <= 3; n++) {
      const row = el("div", "tc-slot-row");
      row.appendChild(el("span", "tc-slot-label", `パターン${n}`));
      const save = el("button", "tc-slot-btn", "保存");
      const load = el("button", "tc-slot-btn", "読込");
      save.addEventListener("click", () => this.saveSlot(n, save));
      load.addEventListener("click", () => this.loadSlot(n, load));
      row.appendChild(save);
      row.appendChild(load);
      this.editBanner.appendChild(row);
    }

    // ---- 組み立て ----
    this.root.appendChild(this.lookLayer);
    this.root.appendChild(this.controls);
    this.root.appendChild(this.pauseBtn);
    this.root.appendChild(this.pauseMenu);
    this.root.appendChild(this.settingsPanel);
    this.root.appendChild(this.editBanner);
    document.body.appendChild(this.root);

    // ---- イベント結線 ----
    this.bindLook();
    this.bindJoystick();
    this.bindButtons();

    this.pauseBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.openPause();
    });
    btnResume.addEventListener("click", () => this.resume());
    btnOpenSettings.addEventListener("click", () => this.setMode("settings"));
    btnBack.addEventListener("click", () => this.setMode("pause"));
    btnEdit.addEventListener("click", () => this.setMode("edit"));
    btnEditDone.addEventListener("click", () => {
      this.saveLast();
      this.setMode("settings");
    });

    this.sizeSlider.addEventListener("input", () => {
      this.layout.size = Number(this.sizeSlider.value);
      this.applyLayout();
    });
    this.opacitySlider.addEventListener("input", () => {
      this.layout.opacity = Number(this.opacitySlider.value) / 100;
      this.applyLayout();
    });
    // 選択中ボタンの大きさ（倍率）を変える
    this.editSizeSlider.addEventListener("input", () => {
      if (!this.selectedKey) return;
      this.layout.scales[this.selectedKey] =
        Number(this.editSizeSlider.value) / 100;
      this.applyLayout();
    });
  }

  // タッチ操作を有効化（スマホ・タブレットでゲーム開始時に呼ぶ）
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.input.setTouchActive(true);
    this.root.style.display = "block";
    this.applyLayout();
    this.setMode("play");
  }

  // 各要素の実サイズ(px)＝全体サイズ×個別倍率
  private realSize(key: string): number {
    const scale = this.layout.scales[key] ?? 1;
    return this.layout.size * scale;
  }

  // ---- 視点ドラッグ ----
  private bindLook(): void {
    this.lookLayer.addEventListener("pointerdown", (e) => {
      if (this.mode !== "play") return;
      e.preventDefault();
      // 取りこぼしで lookId が残っていても、新しい指で上書きしてエイムを復活させる
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookLayer.setPointerCapture(e.pointerId);
    });
    this.lookLayer.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookId) return;
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.input.applyTouchLook(dx, dy);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.lookId) return;
      this.lookId = null;
    };
    this.lookLayer.addEventListener("pointerup", end);
    this.lookLayer.addEventListener("pointercancel", end);
    // 取りこぼし対策：画面のどこで指が離れても、宙に浮いたタッチを強制解放する
    window.addEventListener("pointerup", (e) => this.releaseStalePointer(e.pointerId));
    window.addEventListener("pointercancel", (e) => this.releaseStalePointer(e.pointerId));
  }

  // setPointerCapture の取りこぼしで宙に浮いたタッチ（視点・スティック・ホールド）を解放する。
  // 指を離したイベントが該当レイヤーに届かなくても、ここで確実に元へ戻す。
  private releaseStalePointer(pointerId: number): void {
    if (this.lookId === pointerId) this.lookId = null;
    if (this.joyId === pointerId) {
      this.joyId = null;
      this.joyKnob.style.transform = "translate(-50%, -50%)";
      this.input.setTouchMove(0, 0);
      this.clearSprint();
    }
    for (const def of ACTIONS) {
      if (def.type === "hold" && this.holdId[def.key] === pointerId) {
        this.holdId[def.key] = null;
        if (def.key === "grenade") this.input.setGrenadeHeld(false);
        else this.input.setTouchHold(def.key as HoldKey, false);
        this.btnMap[def.key].classList.remove("active");
      }
    }
  }

  // ---- 移動スティック ----
  private bindJoystick(): void {
    this.joyBase.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.mode === "edit") {
        this.startDrag("move", this.joyBase, e);
        return;
      }
      if (this.mode !== "play") return;
      if (this.joyId !== null) return;
      this.joyId = e.pointerId;
      const rect = this.joyBase.getBoundingClientRect();
      this.joyCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      this.joyBase.setPointerCapture(e.pointerId);
      this.updateJoystick(e.clientX, e.clientY);
    });
    this.joyBase.addEventListener("pointermove", (e) => {
      if (this.mode === "edit") {
        this.onDrag(e);
        return;
      }
      if (e.pointerId !== this.joyId) return;
      this.updateJoystick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent): void => {
      if (this.mode === "edit") {
        this.endDrag(e);
        return;
      }
      if (e.pointerId !== this.joyId) return;
      this.joyId = null;
      this.joyKnob.style.transform = "translate(-50%, -50%)";
      this.input.setTouchMove(0, 0);
      // スティックを離したらスプリントも解除
      this.clearSprint();
    };
    this.joyBase.addEventListener("pointerup", end);
    this.joyBase.addEventListener("pointercancel", end);
  }

  private updateJoystick(cx: number, cy: number): void {
    const maxR = this.realSize("move") * 1.1;
    let dx = cx - this.joyCenter.x;
    let dy = cy - this.joyCenter.y;
    const dist = Math.hypot(dx, dy);
    if (dist > maxR) {
      dx = (dx / dist) * maxR;
      dy = (dy / dist) * maxR;
    }
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const forward = clamp(-dy / maxR, -1, 1);
    const right = clamp(dx / maxR, -1, 1);
    this.input.setTouchMove(forward, right);
    // 前方への深倒し具合からスプリントを判定する
    this.updateSprint(forward);
  }

  // ---- スティック前傾スプリント ----
  // 前方へ深く倒し続けると SPRINT_DELAY 経過で発動。浅くする/離すと解除する。
  private updateSprint(forward: number): void {
    const deep = forward >= SPRINT_DEEP;
    if (deep) {
      // すでに発動中、またはタイマー作動中なら二重に仕掛けない
      if (this.sprintActive || this.sprintTimer !== null) return;
      this.sprintTimer = window.setTimeout(() => {
        this.sprintTimer = null;
        this.sprintActive = true;
        this.input.setTouchHold("sprint", true);
      }, SPRINT_DELAY);
    } else {
      this.clearSprint();
    }
  }

  private clearSprint(): void {
    if (this.sprintTimer !== null) {
      window.clearTimeout(this.sprintTimer);
      this.sprintTimer = null;
    }
    if (this.sprintActive) {
      this.sprintActive = false;
      this.input.setTouchHold("sprint", false);
    }
  }

  // ---- アクションボタン ----
  private bindButtons(): void {
    for (const def of ACTIONS) {
      const b = this.btnMap[def.key];
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.mode === "edit") {
          this.startDrag(def.key, b, e);
          return;
        }
        if (this.mode !== "play") return;
        if (def.type === "tap") {
          this.trigger(def.key);
          b.classList.add("active");
          window.setTimeout(() => b.classList.remove("active"), 120);
        } else {
          b.setPointerCapture(e.pointerId);
          this.holdId[def.key] = e.pointerId;
          if (def.key === "grenade") this.input.setGrenadeHeld(true);
          else this.input.setTouchHold(def.key as HoldKey, true);
          b.classList.add("active");
        }
      });
      const end = (e: PointerEvent): void => {
        if (this.mode === "edit") {
          this.endDrag(e);
          return;
        }
        if (def.type === "hold" && this.holdId[def.key] === e.pointerId) {
          this.holdId[def.key] = null;
          if (def.key === "grenade") this.input.setGrenadeHeld(false);
          else this.input.setTouchHold(def.key as HoldKey, false);
          b.classList.remove("active");
        }
      };
      b.addEventListener("pointerup", end);
      b.addEventListener("pointercancel", end);
      b.addEventListener("pointermove", (e) => {
        if (this.mode === "edit") this.onDrag(e);
      });
    }
  }

  private trigger(key: string): void {
    switch (key) {
      case "jump":
        this.input.queueJump();
        break;
      case "reload":
        this.input.queueReload();
        break;
      case "prone":
        this.input.queueProne();
        break;
      case "weapon":
        this.toggleWeapon();
        break;
      case "kick":
        this.input.queueKick();
        break;
      case "knife":
        this.input.queueKnife();
        break;
    }
  }

  // 武器切替（1ボタンのトグル）。タップでアサルト⇔スナイパーを交互に切り替える。
  private toggleWeapon(): void {
    // 次の武器へ循環で切り替える（アサルト→スナイパー→ショットガン→SMG→…）
    const i = this.weaponOrder.indexOf(this.touchWeapon);
    this.touchWeapon = this.weaponOrder[(i + 1) % this.weaponOrder.length];
    this.input.queueSwitch(this.touchWeapon);
    const btn = this.btnMap["weapon"];
    if (btn) {
      btn.textContent = this.touchWeapon;
    }
  }

  // ---- 配置編集（ドラッグ移動＋タップ選択） ----
  private startDrag(key: string, target: HTMLElement, e: PointerEvent): void {
    this.dragKey = key;
    this.dragEl = target;
    this.dragId = e.pointerId;
    target.setPointerCapture(e.pointerId);
    // タップ（またはドラッグ開始）でそのボタンを大きさ調整の対象に選ぶ
    this.selectKey(key);
  }

  private onDrag(e: PointerEvent): void {
    if (this.dragId !== e.pointerId || !this.dragEl || !this.dragKey) return;
    const x = clamp((e.clientX / window.innerWidth) * 100, 3, 97);
    const y = clamp((e.clientY / window.innerHeight) * 100, 5, 95);
    this.layout.pos[this.dragKey] = { x, y };
    this.dragEl.style.left = `${x}%`;
    this.dragEl.style.top = `${y}%`;
  }

  private endDrag(e: PointerEvent): void {
    if (this.dragId !== e.pointerId) return;
    this.dragKey = null;
    this.dragEl = null;
    this.dragId = null;
  }

  // ===== 配置編集パネル（バナー）自体のドラッグ移動 =====
  private startBannerDrag(e: PointerEvent): void {
    // 初回ドラッグ時、中央寄せ(left:50%+translateX)から現在位置の絶対pxへ切り替える
    if (!this.bannerPlaced) {
      const rect = this.editBanner.getBoundingClientRect();
      this.bannerLeft = rect.left;
      this.bannerTop = rect.top;
      this.bannerPlaced = true;
      this.applyBannerPos();
    }
    this.bannerDragId = e.pointerId;
    this.bannerStartX = e.clientX;
    this.bannerStartY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  private onBannerDrag(e: PointerEvent): void {
    if (this.bannerDragId !== e.pointerId) return;
    const dx = e.clientX - this.bannerStartX;
    const dy = e.clientY - this.bannerStartY;
    this.bannerStartX = e.clientX;
    this.bannerStartY = e.clientY;
    const rect = this.editBanner.getBoundingClientRect();
    // 画面外へ出てしまわないようクランプする
    this.bannerLeft = clamp(
      this.bannerLeft + dx,
      0,
      Math.max(0, window.innerWidth - rect.width)
    );
    this.bannerTop = clamp(
      this.bannerTop + dy,
      0,
      Math.max(0, window.innerHeight - rect.height)
    );
    this.applyBannerPos();
    e.preventDefault();
  }

  private endBannerDrag(e: PointerEvent): void {
    if (this.bannerDragId !== e.pointerId) return;
    this.bannerDragId = null;
  }

  // 現在のパネル位置を絶対px配置として反映する
  private applyBannerPos(): void {
    if (!this.bannerPlaced) return;
    this.editBanner.style.left = `${this.bannerLeft}px`;
    this.editBanner.style.top = `${this.bannerTop}px`;
    this.editBanner.style.transform = "none";
  }

  // 編集対象ボタンを選ぶ（強調表示し、大きさスライダーを同期）
  private selectKey(key: string): void {
    this.selectedKey = key;
    this.joyBase.classList.toggle("selected", key === "move");
    for (const def of ACTIONS) {
      this.btnMap[def.key].classList.toggle("selected", def.key === key);
    }
    this.refreshSizeEditor();
  }

  // 選択を解除（強調を消し、大きさスライダーを無効化）
  private clearSelection(): void {
    this.selectedKey = null;
    this.joyBase.classList.remove("selected");
    for (const def of ACTIONS) {
      this.btnMap[def.key].classList.remove("selected");
    }
    this.refreshSizeEditor();
  }

  // 選択中ボタンに合わせて、編集画面の大きさスライダーの値・見出し・有効状態を更新
  private refreshSizeEditor(): void {
    const key = this.selectedKey;
    if (!key) {
      this.editSizeLabel.textContent = "大きさ（ボタンを選択）";
      this.editSizeSlider.disabled = true;
      this.editSizeSlider.value = "100";
      return;
    }
    this.editSizeSlider.disabled = false;
    const scale = this.layout.scales[key] ?? 1;
    this.editSizeSlider.value = String(Math.round(scale * 100));
    this.editSizeLabel.textContent = `「${DISPLAY_NAMES[key] ?? key}」の大きさ`;
  }

  // ---- モード切替（表示の出し分け） ----
  private setMode(mode: Mode): void {
    this.mode = mode;
    // プレイ画面を離れるときは移動・スプリントを確実に止める
    if (mode !== "play") {
      this.joyId = null;
      this.joyKnob.style.transform = "translate(-50%, -50%)";
      this.input.setTouchMove(0, 0);
      this.clearSprint();
    }
    // 編集画面を離れるときは選択を解除する
    if (mode !== "edit") {
      this.clearSelection();
    } else {
      // 編集画面に入った時点ではどのボタンも未選択
      this.refreshSizeEditor();
    }
    const playing = mode === "play";
    const editing = mode === "edit";
    this.lookLayer.style.display = playing ? "block" : "none";
    this.controls.style.display = playing || editing ? "block" : "none";
    this.pauseBtn.style.display = playing ? "flex" : "none";
    this.pauseMenu.style.display = mode === "pause" ? "flex" : "none";
    this.settingsPanel.style.display = mode === "settings" ? "flex" : "none";
    this.editBanner.style.display = editing ? "flex" : "none";
    this.controls.classList.toggle("editing", editing);
  }

  private openPause(): void {
    this.callbacks.onPause();
    this.setMode("pause");
  }

  private resume(): void {
    this.callbacks.onResume();
    this.setMode("play");
  }

  // ---- レイアウト適用 ----
  private applyLayout(): void {
    this.root.style.setProperty("--tc-opacity", String(this.layout.opacity));

    // 移動スティック（位置と大きさ）。子のノブは親の --tc-size を継承する。
    this.joyBase.style.setProperty("--tc-size", `${this.realSize("move")}px`);
    this.placeEl(this.joyBase, this.layout.pos.move ?? DEFAULT_LAYOUT.pos.move);

    // 各アクションボタン（位置と大きさを要素ごとに設定）
    for (const def of ACTIONS) {
      const p = this.layout.pos[def.key] ?? DEFAULT_LAYOUT.pos[def.key];
      const btn = this.btnMap[def.key];
      btn.style.setProperty("--tc-size", `${this.realSize(def.key)}px`);
      this.placeEl(btn, p);
    }

    // 設定画面のスライダー値を現在のレイアウトに同期
    this.sizeSlider.value = String(this.layout.size);
    this.opacitySlider.value = String(Math.round(this.layout.opacity * 100));
  }

  private placeEl(elm: HTMLElement, p: Vec2): void {
    elm.style.left = `${p.x}%`;
    elm.style.top = `${p.y}%`;
  }

  // ---- 保存・読込 ----
  private sanitize(parsed: Partial<Layout> | null): Layout {
    const base: Layout = {
      size: DEFAULT_LAYOUT.size,
      opacity: DEFAULT_LAYOUT.opacity,
      pos: { ...DEFAULT_LAYOUT.pos },
      scales: { ...DEFAULT_LAYOUT.scales },
    };
    if (!parsed) return base;
    if (typeof parsed.size === "number") base.size = clamp(parsed.size, 44, 120);
    if (typeof parsed.opacity === "number") base.opacity = clamp(parsed.opacity, 0.2, 1);
    if (parsed.pos && typeof parsed.pos === "object") {
      base.pos = { ...DEFAULT_LAYOUT.pos, ...parsed.pos };
    }
    // 各ボタンの大きさ倍率（旧データには無いので、その場合は全て既定1.0扱い）
    if (parsed.scales && typeof parsed.scales === "object") {
      const s: Record<string, number> = {};
      for (const k of Object.keys(parsed.scales)) {
        const v = (parsed.scales as Record<string, number>)[k];
        if (typeof v === "number") s[k] = clamp(v, SCALE_MIN, SCALE_MAX);
      }
      base.scales = { ...DEFAULT_LAYOUT.scales, ...s };
    }
    return base;
  }

  private loadLast(): Layout {
    try {
      const raw = localStorage.getItem(LS_LAST);
      return this.sanitize(raw ? (JSON.parse(raw) as Partial<Layout>) : null);
    } catch {
      return this.sanitize(null);
    }
  }

  private saveLast(): void {
    try {
      localStorage.setItem(LS_LAST, JSON.stringify(this.layout));
    } catch {
      // 保存できない環境では何もしない
    }
  }

  private saveSlot(n: number, btn: HTMLElement): void {
    try {
      localStorage.setItem(lsSlot(n), JSON.stringify(this.layout));
      this.saveLast();
      this.flashButton(btn, "保存済み", "保存");
    } catch {
      this.flashButton(btn, "失敗", "保存");
    }
  }

  private loadSlot(n: number, btn: HTMLElement): void {
    try {
      const raw = localStorage.getItem(lsSlot(n));
      if (!raw) {
        this.flashButton(btn, "空です", "読込");
        return;
      }
      this.layout = this.sanitize(JSON.parse(raw) as Partial<Layout>);
      this.applyLayout();
      // 読み込んだ内容を選択中ボタンの大きさスライダーにも反映
      this.refreshSizeEditor();
      this.saveLast();
      this.flashButton(btn, "読込済み", "読込");
    } catch {
      this.flashButton(btn, "失敗", "読込");
    }
  }

  private flashButton(btn: HTMLElement, temp: string, base: string): void {
    btn.textContent = temp;
    window.setTimeout(() => {
      btn.textContent = base;
    }, 900);
  }

  // ---- スタイル注入 ----
  private injectStyle(): void {
    if (document.getElementById("touch-style")) return;
    const style = el("style");
    style.id = "touch-style";
    style.textContent = `
      #touch-root {
        position: fixed;
        inset: 0;
        z-index: 50;
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        font-family: system-ui, sans-serif;
        --tc-size: 64px;
        --tc-opacity: 0.55;
      }
      #touch-root .tc-look {
        position: absolute;
        inset: 0;
        z-index: 1;
        touch-action: none;
      }
      #touch-root .tc-controls {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
      }
      #touch-root .tc-controls > * {
        pointer-events: auto;
      }
      #touch-root .tc-joy {
        position: absolute;
        width: calc(var(--tc-size) * 2.2);
        height: calc(var(--tc-size) * 2.2);
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 2px solid rgba(255, 200, 80, calc(var(--tc-opacity) * 0.9));
        background: rgba(20, 20, 26, calc(var(--tc-opacity) * 0.45));
        touch-action: none;
      }
      #touch-root .tc-joy-knob {
        position: absolute;
        left: 50%;
        top: 50%;
        width: calc(var(--tc-size) * 0.9);
        height: calc(var(--tc-size) * 0.9);
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: rgba(255, 200, 80, calc(var(--tc-opacity) * 0.85));
        box-shadow: 0 0 10px rgba(255, 170, 60, 0.5);
      }
      #touch-root .tc-btn {
        position: absolute;
        width: var(--tc-size);
        height: var(--tc-size);
        transform: translate(-50%, -50%);
        border-radius: 50%;
        border: 2px solid rgba(255, 200, 80, var(--tc-opacity));
        background: rgba(20, 20, 26, calc(var(--tc-opacity) * 0.55));
        color: rgba(255, 220, 150, calc(0.4 + var(--tc-opacity) * 0.6));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: calc(var(--tc-size) * 0.24);
        font-weight: 700;
        text-align: center;
        line-height: 1.1;
        touch-action: none;
      }
      #touch-root .tc-btn.active {
        background: rgba(255, 170, 60, 0.7);
        color: #1a1206;
      }
      /* 射撃ボタンだけ、文字ラベルの代わりに弾丸アイコンを表示する。
         色は currentColor で文字色に追従させ、押下時(active)の色変化も自動で反映する。 */
      #touch-root .tc-btn[data-action="fire"] {
        font-size: 0;
      }
      #touch-root .tc-btn[data-action="fire"]::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 62%;
        height: 62%;
        transform: translate(-50%, -50%);
        background: currentColor;
        -webkit-mask: url(/icon_bullet.png) center / contain no-repeat;
        mask: url(/icon_bullet.png) center / contain no-repeat;
      }
      /* 武器切替ボタンは拳銃＋回転矢印アイコンを表示する。武器名テキストは隠す。
         色は currentColor で文字色・押下時の色変化に追従する。 */
      #touch-root .tc-btn[data-action="weapon"] {
        font-size: 0;
      }
      #touch-root .tc-btn[data-action="weapon"]::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 70%;
        height: 70%;
        transform: translate(-50%, -50%);
        background: currentColor;
        -webkit-mask: url(/icon_weapon_swap.png) center / contain no-repeat;
        mask: url(/icon_weapon_swap.png) center / contain no-repeat;
      }
      /* リロードボタンは弾丸3発＋回転矢印アイコンを表示する。文字「R」は隠す。
         色は currentColor で文字色・押下時の色変化に追従する。 */
      #touch-root .tc-btn[data-action="reload"] {
        font-size: 0;
      }
      #touch-root .tc-btn[data-action="reload"]::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 72%;
        height: 72%;
        transform: translate(-50%, -50%);
        background: currentColor;
        -webkit-mask: url(/icon_reload.png) center / contain no-repeat;
        mask: url(/icon_reload.png) center / contain no-repeat;
      }
      /* ADSボタンは照準（スコープ）アイコンを表示する。文字「ADS」は隠す。
         色は currentColor で文字色・押下時の色変化に追従する。 */
      #touch-root .tc-btn[data-action="ads"] {
        font-size: 0;
      }
      #touch-root .tc-btn[data-action="ads"]::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 80%;
        height: 80%;
        transform: translate(-50%, -50%);
        background: currentColor;
        -webkit-mask: url(/icon_ads.png) center / contain no-repeat;
        mask: url(/icon_ads.png) center / contain no-repeat;
      }
      /* ジャンプボタンは跳んでいる人物シルエットを表示する。文字「JUMP」は隠す。
         色は currentColor で文字色・押下時の色変化に追従する。 */
      #touch-root .tc-btn[data-action="jump"] {
        font-size: 0;
      }
      #touch-root .tc-btn[data-action="jump"]::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 74%;
        height: 74%;
        transform: translate(-50%, -50%);
        background: currentColor;
        -webkit-mask: url(/icon_jump.png) center / contain no-repeat;
        mask: url(/icon_jump.png) center / contain no-repeat;
      }
      #touch-root .tc-controls.editing .tc-btn,
      #touch-root .tc-controls.editing .tc-joy {
        border-style: dashed;
        cursor: move;
      }
      /* 編集中に「大きさ調整の対象」として選ばれているボタンの強調 */
      #touch-root .tc-controls.editing .tc-btn.selected,
      #touch-root .tc-controls.editing .tc-joy.selected {
        border-style: solid;
        border-color: #ffd27a;
        box-shadow: 0 0 0 3px rgba(255, 210, 122, 0.55);
      }
      #touch-root .tc-pause-btn {
        position: absolute;
        left: 14px;
        top: 14px;
        z-index: 3;
        width: 46px;
        height: 46px;
        border-radius: 10px;
        border: 1px solid rgba(255, 200, 80, 0.8);
        background: rgba(15, 15, 20, 0.6);
        color: rgba(255, 220, 150, 0.95);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        letter-spacing: 2px;
      }
      #touch-root .tc-overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.72);
      }
      #touch-root .tc-card {
        width: min(86vw, 360px);
        background: #14141a;
        border: 1px solid rgba(255, 200, 80, 0.4);
        border-radius: 14px;
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      #touch-root .tc-card-wide {
        width: min(92vw, 460px);
        max-height: 88vh;
        overflow-y: auto;
      }
      #touch-root .tc-card-title {
        color: #ffd27a;
        font-size: 20px;
        font-weight: 800;
        text-align: center;
        margin-bottom: 4px;
      }
      #touch-root .tc-section-label {
        color: rgba(255, 220, 150, 0.8);
        font-size: 13px;
        margin-top: 6px;
      }
      #touch-root .tc-menu-btn {
        appearance: none;
        border: 1px solid rgba(255, 200, 80, 0.6);
        background: rgba(40, 36, 28, 0.8);
        color: #ffe6b0;
        font-size: 16px;
        font-weight: 700;
        padding: 12px;
        border-radius: 10px;
      }
      #touch-root .tc-menu-btn-primary {
        background: rgba(255, 170, 60, 0.85);
        color: #1a1206;
        border-color: rgba(255, 170, 60, 0.9);
      }
      #touch-root .tc-row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #touch-root .tc-row-label {
        color: #ffe6b0;
        font-size: 14px;
        width: 130px;
        flex: none;
      }
      #touch-root .tc-slider {
        flex: 1;
      }
      #touch-root .tc-slot-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #touch-root .tc-slot-label {
        color: #ffe6b0;
        font-size: 14px;
        width: 96px;
        flex: none;
      }
      #touch-root .tc-slot-btn {
        appearance: none;
        flex: 1;
        border: 1px solid rgba(255, 200, 80, 0.5);
        background: rgba(40, 36, 28, 0.8);
        color: #ffe6b0;
        font-size: 14px;
        padding: 8px;
        border-radius: 8px;
      }
      /* 配置編集パネル（画面上部に縦並び。プレイUIは下に見えたまま） */
      #touch-root .tc-edit-banner {
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        z-index: 11;
        display: none;
        flex-direction: column;
        gap: 10px;
        width: min(94vw, 460px);
        max-height: 80vh;
        overflow-y: auto;
        background: rgba(15, 15, 20, 0.9);
        border: 1px solid rgba(255, 200, 80, 0.6);
        border-radius: 12px;
        padding: 12px 14px;
      }
      #touch-root .tc-edit-grip {
        align-self: stretch;
        text-align: center;
        color: #ffd27a;
        font-size: 12px;
        letter-spacing: 2px;
        padding: 4px 0 2px;
        margin: -2px 0 2px;
        border-bottom: 1px solid rgba(255, 200, 80, 0.25);
        cursor: grab;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      #touch-root .tc-edit-grip:active {
        cursor: grabbing;
      }
      #touch-root .tc-edit-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      #touch-root .tc-edit-text {
        color: #ffe6b0;
        font-size: 13px;
        line-height: 1.4;
      }
      #touch-root .tc-edit-done {
        appearance: none;
        border: none;
        background: rgba(255, 170, 60, 0.9);
        color: #1a1206;
        font-weight: 700;
        font-size: 14px;
        padding: 8px 16px;
        border-radius: 8px;
        flex: none;
      }
    `;
    document.head.appendChild(style);
  }
}
