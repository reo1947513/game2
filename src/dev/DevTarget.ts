import * as THREE from "three";
import { EnemyUnit } from "../Enemy";

// DEV RANGE 用の的。EnemyUnit（敵の人型メッシュ・当たり判定）を流用し、
// 静止／往復／ランダム移動と、被弾で減るHPバーを持つ。HPが0になると一定時間後に全回復し、
// 何度でもダメージ確認に使える。WeaponSystem の enemyTargets/enemyHitHook と連携する。
export type DevTargetKind = "static" | "patrol" | "random";

export class DevTarget {
  readonly unit: EnemyUnit;
  readonly kind: DevTargetKind;

  private maxHp = 250;
  private hp = 250;
  private dead = false;
  private refillAt = 0;

  // 移動状態
  private originX: number;
  private originZ: number;
  private dir = 1; // 往復の向き
  private readonly range = 6;
  private readonly speed = 3.2;
  private tx: number;
  private tz: number;
  private repickAt = 0;

  // HPバー（シーン直下に置きカメラへビルボードする）
  private barGroup: THREE.Group;
  private barFill: THREE.Mesh;
  private barFillMat: THREE.MeshBasicMaterial;
  private readonly barW = 1.0;

  constructor(scene: THREE.Scene, kind: DevTargetKind, x: number, z: number) {
    this.kind = kind;
    this.originX = x;
    this.originZ = z;
    this.tx = x;
    this.tz = z;

    const color =
      kind === "patrol" ? 0x2a6cff : kind === "random" ? 0xb14bff : 0xff5a3c;
    this.unit = new EnemyUnit({ scale: 1.0, bodyColor: 0x23262e, accentColor: color });
    this.unit.setGround(x, z);
    scene.add(this.unit.group);

    // HPバー
    this.barGroup = new THREE.Group();
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(this.barW + 0.06, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x0a0c10, transparent: true, opacity: 0.8, depthTest: false })
    );
    bg.renderOrder = 998;
    this.barFillMat = new THREE.MeshBasicMaterial({ color: 0x6ce06c, depthTest: false });
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(this.barW, 0.12), this.barFillMat);
    this.barFill.position.z = 0.001;
    this.barFill.renderOrder = 999;
    this.barGroup.add(bg);
    this.barGroup.add(this.barFill);
    scene.add(this.barGroup);
  }

  // この的のヒットボックスか（命中判定用）。
  owns(obj: THREE.Object3D): boolean {
    return obj === this.unit.hitbox || obj === this.unit.headHitbox;
  }

  isHead(obj: THREE.Object3D): boolean {
    return obj === this.unit.headHitbox;
  }

  // 被弾。HPを減らし、0以下で一定時間後に全回復する。
  takeHit(dmg: number, now: number): void {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) {
      this.dead = true;
      this.refillAt = now + 0.8;
    }
  }

  update(dt: number, now: number, colliders: THREE.Box3[], camera: THREE.Camera): void {
    if (this.dead) {
      if (now >= this.refillAt) {
        this.hp = this.maxHp;
        this.dead = false;
      }
    } else if (this.kind === "patrol") {
      const tx = this.originX + this.dir * this.range;
      this.unit.moveToward(tx, this.originZ, this.speed, dt, colliders);
      if (Math.abs(this.unit.group.position.x - tx) < 0.3) this.dir *= -1;
      this.unit.faceTo(this.dir, 0);
      this.unit.update(dt, "walk");
    } else if (this.kind === "random") {
      if (now >= this.repickAt || this.distToTarget() < 0.6) {
        const a = (now * 1000) % (Math.PI * 2);
        const rad = 2 + (Math.sin(now * 7.3) * 0.5 + 0.5) * this.range;
        this.tx = this.originX + Math.cos(a) * rad;
        this.tz = this.originZ + Math.sin(a) * rad;
        this.repickAt = now + 1.5;
      }
      const dx = this.tx - this.unit.group.position.x;
      const dz = this.tz - this.unit.group.position.z;
      this.unit.moveToward(this.tx, this.tz, this.speed, dt, colliders);
      this.unit.faceTo(dx, dz);
      this.unit.update(dt, "walk");
    } else {
      this.unit.update(dt, "idle");
    }

    this.updateBar(camera);
  }

  private distToTarget(): number {
    const dx = this.tx - this.unit.group.position.x;
    const dz = this.tz - this.unit.group.position.z;
    return Math.hypot(dx, dz);
  }

  private updateBar(camera: THREE.Camera): void {
    const p = this.unit.group.position;
    this.barGroup.position.set(p.x, p.y + 2.3, p.z);
    this.barGroup.quaternion.copy(camera.quaternion); // ビルボード
    const ratio = this.hp / this.maxHp;
    this.barFill.scale.x = Math.max(0.0001, ratio);
    this.barFill.position.x = -(this.barW * (1 - ratio)) / 2;
    // 緑→赤へ
    this.barFillMat.color.setRGB(1 - ratio * 0.6, 0.3 + ratio * 0.55, 0.25 * ratio);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.unit.group);
    this.unit.dispose();
    scene.remove(this.barGroup);
    this.barGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && typeof mat.dispose === "function") mat.dispose();
    });
  }
}
