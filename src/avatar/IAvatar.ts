import * as THREE from "three";

// アバター描画の共通インターフェース。将来 .glb 実装へ AvatarFactory.create() の1行変更で差替できる。
export interface AvatarAnimParams {
  speed: number; // 水平移動速度（歩行/走行の選択）
  isGrounded: boolean; // 接地（ジャンプポーズ判定）
  verticalVel: number; // 垂直速度（上昇/下降）
  yaw: number; // 体の向き（RemotePlayer.group 側で反映済み・参考用）
  pitch: number; // 上下の向き（上半身/頭の傾き）
  isAiming: boolean; // 構えポーズ
  isCrouching: boolean; // しゃがみ/スライド
  weaponType: string; // 手に持つ武器（ar/sniper/knife/none）
}

export type AvatarState = "alive" | "down" | "dead";

export interface IAvatar {
  readonly object3d: THREE.Object3D;
  update(dt: number, params: AvatarAnimParams): void;
  setTeamColor(color: number): void;
  setState(state: AvatarState): void;
  setNameLabel(name: string): void;
  // HPバー表示（0..1）。<0 で非表示。
  setHp(frac: number): void;
  dispose(): void;
}
