import * as THREE from "three";

// 投げられた手榴弾1個。放物線で飛び、地面・障害物への接触か時限で爆発する。
export class Grenade {
  group: THREE.Group;

  private vel: THREE.Vector3;
  private life = 2.5; // 時限（秒）。これを過ぎると爆発する。
  private readonly G = 22; // 重力加速度
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(origin: THREE.Vector3, vel: THREE.Vector3) {
    this.group = new THREE.Group();
    this.vel = vel.clone();

    const bodyG = new THREE.SphereGeometry(0.16, 12, 10);
    this.geos.push(bodyG);
    const bodyM = new THREE.MeshStandardMaterial({
      color: 0x3a4a2a,
      emissive: 0x223018,
      emissiveIntensity: 0.3,
      roughness: 0.5,
      metalness: 0.3,
    });
    this.mats.push(bodyM);
    const body = new THREE.Mesh(bodyG, bodyM);
    this.group.add(body);

    this.group.position.copy(origin);
  }

  // 飛行を1フレーム進める。爆発条件を満たしたら true を返す。
  update(dt: number, colliders: THREE.Box3[]): boolean {
    this.vel.y -= this.G * dt;
    this.group.position.addScaledVector(this.vel, dt);
    this.life -= dt;
    // 転がっているように軽く回す
    this.group.rotation.x += dt * 6;
    this.group.rotation.y += dt * 4;

    // 地面に着いたら爆発
    if (this.group.position.y <= 0.16) {
      this.group.position.y = 0.16;
      return true;
    }
    // 時限切れで爆発
    if (this.life <= 0) return true;
    // 壁やブロックにめり込んだら爆発
    for (const c of colliders) {
      if (c.containsPoint(this.group.position)) return true;
    }
    return false;
  }

  getPosition(): THREE.Vector3 {
    return this.group.position;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
