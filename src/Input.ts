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

  private locked = false;

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

  // 毎フレーム呼ぶ。現在の入力をまとめて返す。
  sample(): InputState {
    const forward =
      (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const right =
      (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);

    const state: InputState = {
      forward,
      right,
      sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      crouch: this.keys.has("ControlLeft") || this.keys.has("ControlRight"),
      jumpPressed: this.jumpQueued,
      pronePressed: this.proneQueued,
      firing: this.mouseDownLeft,
      aiming: this.mouseDownRight,
      reloadPressed: this.reloadQueued,
      switchTo: this.switchQueued,
      yaw: this.yaw,
      pitch: this.pitch,
    };

    // 「押した瞬間」系は1フレームで消費してリセット
    this.jumpQueued = false;
    this.proneQueued = false;
    this.reloadQueued = false;
    this.switchQueued = null;

    return state;
  }
}
