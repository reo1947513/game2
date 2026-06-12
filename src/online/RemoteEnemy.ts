import * as THREE from "three";
import { ServerEnemyState, EnemyType } from "./netTypes";

// サーバー権威で動く敵を、クライアント側で描画するゴースト。
// 物理・AIはサーバーが計算し、こちらは受け取った座標へ滑らかに寄せて置くだけ。
//
// grunt/fast/boss は既存コープ用。standard〜summoner はタワーの雑魚5種、boss_* は
// タワーのボス5種（寸法・色はオフライン版 TowerMode の見た目に合わせている）。
// タワーの fast はコープと同じ種別を共用するため、見た目もコープの fast（琥珀色）を流用する。
const DIMS: Record<EnemyType, { r: number; h: number; color: number; emissive: number }> = {
  // 既存コープ
  grunt: { r: 0.45, h: 1.8, color: 0xb83a3a, emissive: 0x5a1010 },
  fast: { r: 0.4, h: 1.7, color: 0xe0a020, emissive: 0x5a3c00 },
  boss: { r: 0.9, h: 2.6, color: 0x8a3ad0, emissive: 0x35105a },
  // タワー雑魚5種
  standard: { r: 0.45, h: 1.8, color: 0xff6a00, emissive: 0x4a1f00 },
  tank: { r: 0.8, h: 1.6, color: 0x6688aa, emissive: 0x1d2733 },
  ranged: { r: 0.45, h: 1.7, color: 0x9a6ad0, emissive: 0x281a3a },
  exploder: { r: 0.45, h: 0.9, color: 0xff6600, emissive: 0x5a2400 },
  summoner: { r: 0.55, h: 2.0, color: 0xcc44cc, emissive: 0x3a1230 },
  // タワーボス5種
  boss_crusher: { r: 1.2, h: 2.5, color: 0x6f93b8, emissive: 0x223044 },
  boss_phantom: { r: 0.3, h: 1.6, color: 0xeeeeff, emissive: 0x6a6a88 },
  boss_warlord: { r: 0.8, h: 2.2, color: 0xff5522, emissive: 0x6a1a00 },
  boss_hivemind: { r: 1.0, h: 2.0, color: 0xaa44ff, emissive: 0x36004f },
  boss_siege: { r: 1.5, h: 3.0, color: 0x4466ff, emissive: 0x111122 },
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
