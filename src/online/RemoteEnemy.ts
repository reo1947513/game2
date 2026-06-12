import * as THREE from "three";
import { ServerEnemyState, EnemyType } from "./netTypes";

// サーバー権威で動く敵を、クライアント側で描画するゴースト。
// 物理・AIはサーバーが計算し、こちらは受け取った座標へ滑らかに寄せて置くだけ。
const DIMS: Record<EnemyType, { r: number; h: number; color: number; emissive: number }> = {
  grunt: { r: 0.45, h: 1.8, color: 0xb83a3a, emissive: 0x5a1010 },
  fast: { r: 0.4, h: 1.7, color: 0xe0a020, emissive: 0x5a3c00 },
  boss: { r: 0.9, h: 2.6, color: 0x8a3ad0, emissive: 0x35105a },
};

export class RemoteEnemy {
  readonly id: string;
  readonly etype: EnemyType;
  readonly group: THREE.Group;
  private body: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private headGeo: THREE.BufferGeometry;
  private headMat: THREE.MeshStandardMaterial;
  private target = new THREE.Vector3();

  constructor(state: ServerEnemyState) {
    this.id = state.id;
    this.etype = state.etype;
    const d = DIMS[state.etype];
    this.group = new THREE.Group();

    // 胴体（地面に底面が来るよう height/2 持ち上げる）
    const bodyH = d.h * 0.75;
    this.geo = new THREE.BoxGeometry(d.r * 1.6, bodyH, d.r * 1.6);
    this.mat = new THREE.MeshStandardMaterial({
      color: d.color,
      emissive: new THREE.Color(d.emissive),
      emissiveIntensity: 0.5,
      roughness: 0.7,
      metalness: 0.2,
    });
    this.body = new THREE.Mesh(this.geo, this.mat);
    this.body.position.y = bodyH / 2;
    this.body.castShadow = true;
    this.group.add(this.body);

    // 頭
    this.headGeo = new THREE.SphereGeometry(d.r * 0.7, 12, 10);
    this.headMat = new THREE.MeshStandardMaterial({
      color: d.color,
      emissive: new THREE.Color(d.emissive),
      emissiveIntensity: 0.7,
      roughness: 0.6,
    });
    const head = new THREE.Mesh(this.headGeo, this.headMat);
    head.position.y = bodyH + d.r * 0.6;
    this.group.add(head);

    this.target.set(state.position.x, state.position.y, state.position.z);
    this.group.position.copy(this.target);
  }

  setState(state: ServerEnemyState): void {
    this.target.set(state.position.x, state.position.y, state.position.z);
  }

  // 毎フレーム、目標座標へ滑らかに寄せる。
  update(dt: number): void {
    const k = Math.min(1, dt * 12);
    this.group.position.lerp(this.target, k);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.headGeo.dispose();
    this.headMat.dispose();
  }
}
