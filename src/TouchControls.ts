import { Input } from "./Input";
import { WeaponKind } from "./types";

// スマホ・タブレット向けのタッチ操作レイヤーです。
// 画面上に移動スティック・視点エリア・各アクションのボタンを生成し、
// その入力を Input クラスへ流し込みます。配置・大きさ・透明度を設定でき、
// 3つの保存枠に記録できます。ゲーム中の一時停止メニューから設定を開きます。
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
  size: number; // ボタンの基準サイズ(px)
  opacity: number; // 0〜1
  pos: Record<string, Vec2>; // 各要素の位置(画面に対する%)
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

const ACTIONS: ActionDef[] = [
  { key: "fire", label: "射撃", type: "hold" },
  { key: "ads", label: "ADS", type: "hold" },
  { key: "jump", label: "JUMP", type: "tap" },
  { key: "reload", label: "R", type: "tap" },
  { key: "crouch", label: "しゃがむ", type: "hold" },
  { key: "prone", label: "伏せ", type: "tap" },
  // 武器切替トグル（タップでアサルト⇔スナイパー）。ラベルは現在の武器名を表示。
  { key: "weapon", label: "ASSAULT", type: "tap" },
];

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
  },
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

  // 武器切替トグルの現在状態（ゲーム開始時はアサルト）
  private touchWeapon: WeaponKind = WeaponKind.Assault;

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

    // 大きさスライダー
    const sizeRow = el("div", "tc-row");
    sizeRow.appendChild(el("span", "tc-row-label", "ボタンの大きさ"));
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

    // 配置編集ボタン
    const btnEdit = el("button", "tc-menu-btn", "ボタンの配置を編集");
    setCard.appendChild(btnEdit);

    // 操作のヒント（スプリントの操作方法）
    setCard.appendChild(
      el(
        "div",
        "tc-section-label",
        "移動スティックを前へ深く倒し続けるとダッシュします"
      )
    );

    // 保存枠（3つ）
    setCard.appendChild(el("div", "tc-section-label", "配置パターンの保存（3つまで）"));
    for (let n = 1; n <= 3; n++) {
      const row = el("div", "tc-slot-row");
      row.appendChild(el("span", "tc-slot-label", `パターン${n}`));
      const save = el("button", "tc-slot-btn", "保存");
      const load = el("button", "tc-slot-btn", "読込");
      save.addEventListener("click", () => this.saveSlot(n, save));
      load.addEventListener("click", () => this.loadSlot(n, load));
      row.appendChild(save);
      row.appendChild(load);
      setCard.appendChild(row);
    }

    const btnBack = el("button", "tc-menu-btn tc-menu-btn-primary", "戻る");
    setCard.appendChild(btnBack);
    this.settingsPanel.appendChild(setCard);

    // 配置編集中の上部バー
    this.editBanner = el("div", "tc-edit-banner");
    this.editBanner.appendChild(el("span", "tc-edit-text", "ドラッグでボタンを配置"));
    const btnEditDone = el("button", "tc-edit-done", "完了");
    this.editBanner.appendChild(btnEditDone);

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

  // ---- 視点ドラッグ ----
  private bindLook(): void {
    this.lookLayer.addEventListener("pointerdown", (e) => {
      if (this.mode !== "play") return;
      e.preventDefault();
      if (this.lookId !== null) return;
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
    const maxR = this.layout.size * 1.1;
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
          this.input.setTouchHold(def.key as HoldKey, true);
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
          this.input.setTouchHold(def.key as HoldKey, false);
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
    }
  }

  // 武器切替（1ボタンのトグル）。タップでアサルト⇔スナイパーを交互に切り替える。
  private toggleWeapon(): void {
    this.touchWeapon =
      this.touchWeapon === WeaponKind.Assault ? WeaponKind.Sniper : WeaponKind.Assault;
    this.input.queueSwitch(this.touchWeapon);
    const btn = this.btnMap["weapon"];
    if (btn) {
      btn.textContent = this.touchWeapon === WeaponKind.Assault ? "ASSAULT" : "SNIPER";
    }
  }

  // ---- 配置編集（ドラッグ移動） ----
  private startDrag(key: string, target: HTMLElement, e: PointerEvent): void {
    this.dragKey = key;
    this.dragEl = target;
    this.dragId = e.pointerId;
    target.setPointerCapture(e.pointerId);
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
    this.root.style.setProperty("--tc-size", `${this.layout.size}px`);
    this.root.style.setProperty("--tc-opacity", String(this.layout.opacity));
    this.placeEl(this.joyBase, this.layout.pos.move ?? DEFAULT_LAYOUT.pos.move);
    for (const def of ACTIONS) {
      const p = this.layout.pos[def.key] ?? DEFAULT_LAYOUT.pos[def.key];
      this.placeEl(this.btnMap[def.key], p);
    }
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
    };
    if (!parsed) return base;
    if (typeof parsed.size === "number") base.size = clamp(parsed.size, 44, 120);
    if (typeof parsed.opacity === "number") base.opacity = clamp(parsed.opacity, 0.2, 1);
    if (parsed.pos && typeof parsed.pos === "object") {
      base.pos = { ...DEFAULT_LAYOUT.pos, ...parsed.pos };
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
      #touch-root .tc-controls.editing .tc-btn,
      #touch-root .tc-controls.editing .tc-joy {
        border-style: dashed;
        cursor: move;
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
        width: 96px;
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
      #touch-root .tc-edit-banner {
        position: absolute;
        left: 50%;
        top: 14px;
        transform: translateX(-50%);
        z-index: 11;
        display: none;
        align-items: center;
        gap: 12px;
        background: rgba(15, 15, 20, 0.85);
        border: 1px solid rgba(255, 200, 80, 0.6);
        border-radius: 10px;
        padding: 8px 12px;
      }
      #touch-root .tc-edit-text {
        color: #ffe6b0;
        font-size: 14px;
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
      }
    `;
    document.head.appendChild(style);
  }
}
