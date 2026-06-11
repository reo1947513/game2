import * as THREE from "three";

export type GrenadeType = "frag" | "flash";

// 投げられたグレネード1個。放物線で飛びつつ回転し、床・壁でバウンドして、
// 信管が尽きると起爆する（起爆処理は GrenadeSystem 側が担当する）。
export class Grenade {
  group: THREE.Group;
  readonly type: GrenadeType;

  private vel: THREE.Vector3;
  private spin: THREE.Vector3; // 各軸の角速度（rad/s）
  private fuse: number; // 信管の残り時間（秒）

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  private readonly G = 26; // 重力（プレイヤー物理に合わせた値）
  private readonly R = 0.12; // 本体の衝突半径（m）

  constructor(
    type: GrenadeType,
    origin: THREE.Vector3,
    vel: THREE.Vector3,
    spin: THREE.Vector3,
    fuse: number
  ) {
    this.type = type;
    this.vel = vel.clone();
    this.spin = spin.clone();
    this.fuse = fuse;
    this.group = new THREE.Group();

    if (type === "frag") {
      this.buildFrag();
    } else {
      this.buildFlash();
    }

    this.group.position.copy(origin);
  }

  private buildFrag(): void {
    const bodyG = new THREE.SphereGeometry(0.09, 12, 10);
    this.geos.push(bodyG);
    const bodyM = new THREE.MeshStandardMaterial({
      color: 0x2c3322,
      roughness: 0.6,
      metalness: 0.4,
    });
    this.mats.push(bodyM);
    this.group.add(new THREE.Mesh(bodyG, bodyM));

    const ringG = new THREE.TorusGeometry(0.09, 0.015, 8, 20);
    this.geos.push(ringG);
    const ringM = new THREE.MeshStandardMaterial({
      color: 0xff7b1c,
      emissive: 0xff7b1c,
      emissiveIntensity: 0.8,
      roughness: 0.4,
      metalness: 0.3,
    });
    this.mats.push(ringM);
    const ring = new THREE.Mesh(ringG, ringM);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    const pinG = new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8);
    this.geos.push(pinG);
    const pinM = new THREE.MeshStandardMaterial({
      color: 0x8a93a0,
      roughness: 0.4,
      metalness: 0.8,
    });
    this.mats.push(pinM);
    const pin = new THREE.Mesh(pinG, pinM);
    pin.position.set(0, 0.11, 0);
    this.group.add(pin);
  }

  private buildFlash(): void {
    const bodyG = new THREE.CylinderGeometry(0.055, 0.055, 0.17, 16);
    this.geos.push(bodyG);
    const bodyM = new THREE.MeshStandardMaterial({
      color: 0xd8dde6,
      roughness: 0.35,
      metalness: 0.7,
    });
    this.mats.push(bodyM);
    this.group.add(new THREE.Mesh(bodyG, bodyM));

    const bandG = new THREE.CylinderGeometry(0.057, 0.057, 0.035, 16);
    this.geos.push(bandG);
    const bandM = new THREE.MeshStandardMaterial({
      color: 0x3aa8ff,
      emissive: 0x3aa8ff,
      emissiveIntensity: 0.9,
      roughness: 0.4,
      metalness: 0.6,
    });
    this.mats.push(bandM);
    const band = new THREE.Mesh(bandG, bandM);
    band.position.set(0, 0.045, 0);
    this.group.add(band);
  }

  // 飛行を1フレーム進める。信管が尽きたら true（起爆）を返す。
  update(dt: number, colliders: THREE.Box3[]): boolean {
    this.vel.y -= this.G * dt;
    this.group.position.addScaledVector(this.vel, dt);
    this.group.rotation.x += this.spin.x * dt;
    this.group.rotation.y += this.spin.y * dt;
    this.group.rotation.z += this.spin.z * dt;

    // 床バウンド
    const p = this.group.position;
    if (p.y < this.R) {
      p.y = this.R;
      if (Math.abs(this.vel.y) > 1.0) {
        this.vel.y *= -0.45;
      } else {
        this.vel.y = 0;
      }
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
      this.spin.multiplyScalar(0.85);
    }

    // AABBバウンド：コライダーを半径ぶん拡張し、内部なら最小めり込み軸で押し出して反射
    const r = this.R;
    for (const c of colliders) {
      if (
        p.x > c.min.x - r &&
        p.x < c.max.x + r &&
        p.y > c.min.y - r &&
        p.y < c.max.y + r &&
        p.z > c.min.z - r &&
        p.z < c.max.z + r
      ) {
        const pxMin = p.x - (c.min.x - r);
        const pxMax = c.max.x + r - p.x;
        const pyMin = p.y - (c.min.y - r);
        const pyMax = c.max.y + r - p.y;
        const pzMin = p.z - (c.min.z - r);
        const pzMax = c.max.z + r - p.z;
        const m = Math.min(pxMin, pxMax, pyMin, pyMax, pzMin, pzMax);
        if (m === pxMin) {
          p.x = c.min.x - r;
          this.vel.x *= -0.45;
        } else if (m === pxMax) {
          p.x = c.max.x + r;
          this.vel.x *= -0.45;
        } else if (m === pyMin) {
          p.y = c.min.y - r;
          this.vel.y *= -0.45;
          this.vel.x *= 0.8;
          this.vel.z *= 0.8;
        } else if (m === pyMax) {
          p.y = c.max.y + r;
          this.vel.y *= -0.45;
          this.vel.x *= 0.8;
          this.vel.z *= 0.8;
        } else if (m === pzMin) {
          p.z = c.min.z - r;
          this.vel.z *= -0.45;
        } else {
          p.z = c.max.z + r;
          this.vel.z *= -0.45;
        }
      }
    }

    this.fuse -= dt;
    return this.fuse <= 0;
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
