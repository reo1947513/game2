import * as THREE from "three";
import { EnemyUnit } from "../../Enemy";
import { DevCtx } from "../devTypes";
import { GalleryTarget } from "./GalleryTarget";
import { GALLERY } from "./ShootingGallery";
import { FeedbackZone, HitFeedback } from "./HitFeedback";
import { AccuracyTracker } from "./AccuracyTracker";
import { ImpactPattern } from "./ImpactPattern";

interface TrainEnemy {
  unit: EnemyUnit;
  hp: number;
  dead: boolean;
  respawnAt: number;
  phase: number;
}

// SHOOTING GALLERY の的・訓練敵を管理する（生成・更新・命中・撤去）。
// enemyTargets への登録と命中応答に加え、ステージ2の着弾可視化（マーカー/弾痕/部位）・
// 命中精度パネル・2D着弾分布を devShotHook 経由でまとめて駆動する。
export class GalleryManager {
  private targets: GalleryTarget[] = [];
  private enemies: TrainEnemy[] = [];

  private feedback: HitFeedback;
  private accuracy: AccuracyTracker;
  private pattern: ImpactPattern;

  constructor(private ctx: DevCtx) {
    this.feedback = new HitFeedback(this.ctx.scene, this.ctx.camera);
    this.accuracy = new AccuracyTracker();
    this.pattern = new ImpactPattern();
  }

  // 命中フック・射撃フックを結線し、統計パネルを表示（射撃場入場時）。
  enable(): void {
    this.ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg);
    this.ctx.weapons.devShotHook = (shots) => this.onShots(shots);
    this.feedback.clearWorld();
    this.accuracy.reset();
    this.pattern.clear();
    this.accuracy.show();
    this.pattern.show();
  }

  // フック解除・統計パネル非表示・演出撤去（射撃場から出る/DEV RANGE終了時）。
  disable(): void {
    this.clear();
    this.ctx.weapons.enemyHitHook = null;
    this.ctx.weapons.devShotHook = null;
    this.accuracy.hide();
    this.pattern.hide();
  }

  // ===== 着弾フィードバック・統計（devShotHook：1射ごとに全ペレット分）=====
  private onShots(
    shots: Array<{ object: THREE.Object3D | null; point: THREE.Vector3 | null; origin: THREE.Vector3 }>
  ): void {
    const entries: Array<{ zone: FeedbackZone }> = [];
    for (const s of shots) {
      let zone: FeedbackZone = "miss";
      let center: THREE.Vector3 | null = null;

      if (s.object && s.point) {
        const t = this.targets.find((x) => x.owns(s.object!));
        if (t && t.hittable()) {
          zone = t.classify(s.point).zone;
          center = t.group.position;
        } else {
          const e = this.enemies.find(
            (x) => !x.dead && (x.unit.hitbox === s.object || x.unit.headHitbox === s.object)
          );
          if (e) {
            zone = e.unit.headHitbox === s.object ? "head" : "body";
            center = e.unit.group.position;
          }
        }
      }

      if (s.point) this.feedback.addImpact(s.point, s.origin, zone);
      if (s.point && center) this.pattern.add(s.point.x - center.x, s.point.y - center.y, zone);
      entries.push({ zone });
    }
    this.accuracy.register(entries);
  }

  // ===== 配置 =====
  spawnStaticSet(): void {
    for (const d of GALLERY.distances) {
      this.addTarget(new GalleryTarget(this.ctx.scene, "static", GALLERY.laneX.left, GALLERY.zForDist(d)));
    }
  }
  spawnPatrol(speed: number): void {
    this.addTarget(
      new GalleryTarget(this.ctx.scene, "patrol", GALLERY.laneX.center, GALLERY.zForDist(20), { speed })
    );
  }
  spawnPendulum(): void {
    this.addTarget(new GalleryTarget(this.ctx.scene, "pendulum", GALLERY.laneX.center, GALLERY.zForDist(15)));
  }
  spawnPopup(interval: number): void {
    this.addTarget(new GalleryTarget(this.ctx.scene, "popup", GALLERY.laneX.center, GALLERY.zForDist(12), { interval }));
  }
  spawnEnemies(n: number): void {
    for (let i = 0; i < n; i++) {
      const unit = new EnemyUnit({ scale: 1.0, bodyColor: 0x23262e, accentColor: 0xff6a00 });
      const x = GALLERY.laneX.right + (i - n / 2) * 1.6;
      unit.setGround(x, GALLERY.zForDist(60));
      this.ctx.scene.add(unit.group);
      this.ctx.weapons.enemyTargets.push(unit.hitbox);
      this.ctx.weapons.enemyTargets.push(unit.headHitbox);
      this.enemies.push({ unit, hp: 100, dead: false, respawnAt: 0, phase: i * 1.3 });
    }
  }

  // プリセット
  presetAccuracy(): void {
    this.clear();
    this.spawnStaticSet();
  }
  presetTracking(): void {
    this.clear();
    for (let i = 0; i < 5; i++)
      this.addTarget(
        new GalleryTarget(this.ctx.scene, "patrol", GALLERY.laneX.center + (i - 2) * 0.1, GALLERY.zForDist(15 + i * 8), {
          speed: 7,
        })
      );
  }
  presetCombat(): void {
    this.clear();
    this.spawnEnemies(5);
  }

  private addTarget(t: GalleryTarget): void {
    this.ctx.scene && this.ctx.weapons.enemyTargets.push(t.hitMesh);
    this.targets.push(t);
  }

  // ===== 命中（基本応答。スコア/フィードバックはステージ2で devShotHook 経由）=====
  private onHit(obj: THREE.Object3D, dmg: number): void {
    const t = this.targets.find((x) => x.owns(obj));
    if (t) {
      if (!t.hittable()) return;
      return; // 静止/移動的は基本応答なし（撃ち続けて確認）
    }
    const e = this.enemies.find((x) => x.unit.hitbox === obj || x.unit.headHitbox === obj);
    if (e && !e.dead) {
      e.hp -= dmg;
      if (e.hp <= 0) {
        e.dead = true;
        e.respawnAt = performance.now() / 1000 + 2;
        e.unit.group.visible = false;
      }
    }
  }

  // ===== 毎フレーム更新 =====
  update(dt: number, now: number): void {
    this.feedback.update(now);
    for (const t of this.targets) t.update(dt, now);

    const p = this.ctx.player.position;
    const colliders = this.ctx.stage.colliders;
    for (const e of this.enemies) {
      if (e.dead) {
        if (now >= e.respawnAt) {
          e.hp = 100;
          e.dead = false;
          e.unit.setGround(GALLERY.laneX.right, GALLERY.zForDist(60));
          e.unit.group.visible = true;
        }
        continue;
      }
      const dx = p.x - e.unit.group.position.x;
      const dz = p.z - e.unit.group.position.z;
      const dist = Math.hypot(dx, dz);
      const zig = Math.sin(now * 2 + e.phase) * 4; // ジグザグ
      if (dist > 10) {
        e.unit.moveToward(p.x + zig, p.z + 9, 3.5, dt, colliders); // プレイヤー手前9mを目標に接近
      } else {
        e.unit.moveToward(e.unit.group.position.x + zig * dt, e.unit.group.position.z, 2.5, dt, colliders); // 近距離は横移動
      }
      e.unit.faceTo(dx, dz);
      e.unit.update(dt, "walk");
    }
  }

  clear(): void {
    this.feedback.clearWorld();
    for (const t of this.targets) {
      this.removeTarget(t.hitMesh);
      t.dispose(this.ctx.scene);
    }
    this.targets = [];
    for (const e of this.enemies) {
      this.removeTarget(e.unit.hitbox);
      this.removeTarget(e.unit.headHitbox);
      this.ctx.scene.remove(e.unit.group);
      e.unit.dispose();
    }
    this.enemies = [];
  }

  private removeTarget(obj: THREE.Object3D): void {
    const arr = this.ctx.weapons.enemyTargets;
    const i = arr.indexOf(obj);
    if (i >= 0) arr.splice(i, 1);
  }
}
