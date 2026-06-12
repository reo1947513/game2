import { InputState, WeaponKind } from "./types";

// 再割り当て可能なキーアクション（PCのキーボード操作）。
export type KeyAction =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "jump"
  | "crouch"
  | "prone"
  | "sprint"
  | "reload"
  | "weapon1"
  | "weapon2"
  | "weapon3"
  | "weapon4"
  | "kick"
  | "knife"
  | "frag"
  | "flash"
  | "interact"
  | "scoreboard";

// 設定画面に出すラベル（この並び順で表示する）。
export const ACTION_LABELS: Record<KeyAction, string> = {
  forward: "前進",
  back: "後退",
  left: "左",
  right: "右",
  jump: "ジャンプ",
  crouch: "しゃがむ",
  prone: "伏せ",
  sprint: "スプリント / 止息",
  reload: "リロード",
  weapon1: "武器1 アサルト",
  weapon2: "武器2 スナイパー",
  weapon3: "武器3 ショットガン",
  weapon4: "武器4 SMG",
  kick: "キック",
  knife: "ナイフ",
  frag: "フラグ",
  flash: "閃光弾",
  interact: "インタラクト(E) / ジップ・蘇生",
  scoreboard: "スコアボード",
};

const DEFAULT_KEYMAP: Record<KeyAction, string> = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  jump: "Space",
  crouch: "ControlLeft",
  prone: "KeyZ",
  sprint: "ShiftLeft",
  reload: "KeyR",
  weapon1: "Digit1",
  weapon2: "Digit2",
  weapon3: "Digit3",
  weapon4: "Digit4",
  kick: "KeyV",
  knife: "KeyF",
  frag: "KeyG",
  flash: "KeyC",
  interact: "KeyE",
  scoreboard: "Tab",
};

const KEYMAP_STORE = "arena_keymap";
const SENS_STORE = "arena_sensitivity";
const ADS_SENS_STORE = "arena_ads_sensitivity";

// 感度プリセット（5段階）。設定画面のボタンとバーの両方がこの範囲を共有する。
export const SENS_MIN = 0.0008;
export const SENS_MAX = 0.005;
export const SENS_PRESETS = [0.0012, 0.0018, 0.0024, 0.0034, 0.0046];
export const ADS_SENS_MIN = 0.0005;
export const ADS_SENS_MAX = 0.0035;
export const ADS_SENS_PRESETS = [0.0008, 0.0011, 0.0014, 0.0019, 0.0026];

// KeyboardEvent.code を見やすい表記に変換する（設定画面の表示用）。
export function keyLabel(code: string): string {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code === "Space") return "Space";
  if (code.startsWith("Arrow")) return code.slice(5);
  return code.replace("Left", " L").replace("Right", " R");
}

// キーボードとマウスの入力をまとめて管理するクラスです。
// 毎フレーム sample() を呼ぶと、その時点の入力状態を返します。
// PCのキー割り当ては再割り当て可能（localStorage に保存）。
export class Input {
  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;

  // 視点（ラジアン）。マウス移動で更新します。
  private yaw = 0;
  private pitch = 0;
  private sensitivity = 0.0022; // 通常（腰だめ）のマウス感度
  private adsSensitivity = 0.0013; // スコープ覗き込み中のマウス感度（別管理）
  private adsActive = false; // 現在スコープADS中か（Game が毎フレーム設定）

  // 再割り当て可能なキーマップ。
  private map: Record<KeyAction, string> = { ...DEFAULT_KEYMAP };

  // 「押した瞬間」を検出するためのフラグ
  private jumpQueued = false;
  private proneQueued = false;
  private reloadQueued = false;
  private switchQueued: WeaponKind | null = null;
  private kickQueued = false;
  private knifeQueued = false;
  private fragHeldDown = false;
  private fragReleasedQueued = false;
  private flashQueued = false;

  private locked = false;

  // ===== タッチ操作用の状態（スマホ・タブレット） =====
  // タッチ操作が有効か（有効時はポインタロック無しでも操作を受け付ける）
  private touchActive = false;
  private touchForward = 0;
  private touchRight = 0;
  private touchFiring = false;
  private touchAiming = false;
  private touchSprint = false;
  private touchCrouch = false;
  private touchRevive = false; // 蘇生ボタン（コープ）/ ジップライン乗降（ルーフトップ）押下中
  private touchScoreboard = false; // スコアボードボタン押下中
  private touchSensitivity = 0.004;

  constructor(private canvas: HTMLElement) {
    this.map = this.loadKeymap();
    this.sensitivity = this.loadSensitivity();
    this.adsSensitivity = this.loadAdsSensitivity();
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChange);
    // 右クリックメニューを抑止（ADS操作と競合するため）
    window.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ===== キー割り当ての保存・読み込み =====
  private loadKeymap(): Record<KeyAction, string> {
    const m: Record<KeyAction, string> = { ...DEFAULT_KEYMAP };
    try {
      const raw = localStorage.getItem(KEYMAP_STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<KeyAction, string>>;
        for (const k of Object.keys(DEFAULT_KEYMAP) as KeyAction[]) {
          const v = saved[k];
          if (typeof v === "string" && v) m[k] = v;
        }
      }
    } catch {
      // 壊れていれば既定のまま
    }
    return m;
  }

  private saveKeymap(): void {
    try {
      localStorage.setItem(KEYMAP_STORE, JSON.stringify(this.map));
    } catch {
      // 保存できなくても動作は継続
    }
  }

  private loadSensitivity(): number {
    const s = parseFloat(localStorage.getItem(SENS_STORE) || "");
    return isFinite(s) && s > 0 ? s : 0.0022;
  }

  private loadAdsSensitivity(): number {
    const s = parseFloat(localStorage.getItem(ADS_SENS_STORE) || "");
    return isFinite(s) && s > 0 ? s : 0.0013;
  }

  // ===== 設定画面向けの公開API =====
  getBindings(): Record<KeyAction, string> {
    return { ...this.map };
  }

  // action に code を割り当てる。同じ code を持つ他アクションがあれば、元の code と入れ替える。
  setBinding(action: KeyAction, code: string): void {
    const prev = this.map[action];
    for (const k of Object.keys(this.map) as KeyAction[]) {
      if (k !== action && this.map[k] === code) this.map[k] = prev; // 重複回避のため入れ替え
    }
    this.map[action] = code;
    this.saveKeymap();
  }

  resetBindings(): void {
    this.map = { ...DEFAULT_KEYMAP };
    this.saveKeymap();
  }

  getSensitivity(): number {
    return this.sensitivity;
  }

  setSensitivity(v: number): void {
    if (!isFinite(v) || v <= 0) return;
    this.sensitivity = v;
    try {
      localStorage.setItem(SENS_STORE, String(v));
    } catch {
      // 無視
    }
  }

  getAdsSensitivity(): number {
    return this.adsSensitivity;
  }

  setAdsSensitivity(v: number): void {
    if (!isFinite(v) || v <= 0) return;
    this.adsSensitivity = v;
    try {
      localStorage.setItem(ADS_SENS_STORE, String(v));
    } catch {
      // 無視
    }
  }

  // 現在スコープ覗き込み中かを設定する（Game が毎フレーム呼ぶ）。ADS中はADS感度を使う。
  setAdsActive(active: boolean): void {
    this.adsActive = active;
  }

  // 画面クリックでポインタロックを要求
  requestLock(): void {
    this.canvas.requestPointerLock();
  }

  isLocked(): boolean {
    return this.locked;
  }

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.canvas;
  };

  // 左右モディファイア（Shift/Ctrl）はどちらでも反応させる（割り当てがL側でもR側でも可）。
  private isDown(code: string): boolean {
    if (this.keys.has(code)) return true;
    if ((code === "ShiftLeft" || code === "ShiftRight") &&
        (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"))) return true;
    if ((code === "ControlLeft" || code === "ControlRight") &&
        (this.keys.has("ControlLeft") || this.keys.has("ControlRight"))) return true;
    return false;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    const m = this.map;
    if (!this.keys.has(code)) {
      // 押した瞬間の処理（割り当てに従う）
      if (code === m.jump) this.jumpQueued = true;
      if (code === m.prone) this.proneQueued = true;
      if (code === m.reload) this.reloadQueued = true;
      if (code === m.weapon1) this.switchQueued = WeaponKind.Assault;
      if (code === m.weapon2) this.switchQueued = WeaponKind.Sniper;
      if (code === m.weapon3) this.switchQueued = WeaponKind.Shotgun;
      if (code === m.weapon4) this.switchQueued = WeaponKind.Smg;
      if (code === m.kick) this.kickQueued = true;
      if (code === m.knife) this.knifeQueued = true;
      if (code === m.frag) this.fragHeldDown = true;
      if (code === m.flash) this.flashQueued = true;
    }
    this.keys.add(code);
    // ブラウザ既定動作（スクロール・タブ移動等）を抑止する割り当てキー
    if (
      code === m.forward ||
      code === m.back ||
      code === m.left ||
      code === m.right ||
      code === m.jump ||
      code === m.crouch ||
      code === m.scoreboard ||
      code === "Tab"
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    // フラグは離した瞬間に投擲（長押し中は軌道プレビュー）
    if (e.code === this.map.frag) {
      this.fragHeldDown = false;
      this.fragReleasedQueued = true;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDownLeft = true;
    if (e.button === 2) this.mouseDownRight = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDownLeft = false;
    if (e.button === 2) this.mouseDownRight = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    const sens = this.adsActive ? this.adsSensitivity : this.sensitivity;
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    // 上下の視点は真上・真下で止める
    const limit = Math.PI / 2 - 0.01;
    if (this.pitch > limit) this.pitch = limit;
    if (this.pitch < -limit) this.pitch = -limit;
  };

  // 反動などで外部から視点を動かしたいとき用
  addPitch(delta: number): void {
    this.pitch += delta;
    const limit = Math.PI / 2 - 0.01;
    if (this.pitch > limit) this.pitch = limit;
    if (this.pitch < -limit) this.pitch = -limit;
  }

  getYaw(): number {
    return this.yaw;
  }
  getPitch(): number {
    return this.pitch;
  }

  // ===== タッチ操作レイヤーからの入力窓口 =====
  // タッチ操作の有効・無効を切り替える
  setTouchActive(active: boolean): void {
    this.touchActive = active;
  }

  // 操作を受け付けてよい状態か（ポインタロック中、またはタッチ操作有効）
  isActive(): boolean {
    return this.locked || this.touchActive;
  }

  // 移動スティックの倒し具合（前後・左右、それぞれ -1〜1）
  setTouchMove(forward: number, right: number): void {
    this.touchForward = forward;
    this.touchRight = right;
  }

  // 画面ドラッグによる視点移動。マウス移動と同じ向きで反映する。
  applyTouchLook(dx: number, dy: number): void {
    this.yaw -= dx * this.touchSensitivity;
    this.pitch -= dy * this.touchSensitivity;
    const limit = Math.PI / 2 - 0.01;
    if (this.pitch > limit) this.pitch = limit;
    if (this.pitch < -limit) this.pitch = -limit;
  }

  // 押しっぱなし系ボタン（射撃・ADS・ダッシュ・しゃがみ）の状態
  // 蘇生（コープ）のタッチ長押し状態。
  setTouchRevive(pressed: boolean): void {
    this.touchRevive = pressed;
  }

  setTouchScoreboard(pressed: boolean): void {
    this.touchScoreboard = pressed;
  }

  setTouchHold(action: "fire" | "ads" | "sprint" | "crouch", pressed: boolean): void {
    if (action === "fire") this.touchFiring = pressed;
    else if (action === "ads") this.touchAiming = pressed;
    else if (action === "sprint") this.touchSprint = pressed;
    else if (action === "crouch") this.touchCrouch = pressed;
  }

  // 押した瞬間系ボタン（キーボードと同じ「キュー」を立てる）
  queueJump(): void {
    this.jumpQueued = true;
  }
  queueProne(): void {
    this.proneQueued = true;
  }
  queueReload(): void {
    this.reloadQueued = true;
  }
  queueSwitch(kind: WeaponKind): void {
    this.switchQueued = kind;
  }
  queueKick(): void {
    this.kickQueued = true;
  }
  queueKnife(): void {
    this.knifeQueued = true;
  }
  // モバイルの閃光弾ボタン。キーボードのCキーと同じく flashQueued を立てる。
  queueFlash(): void {
    this.flashQueued = true;
  }
  // モバイルのグレネードボタン。長押しで軌道プレビュー、離した瞬間にフラグ投擲。
  setGrenadeHeld(held: boolean): void {
    if (this.fragHeldDown && !held) this.fragReleasedQueued = true;
    this.fragHeldDown = held;
  }

  // 毎フレーム呼ぶ。現在の入力をまとめて返す。
  sample(): InputState {
    const m = this.map;
    const kbForward = (this.isDown(m.forward) ? 1 : 0) - (this.isDown(m.back) ? 1 : 0);
    const kbRight = (this.isDown(m.right) ? 1 : 0) - (this.isDown(m.left) ? 1 : 0);

    // キーボードとタッチの移動入力を合算し、-1〜1に収める
    const forward = Math.max(-1, Math.min(1, kbForward + this.touchForward));
    const right = Math.max(-1, Math.min(1, kbRight + this.touchRight));

    const state: InputState = {
      forward,
      right,
      sprint: this.isDown(m.sprint) || this.touchSprint,
      crouch: this.isDown(m.crouch) || this.touchCrouch,
      jumpPressed: this.jumpQueued,
      pronePressed: this.proneQueued,
      firing: this.mouseDownLeft || this.touchFiring,
      aiming: this.mouseDownRight || this.touchAiming,
      reloadPressed: this.reloadQueued,
      switchTo: this.switchQueued,
      kickPressed: this.kickQueued,
      knifePressed: this.knifeQueued,
      fragHeld: this.fragHeldDown,
      fragReleased: this.fragReleasedQueued,
      flashThrow: this.flashQueued,
      interactHeld: this.isDown(m.interact) || this.touchRevive,
      scoreboardHeld: this.isDown(m.scoreboard) || this.touchScoreboard,
      yaw: this.yaw,
      pitch: this.pitch,
    };

    // 「押した瞬間」系は1フレームで消費してリセット
    this.jumpQueued = false;
    this.proneQueued = false;
    this.reloadQueued = false;
    this.switchQueued = null;
    this.kickQueued = false;
    this.knifeQueued = false;
    this.fragReleasedQueued = false;
    this.flashQueued = false;

    return state;
  }
}
