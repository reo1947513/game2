import type { Game } from "../Game";

// DEV RANGE 内部で共有する型。値の循環 import を避けるため型だけをここに集約する。

// Game.devContext() が返す内部システム一式。
export type DevCtx = ReturnType<Game["devContext"]>;

// カメラの操作モード。
export type CameraMode = "fps" | "free" | "orbit";

// 各タブのパネルが実装する共通インターフェース。
export interface DevPanel {
  element: HTMLElement;
  onShow?(): void;
  onHide?(): void;
  update?(dt: number, now: number): void;
}

// パネルから DevRange 本体へアクセスするための最小インターフェース。
export interface DevApp {
  readonly ctx: DevCtx;
  setCameraMode(mode: CameraMode): void;
  getCameraMode(): CameraMode;
}
