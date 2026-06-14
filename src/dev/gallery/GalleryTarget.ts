import * as THREE from "three";

// SHOOTING GALLERY の的（メッシュ型）：同心円の静止的・往復・振り子・ポップアップ。
// 当たり判定メッシュ hitMesh を1つ持ち、WeaponSystem.enemyTargets に登録して撃てるようにする。
// 命中点から部位（head/body/graze）と得点を classify() で判定する。
export type GalleryKind = "static" | "patrol" | "pendulum" | "popup";

export interface HitZone {
  zone: "head" | "body" | "graze";
  score: number;
}

export class GalleryTarget {
  readonly group = new THREE.Group();
  readonly hitMesh: THREE.Mesh;
  readonly kind: GalleryKind;

  private originX: number;
  private dir = 1;
  private readonly range: number;
  private readonly speed: number;
  // 振り子
  private readonly pivotY = 8;
  private readonly len = 6;
  // ポップアップ
  private up = true;
  private nextToggle = 0;
  private readonly interval: number;

  constructor(
    scene: THREE.Scene,
    kind: GalleryKind,
    x: number,
    z: number,
    opts?: { speed?: number; interval?: number; range?: number }
  ) {
    this.kind = kind;
    this.originX = x;
    this.speed = opts?.speed ?? 4;
    this.interval = opts?.interval ?? 2;
    this.range = opts?.range ?? 7;

    if (kind === "static") {
      // 同心円の的（プレイヤー= +z 方向を向く）。hitMesh は外側ディスク。
      this.hitMesh = new THREE.Mesh(
        new THREE.CircleGeometry(0.9, 40),
        new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, metalness: 0.05 })
      );
      const yellow = new THREE.Mesh(
        new THREE.RingGeometry(0.25, 0.55, 40),
        new THREE.MeshStandardMaterial({ color: 0xffce5a, roughness: 0.7 })
      );
      yellow.position.z = 0.01;
      const red = new THREE.Mesh(
        new THREE.CircleGeometry(0.25, 32),
        new THREE.MeshStandardMaterial({ color: 0xff4030, roughness: 0.7 })
      );
      red.position.z = 0.02;
      this.group.add(this.hitMesh, yellow, red);
      this.group.position.set(x, 1.4, z);
    } else {
      // 立ち的（往復・振り子・ポップアップ共通）。
      this.hitMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 1.8, 0.2),
        new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.6, metalness: 0.1 })
      );
      this.hitMesh.castShadow = true;
      this.group.add(this.hitMesh);
      this.group.position.set(x, kind === "pendulum" ? this.pivotY - this.len : 0.9, z);
    }
    scene.add(this.group);
  }

  owns(obj: THREE.Object3D): boolean {
    return obj === this.hitMesh;
  }

  // ポップアップが伏せ中は当たらない扱いにする。
  hittable(): boolean {
    return this.kind !== "popup" || this.up;
  }

  // 命中点から部位と得点を判定。
  classify(point: THREE.Vector3): HitZone {
    if (this.kind === "static") {
      const dx = point.x - this.group.position.x;
      const dy = point.y - this.group.position.y;
      const r = Math.hypot(dx, dy);
      if (r < 0.25) return { zone: "head", score: 10 };
      if (r < 0.55) return { zone: "body", score: 5 };
      return { zone: "graze", score: 1 };
    }
    // 立ち的：上部=ヘッド相当
    const top = this.group.position.y + (this.kind === "pendulum" ? 0 : 0.55);
    return point.y > top + 0.35 ? { zone: "head", score: 10 } : { zone: "body", score: 5 };
  }

  update(_dt: number, now: number): void {
    if (this.kind === "patrol") {
      const tx = this.originX + this.dir * this.range;
      this.group.position.x += this.dir * this.speed * _dt;
      if (Math.abs(this.group.position.x - tx) < 0.2 || Math.abs(this.group.position.x - this.originX) > this.range)
        this.dir *= -1;
    } else if (this.kind === "pendulum") {
      const ang = Math.sin(now * (this.speed * 0.25)) * 0.8;
      this.group.position.x = this.originX + Math.sin(ang) * this.len;
      this.group.position.y = this.pivotY - Math.cos(ang) * this.len;
    } else if (this.kind === "popup") {
      if (now >= this.nextToggle) {
        this.up = !this.up;
        this.nextToggle = now + (this.up ? this.interval : 1.0 + Math.random() * this.interval);
        this.group.position.y = this.up ? 0.9 : -2.2; // 伏せ＝床下へ
        this.group.visible = this.up;
      }
    }
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const x of mat) x.dispose();
      else if (mat) (mat as THREE.Material).dispose();
    });
  }
}
