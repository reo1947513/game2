import * as THREE from "three";
import { ProjectileState } from "./netTypes";

// サーバー権威で飛んでいるグレネードを、クライアント側でそのまま描画するゴースト弾。
// 物理はサーバーが計算し、こちらは受け取った座標へメッシュを置くだけ。
export class RemoteProjectile {
  readonly id: string;
  readonly group: THREE.Group;
  private geo: THREE.BufferGeometry;
  private mat: THREE.Material;

  constructor(state: ProjectileState) {
    this.id = state.id;
    this.group = new THREE.Group();
    if (state.type === "frag") {
      this.geo = new THREE.SphereGeometry(0.09, 12, 10);
      this.mat = new THREE.MeshStandardMaterial({
        color: 0x2c3322,
        emissive: new THREE.Color(0xff7b1c),
        emissiveIntensity: 0.4,
        roughness: 0.6,
        metalness: 0.4,
      });
    } else {
      this.geo = new THREE.CylinderGeometry(0.055, 0.055, 0.17, 12);
      this.mat = new THREE.MeshStandardMaterial({
        color: 0xd8dde6,
        emissive: new THREE.Color(0x3aa8ff),
        emissiveIntensity: 0.5,
        roughness: 0.35,
        metalness: 0.7,
      });
    }
    const mesh = new THREE.Mesh(this.geo, this.mat);
    this.group.add(mesh);
    this.update(state);
  }

  update(state: ProjectileState): void {
    this.group.position.set(state.position.x, state.position.y, state.position.z);
    // 飛行中はくるくる回す（見た目だけ）
    this.group.rotation.x += 0.3;
    this.group.rotation.y += 0.2;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
