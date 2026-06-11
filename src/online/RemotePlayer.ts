import * as THREE from "three";
import { PlayerState } from "./netTypes";
import { Interpolator } from "./Interpolator";

// 他プレイヤーのゴースト表示。受信状態を補間して滑らかに動かす簡易な人型メッシュ。
export class RemotePlayer {
  readonly group: THREE.Group;
  readonly playerId: string;

  private interp = new Interpolator();
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private head: THREE.Mesh; // 視線方向の目印を持つ頭

  constructor(playerId: string, color = 0x36c0ff) {
    this.playerId = playerId;
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.25,
      roughness: 0.5,
      metalness: 0.2,
      transparent: true,
      opacity: 0.85,
    });
    this.mats.push(bodyMat);

    // 胴（カプセル風）
    const torsoG = new THREE.CapsuleGeometry(0.35, 0.9, 6, 12);
    this.geos.push(torsoG);
    const torso = new THREE.Mesh(torsoG, bodyMat);
    torso.position.y = 1.0;
    this.group.add(torso);

    // 頭
    const headG = new THREE.SphereGeometry(0.28, 16, 12);
    this.geos.push(headG);
    this.head = new THREE.Mesh(headG, bodyMat);
    this.head.position.y = 1.75;
    this.group.add(this.head);

    // 視線方向の目印（前方へ突き出す小さなコーン）
    const noseG = new THREE.ConeGeometry(0.12, 0.3, 8);
    this.geos.push(noseG);
    const noseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mats.push(noseMat);
    const nose = new THREE.Mesh(noseG, noseMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 1.75, -0.32); // -z が前方
    this.group.add(nose);
  }

  // サーバーからの状態を受け取る。
  receiveState(state: PlayerState): void {
    this.interp.push(state.position, state.yaw, state.pitch);
  }

  // 毎フレーム呼ぶ。renderDelay（ms）だけ過去の補間結果へゴーストを移動させる。
  update(renderDelay: number): void {
    const s = this.interp.sample(renderDelay);
    if (!s) return;
    this.group.position.set(s.pos.x, s.pos.y, s.pos.z);
    this.group.rotation.y = s.yaw; // 体は yaw のみ（頭の上下は簡略化）
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
