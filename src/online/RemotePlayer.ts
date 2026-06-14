import * as THREE from "three";
import { PlayerState } from "./netTypes";
import { Interpolator } from "./Interpolator";
import { AvatarFactory } from "../avatar/AvatarFactory";
import { AvatarAnimParams, IAvatar } from "../avatar/IAvatar";

// 他プレイヤーのゴースト表示。受信状態を補間して滑らかに動かし、人型アバターで描く。
// 見た目は IAvatar 抽象に委譲（将来 .glb 差替は AvatarFactory 側で対応）。
export class RemotePlayer {
  readonly group: THREE.Group;
  readonly playerId: string;

  private interp = new Interpolator();
  private avatar: IAvatar;

  private prevPos: THREE.Vector3 | null = null;
  private maxHp = 100;

  constructor(playerId: string, color?: number) {
    this.playerId = playerId;
    this.group = new THREE.Group();

    this.avatar = AvatarFactory.create();
    this.group.add(this.avatar.object3d);

    const c = color ?? hashColor(playerId);
    this.avatar.setTeamColor(c);
    this.avatar.setNameLabel(playerId.length > 12 ? playerId.slice(0, 12) : playerId);
    this.avatar.setHp(1);
  }

  // チーム色などを後から設定したい場合に使う。
  setColor(color: number): void {
    this.avatar.setTeamColor(color);
  }

  // サーバーからの状態を受け取る。
  receiveState(state: PlayerState): void {
    this.interp.push(state.position, state.yaw, state.pitch);
    if (state.hp > this.maxHp) this.maxHp = state.hp;
    if (state.hp <= 0) {
      this.avatar.setState("dead");
      this.avatar.setHp(0);
    } else {
      this.avatar.setState("alive");
      this.avatar.setHp(this.maxHp > 0 ? state.hp / this.maxHp : 1);
    }
  }

  // 毎フレーム呼ぶ。dt（秒）でアニメ駆動、renderDelay（ms）だけ過去の補間結果へゴーストを移動。
  update(dt: number, renderDelay: number): void {
    const s = this.interp.sample(renderDelay);
    if (!s) return;

    // 位置・向き（従来どおり＝補間の滑らかさを維持）
    this.group.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.group.rotation.y = s.yaw;

    // 補間座標の差分から移動量を推定（PlayerState の velocity は補間経路に乗らないため）
    let speed = 0;
    let verticalVel = 0;
    if (this.prevPos && dt > 0) {
      const dx = s.pos.x - this.prevPos.x;
      const dy = s.pos.y - this.prevPos.y;
      const dz = s.pos.z - this.prevPos.z;
      speed = Math.hypot(dx, dz) / dt;
      verticalVel = dy / dt;
    }
    if (!this.prevPos) this.prevPos = new THREE.Vector3();
    this.prevPos.set(s.pos.x, s.pos.y, s.pos.z);

    const params: AvatarAnimParams = {
      speed,
      isGrounded: Math.abs(verticalVel) < 0.5,
      verticalVel,
      yaw: s.yaw,
      pitch: s.pitch,
      isAiming: false, // 同期対象外（現状スタブ）
      isCrouching: false, // 同期対象外（現状スタブ）
      weaponType: "ar", // 同期対象外（既定）
    };
    this.avatar.update(dt, params);
  }

  dispose(): void {
    this.avatar.dispose();
  }
}

// playerId から安定した色を作る（簡易ハッシュ→Hue）。
function hashColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = (h % 360) / 360;
  const c = new THREE.Color();
  c.setHSL(hue, 0.65, 0.55);
  return c.getHex();
}
