import * as THREE from "three";
import { AvatarAnimParams, AvatarState, IAvatar } from "./IAvatar";

// 将来用の雛形。.glb モデル＋スケルタルアニメに差し替えるときにここを実装する。
// 現状は空の Object3D を返すだけ（AvatarFactory はまだこれを使わない）。
// TODO: GLTFLoader で .glb を読み、AnimationMixer で歩行/走行/構え等のクリップを再生。
//       AvatarAnimParams.speed / isAiming などからクリップとブレンドを選ぶ。
export class GLTFAvatar implements IAvatar {
  readonly object3d: THREE.Object3D = new THREE.Group();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_dt: number, _params: AvatarAnimParams): void {
    // TODO: AnimationMixer.update(_dt) ＋ params に応じたクリップ選択
  }
  setTeamColor(_color: number): void {
    // TODO: マテリアル/エミッシブにチームカラーを適用
  }
  setState(_state: AvatarState): void {
    // TODO: down/dead のアニメ・表示切替
  }
  setNameLabel(_name: string): void {
    // TODO: 頭上ラベル
  }
  setHp(_frac: number): void {
    // TODO: HPバー表示
  }
  dispose(): void {
    // TODO: モデル・テクスチャ・mixer の解放
  }
}
