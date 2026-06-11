import { InputState, WeaponKind } from "./types";

// キーボードとマウスの入力をまとめて管理するクラスです。
// 毎フレーム sample() を呼ぶと、その時点の入力状態を返します。
export class Input {
  private keys = new Set<string>();
  private mouseDownLeft = false;
  private mouseDownRight = false;

  // 視点（ラジアン）。マウス移動で更新します。
  private yaw = 0;
  private pitch = 0;
  private sensitivity = 0.0022;

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
  private touchSensitivity = 0.004;

  constructor(private canvas: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onLockChange);
    // 右クリックメニューを抑止（ADS操作と競合するため）
    window.addEventListener("contextmenu", (e) => e.preventDefault());
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

  private onKeyDown = (e: KeyboardEvent): void => {
    const code = e.code;
    if (!this.keys.has(code)) {
      // 押した瞬間の処理
      if (code === "Space") this.jumpQueued = true;
      if (code === "KeyZ") this.proneQueued = true;
      if (code === "KeyR") this.reloadQueued = true;
      if (code === "Digit1") this.switchQueued = WeaponKind.Assault;
      if (code === "Digit2") this.switchQueued = WeaponKind.Sniper;
      if (code === "Digit3") this.switchQueued = WeaponKind.Shotgun;
      if (code === "Digit4") this.switchQueued = WeaponKind.Smg;
      if (code === "KeyV") this.kickQueued = true;
      if (code === "KeyF") this.knifeQueued = true;
      if (code === "KeyG") this.fragHeldDown = true;
      if (code === "KeyC") this.flashQueued = true;
    }
    this.keys.add(code);
    // ブラウザ既定動作（スクロール等）を抑止
    if (
      ["Space", "KeyW", "KeyA", "KeyS", "KeyD", "ControlLeft", "ControlRight"].includes(code)
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    // フラグは離した瞬間に投擲（長押し中は軌道プレビュー）
    if (e.code === "KeyG") {
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
    this.yaw -= e.movementX * this.sensitivity;
    this.pitch -= e.movementY * this.sensitivity;
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
  // モバイルのグレネードボタン。長押しで軌道プレビュー、離した瞬間にフラグ投擲。
  setGrenadeHeld(held: boolean): void {
    if (this.fragHeldDown && !held) this.fragReleasedQueued = true;
    this.fragHeldDown = held;
  }

  // 毎フレーム呼ぶ。現在の入力をまとめて返す。
  sample(): InputState {
    const kbForward =
      (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const kbRight =
      (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);

    // キーボードとタッチの移動入力を合算し、-1〜1に収める
    const forward = Math.max(-1, Math.min(1, kbForward + this.touchForward));
    const right = Math.max(-1, Math.min(1, kbRight + this.touchRight));

    const state: InputState = {
      forward,
      right,
      sprint:
        this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touchSprint,
      crouch:
        this.keys.has("ControlLeft") ||
        this.keys.has("ControlRight") ||
        this.touchCrouch,
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
