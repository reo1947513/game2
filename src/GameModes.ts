import * as THREE from "three";
import { Stage, Target } from "./Stage";
import { WeaponSystem } from "./WeaponSystem";
import { ModeUI } from "./ModeUI";
import { PlayerController } from "./PlayerController";
import { Health } from "./Health";
import { EnemyUnit } from "./Enemy";

// 各モードがゲームの中身へ触るための入口をまとめたものです。
export interface GameContext {
  scene: THREE.Scene;
  stage: Stage;
  weapons: WeaponSystem;
  ui: ModeUI;
  player: PlayerController;
  health: Health;
  // モードが「終了」を伝えるときに呼ぶ。結果の行を渡す。
  finish: (lines: string[]) => void;
}

// 1つの遊び方（モード）の共通の形です。
export interface GameMode {
  id: string;
  label: string;
  description: string;
  enter(ctx: GameContext, now: number): void;
  update(ctx: GameContext, dt: number, now: number): void;
  exit(ctx: GameContext): void;
}

// モードの一覧管理と、現在のモードの開始・更新・終了をまとめます。
export class ModeManager {
  private current: GameMode | null = null;

  constructor(private modes: GameMode[]) {}

  list(): GameMode[] {
    return this.modes;
  }

  get(id: string): GameMode | undefined {
    return this.modes.find((m) => m.id === id);
  }

  start(id: string, ctx: GameContext, now: number): void {
    this.stop(ctx);
    const m = this.get(id);
    if (!m) return;
    this.current = m;
    m.enter(ctx, now);
  }

  update(ctx: GameContext, dt: number, now: number): void {
    if (this.current) this.current.update(ctx, dt, now);
  }

  stop(ctx: GameContext): void {
    if (this.current) {
      this.current.exit(ctx);
      this.current = null;
    }
  }

  hasCurrent(): boolean {
    return this.current !== null;
  }
}

// 的を初期状態（生存・表示・色）に戻す共通処理
function resetTargets(stage: Stage): void {
  for (const t of stage.targets) {
    t.alive = true;
    t.mesh.visible = true;
    t.respawnAt = 0;
    t.userHits = 0;
    const m = t.mesh.material as THREE.MeshStandardMaterial;
    m.color.copy(t.baseColor);
    m.emissive.set(0x551a10);
  }
}

// ===== モード1：ターゲットラッシュ（制限時間内にできるだけ多く撃つ） =====
export class TargetRush implements GameMode {
  id = "rush";
  label = "ターゲットラッシュ";
  description = "制限時間内に的をできるだけ多く撃つ。スコアと命中率を計測します。";

  private readonly duration = 45;
  private endTime = 0;
  private score = 0;
  private fired = 0;
  private hits = 0;
  private finished = false;

  enter(ctx: GameContext, now: number): void {
    this.score = 0;
    this.fired = 0;
    this.hits = 0;
    this.finished = false;
    this.endTime = now + this.duration;
    resetTargets(ctx.stage);

    // 発砲のたびに発射数を数える
    ctx.weapons.shotFiredHook = () => {
      this.fired++;
    };
    // 的に当たったら加点し、すぐ倒して短時間で復活させる
    ctx.weapons.targetHitHook = (t: Target, n: number) => {
      this.score++;
      this.hits++;
      t.alive = false;
      t.mesh.visible = false;
      t.respawnAt = n + 0.8;
      return true;
    };

    ctx.ui.showHud(true);
  }

  update(ctx: GameContext, _dt: number, now: number): void {
    if (this.finished) return;
    const remain = Math.max(0, this.endTime - now);
    const acc = this.fired > 0 ? Math.round((this.hits / this.fired) * 100) : 0;
    ctx.ui.setHud([`残り ${remain.toFixed(1)} 秒`, `スコア ${this.score}`, `命中率 ${acc}%`]);
    if (remain <= 0) {
      this.finished = true;
      ctx.finish(["ターゲットラッシュ 結果", `撃破数 ${this.score}`, `命中率 ${acc}%`]);
    }
  }

  exit(ctx: GameContext): void {
    ctx.weapons.shotFiredHook = null;
    ctx.weapons.targetHitHook = null;
    ctx.ui.showHud(false);
  }
}

// ===== モード2：動く的の射撃場（左右や前後に動く的を狙う） =====
interface Motion {
  origin: THREE.Vector3;
  axis: "x" | "z";
  range: number;
  speed: number;
  phase: number;
}

export class MovingRange implements GameMode {
  id = "moving";
  label = "動く的の射撃場";
  description = "左右・前後に動く的を狙い撃つ。スナイパーでの偏差撃ちの練習に。";

  private readonly duration = 45;
  private endTime = 0;
  private score = 0;
  private fired = 0;
  private hits = 0;
  private finished = false;
  private motions = new Map<Target, Motion>();

  enter(ctx: GameContext, now: number): void {
    this.score = 0;
    this.fired = 0;
    this.hits = 0;
    this.finished = false;
    this.endTime = now + this.duration;
    this.motions.clear();
    resetTargets(ctx.stage);

    ctx.stage.targets.forEach((t, i) => {
      this.motions.set(t, {
        origin: t.mesh.position.clone(),
        axis: i % 2 === 0 ? "x" : "z",
        range: 3 + (i % 3),
        speed: 0.8 + (i % 3) * 0.35,
        phase: i,
      });
    });

    ctx.weapons.shotFiredHook = () => {
      this.fired++;
    };
    ctx.weapons.targetHitHook = (t: Target, n: number) => {
      this.score++;
      this.hits++;
      t.alive = false;
      t.mesh.visible = false;
      t.respawnAt = n + 0.8;
      return true;
    };

    ctx.ui.showHud(true);
  }

  update(ctx: GameContext, _dt: number, now: number): void {
    if (this.finished) return;

    // 生きている的を経路に沿って動かす（当たり判定の箱も更新）
    for (const t of ctx.stage.targets) {
      if (!t.alive) continue;
      const mo = this.motions.get(t);
      if (!mo) continue;
      const off = Math.sin(now * mo.speed + mo.phase) * mo.range;
      if (mo.axis === "x") t.mesh.position.x = mo.origin.x + off;
      else t.mesh.position.z = mo.origin.z + off;
      t.box.setFromObject(t.mesh);
    }

    const remain = Math.max(0, this.endTime - now);
    const acc = this.fired > 0 ? Math.round((this.hits / this.fired) * 100) : 0;
    ctx.ui.setHud([`残り ${remain.toFixed(1)} 秒`, `スコア ${this.score}`, `命中率 ${acc}%`]);
    if (remain <= 0) {
      this.finished = true;
      ctx.finish(["動く的の射撃場 結果", `撃破数 ${this.score}`, `命中率 ${acc}%`]);
    }
  }

  exit(ctx: GameContext): void {
    // 的の位置を元に戻す
    for (const [t, mo] of this.motions) {
      t.mesh.position.copy(mo.origin);
      t.box.setFromObject(t.mesh);
    }
    this.motions.clear();
    ctx.weapons.shotFiredHook = null;
    ctx.weapons.targetHitHook = null;
    ctx.ui.showHud(false);
  }
}

// ===== モード3：パルクール・タイムトライアル =====
// 専用の足場とチェックポイントを生成し、順に巡ってゴールまでのタイムを計る。
// 射撃は使わず、移動（ジャンプ・2段・壁ジャンプ・スライド）が主役。
export class Parkour implements GameMode {
  id = "parkour";
  label = "パルクール・タイムトライアル";
  description = "足場を飛び移りチェックポイントを最短で巡る。移動操作が主役。";

  private platforms: { mesh: THREE.Mesh; box: THREE.Box3 }[] = [];
  private points: { pos: THREE.Vector3; mesh: THREE.Mesh }[] = [];
  private index = 0;
  private startTime = 0;
  private finished = false;
  private eye = new THREE.Vector3();

  // 足場の中心位置（x, y, z）。ジャンプで届く間隔・高さに並べてある。
  private readonly spots: Array<[number, number, number]> = [
    [5, 1.2, -6],
    [10, 2.6, -12],
    [4, 4.2, -17],
    [-3, 5.6, -13],
    [-9, 7.0, -5],
  ];

  enter(ctx: GameContext, now: number): void {
    this.index = 0;
    this.finished = false;
    this.startTime = now;
    this.platforms = [];
    this.points = [];

    for (const [x, y, z] of this.spots) {
      // 足場（当たり判定つき）
      const pgeo = new THREE.BoxGeometry(3, 0.5, 3);
      const pmat = new THREE.MeshStandardMaterial({
        color: 0x3a4a59,
        roughness: 0.8,
        metalness: 0.1,
      });
      const pmesh = new THREE.Mesh(pgeo, pmat);
      pmesh.position.set(x, y, z);
      pmesh.castShadow = true;
      pmesh.receiveShadow = true;
      ctx.scene.add(pmesh);
      const box = new THREE.Box3().setFromObject(pmesh);
      ctx.stage.colliders.push(box);
      this.platforms.push({ mesh: pmesh, box });

      // チェックポイント（足場の上に立つ光る輪）
      const cgeo = new THREE.CylinderGeometry(1.0, 1.0, 2.4, 16, 1, true);
      const cmat = new THREE.MeshStandardMaterial({
        color: 0xffc24a,
        emissive: 0x332000,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const cmesh = new THREE.Mesh(cgeo, cmat);
      cmesh.position.set(x, y + 1.6, z);
      ctx.scene.add(cmesh);
      this.points.push({ pos: new THREE.Vector3(x, y + 1.6, z), mesh: cmesh });
    }

    this.highlight();
    ctx.ui.showHud(true);
  }

  // 現在のチェックポイントを明るく、通過済みを薄く、未到達を中間の明るさにする
  private highlight(): void {
    this.points.forEach((p, i) => {
      const m = p.mesh.material as THREE.MeshStandardMaterial;
      if (i === this.index) {
        m.emissive.set(0xffaa30);
        m.opacity = 0.85;
      } else if (i < this.index) {
        m.emissive.set(0x000000);
        m.opacity = 0.1;
      } else {
        m.emissive.set(0x332000);
        m.opacity = 0.35;
      }
    });
  }

  update(ctx: GameContext, dt: number, now: number): void {
    if (this.finished) return;
    ctx.player.getEyePosition(this.eye);

    const cur = this.points[this.index];
    cur.mesh.rotation.y += dt * 1.5;

    const dx = this.eye.x - cur.pos.x;
    const dz = this.eye.z - cur.pos.z;
    const dy = this.eye.y - cur.pos.y;
    if (Math.hypot(dx, dz) < 2.5 && Math.abs(dy) < 3.0) {
      this.index++;
      if (this.index >= this.points.length) {
        this.finished = true;
        const t = now - this.startTime;
        ctx.finish([
          "パルクール 結果",
          `タイム ${t.toFixed(2)} 秒`,
          `チェックポイント ${this.points.length}/${this.points.length}`,
        ]);
        return;
      }
      this.highlight();
    }

    const elapsed = now - this.startTime;
    ctx.ui.setHud([
      `タイム ${elapsed.toFixed(1)} 秒`,
      `チェックポイント ${this.index}/${this.points.length}`,
    ]);
  }

  exit(ctx: GameContext): void {
    // 足場（メッシュと当たり判定）を撤去する
    for (const p of this.platforms) {
      ctx.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
      const i = ctx.stage.colliders.indexOf(p.box);
      if (i >= 0) ctx.stage.colliders.splice(i, 1);
    }
    // チェックポイントを撤去する
    for (const c of this.points) {
      ctx.scene.remove(c.mesh);
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
    }
    this.platforms = [];
    this.points = [];
    ctx.ui.showHud(false);
  }
}

// ===== モード4：ウェーブ・サバイバル =====
// ウェーブに出る敵の種類。大きさ・色・速さ・体力・行動を変えて差別化する。
type EnemyBehavior = "melee" | "ranged" | "bomber";
interface WaveEnemyType {
  scale: number;
  bodyColor: number;
  accentColor: number;
  speedMul: number;
  hp: number;
  behavior: EnemyBehavior;
  shielded: boolean;
}
// 生成後の敵1体ぶんのデータ
type WaveEnemy = {
  unit: EnemyUnit;
  hp: number;
  speed: number;
  behavior: EnemyBehavior;
  shielded: boolean;
  nextShot: number; // 遠距離型が次に撃てる時刻
};
// 標準：バランス型（オレンジ）
const WAVE_STANDARD: WaveEnemyType = {
  scale: 1,
  bodyColor: 0x23262e,
  accentColor: 0xff6a00,
  speedMul: 1,
  hp: 40,
  behavior: "melee",
  shielded: false,
};
// 突撃：小さく速く脆い（赤ピンク）
const WAVE_RUSHER: WaveEnemyType = {
  scale: 0.8,
  bodyColor: 0x3a1530,
  accentColor: 0xff2a6a,
  speedMul: 1.7,
  hp: 20,
  behavior: "melee",
  shielded: false,
};
// 重装：大きく遅く硬い（青）
const WAVE_TANK: WaveEnemyType = {
  scale: 1.35,
  bodyColor: 0x1a1d22,
  accentColor: 0x36c0ff,
  speedMul: 0.55,
  hp: 120,
  behavior: "melee",
  shielded: false,
};
// 遠距離：近づかず中距離から撃つ（紫）
const WAVE_SHOOTER: WaveEnemyType = {
  scale: 1,
  bodyColor: 0x2a1d3a,
  accentColor: 0xb070ff,
  speedMul: 0.9,
  hp: 40,
  behavior: "ranged",
  shielded: false,
};
// 自爆：接近して自爆し、大ダメージを与えて消える（黄）
const WAVE_BOMBER: WaveEnemyType = {
  scale: 0.95,
  bodyColor: 0x2e2a12,
  accentColor: 0xffd23a,
  speedMul: 1.5,
  hp: 20,
  behavior: "bomber",
  shielded: false,
};
// 盾：正面の胴が硬く、頭が弱点（黄緑）
const WAVE_SHIELD: WaveEnemyType = {
  scale: 1.1,
  bodyColor: 0x20242a,
  accentColor: 0xc9d24a,
  speedMul: 0.7,
  hp: 50,
  behavior: "melee",
  shielded: true,
};

// 四方から迫る敵を撃って倒し、波をしのいで生き延びる。
// 敵に触れられると体力が減り、0になると終了。波が進むほど数と速さが増す。
export class WaveSurvival implements GameMode {
  id = "wave";
  label = "ウェーブ・サバイバル";
  description = "四方から迫る敵を撃ち、波をしのいで生き延びる。被弾で体力が減る。";

  private ctx: GameContext | null = null;
  private enemies: WaveEnemy[] = [];
  private wave = 0;
  private kills = 0;
  private alive = false;
  private eye = new THREE.Vector3();
  private nextContactTime = 0; // 接触ダメージの間隔管理（秒）

  enter(ctx: GameContext, now: number): void {
    this.ctx = ctx;
    this.enemies = [];
    this.wave = 0;
    this.kills = 0;
    this.alive = true;
    this.nextContactTime = now;

    ctx.health.reset(100);
    ctx.health.show();
    ctx.ui.showHud(true);

    // 射撃が敵に当たったときの処理を登録する（武器の威力を受け取る）
    ctx.weapons.enemyHitHook = (obj: THREE.Object3D, damage: number) =>
      this.onEnemyShot(obj, damage);

    this.startWave();
  }

  // 次の波を出す。波が進むほど数も速さも増える。
  private startWave(): void {
    if (!this.ctx) return;
    this.wave++;
    const count = 2 + this.wave;
    const speed = 1.6 + this.wave * 0.25;

    this.ctx.player.getEyePosition(this.eye);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 4;
      const x = this.eye.x + Math.cos(angle) * dist;
      const z = this.eye.z + Math.sin(angle) * dist;

      const type = this.pickType();
      const unit = new EnemyUnit({
        scale: type.scale,
        bodyColor: type.bodyColor,
        accentColor: type.accentColor,
      });
      // ステージの外へ出ないよう、おおまかに範囲内へ収める
      unit.setGround(
        Math.max(-28, Math.min(28, x)),
        Math.max(-28, Math.min(28, z))
      );
      this.ctx.scene.add(unit.group);
      this.ctx.weapons.enemyTargets.push(unit.hitbox);
      this.ctx.weapons.enemyTargets.push(unit.headHitbox);
      this.enemies.push({
        unit,
        hp: type.hp,
        speed: speed * type.speedMul,
        behavior: type.behavior,
        shielded: type.shielded,
        nextShot: performance.now() / 1000 + 1 + Math.random() * 1.5,
      });
    }
    this.updateHud();
  }

  // 波に応じて敵の種類を選ぶ。波が進むほど多彩になる。
  private pickType(): WaveEnemyType {
    const w = this.wave;
    const r = Math.random();
    if (w >= 5 && r < 0.15) return WAVE_BOMBER;
    if (w >= 4 && r < 0.3) return WAVE_SHOOTER;
    if (w >= 4 && r < 0.4) return WAVE_SHIELD;
    if (w >= 3 && r < 0.55) return WAVE_TANK;
    if (r < 0.75) return WAVE_RUSHER;
    return WAVE_STANDARD;
  }

  // 弾が敵に当たったとき
  private onEnemyShot(obj: THREE.Object3D, damage: number): void {
    const e = this.enemies.find(
      (x) => x.unit.hitbox === obj || x.unit.headHitbox === obj
    );
    if (!e) return;
    let dmg = damage;
    // 盾型は正面の胴が硬い。胴へのダメージは大きく減り、頭が弱点になる。
    if (e.shielded && obj === e.unit.hitbox) dmg *= 0.25;
    e.hp -= dmg;
    if (e.hp <= 0) this.removeEnemy(e, true);
  }

  // 敵を1体取り除く。killed=true なら撃破数を増やす。
  private removeEnemy(e: WaveEnemy, killed: boolean): void {
    if (!this.ctx) return;
    this.ctx.scene.remove(e.unit.group);
    e.unit.dispose();
    const ti = this.ctx.weapons.enemyTargets.indexOf(e.unit.hitbox);
    if (ti >= 0) this.ctx.weapons.enemyTargets.splice(ti, 1);
    const hi = this.ctx.weapons.enemyTargets.indexOf(e.unit.headHitbox);
    if (hi >= 0) this.ctx.weapons.enemyTargets.splice(hi, 1);
    const ei = this.enemies.indexOf(e);
    if (ei >= 0) this.enemies.splice(ei, 1);
    if (killed) {
      this.kills++;
      this.updateHud();
    }
  }

  update(ctx: GameContext, dt: number, now: number): void {
    if (!this.alive) return;
    ctx.player.getEyePosition(this.eye);

    let contacting = false;
    let playerDamaged = false;

    // 撤去が起きても安全なよう、後ろから回す
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = this.eye.x - e.unit.group.position.x;
      const dz = this.eye.z - e.unit.group.position.z;
      const d = Math.hypot(dx, dz);
      e.unit.faceTo(dx, dz);

      if (e.behavior === "ranged") {
        // 遠距離：中距離まで来たら止まって撃つ
        if (d > 9) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, ctx.stage.colliders);
          e.unit.update(dt, "walk");
        } else {
          e.unit.update(dt, "attack");
          if (now >= e.nextShot) {
            e.nextShot = now + 1.5 + Math.random() * 0.8;
            const hitChance = Math.max(0.15, Math.min(0.5, 0.55 - d * 0.03));
            if (Math.random() < hitChance) {
              ctx.health.damage(8);
              playerDamaged = true;
            }
          }
        }
      } else if (e.behavior === "bomber") {
        // 自爆：接近して自爆し、大ダメージを与えて消える（撃破ではない）
        if (d > 1.2) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, ctx.stage.colliders);
          e.unit.update(dt, "walk");
        } else {
          ctx.health.damage(35);
          playerDamaged = true;
          this.removeEnemy(e, false);
        }
      } else {
        // 近接：間合いまで近づいて殴る（標準・突撃・重装・盾）
        if (d > 1.3) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, ctx.stage.colliders);
          e.unit.update(dt, "walk");
        } else {
          e.unit.update(dt, "attack");
          contacting = true;
        }
      }
    }

    // 近接で接触している敵がいれば、一定間隔で体力を減らす
    if (contacting && now >= this.nextContactTime) {
      ctx.health.damage(12);
      this.nextContactTime = now + 0.8;
      playerDamaged = true;
    }

    // どの攻撃でも、被弾の結果として体力が尽きたら終了
    if (playerDamaged && ctx.health.isDead()) {
      this.gameOver(ctx);
      return;
    }

    // 敵を全部倒したら次の波へ
    if (this.enemies.length === 0) {
      this.startWave();
    }

    this.updateHud();
  }

  private updateHud(): void {
    if (!this.ctx) return;
    this.ctx.ui.setHud([
      `ウェーブ ${this.wave}`,
      `撃破 ${this.kills}`,
      `残り ${this.enemies.length}`,
    ]);
  }

  private gameOver(ctx: GameContext): void {
    this.alive = false;
    ctx.finish([
      "ウェーブ・サバイバル 結果",
      `到達ウェーブ ${this.wave}`,
      `撃破数 ${this.kills}`,
    ]);
  }

  exit(ctx: GameContext): void {
    // 敵をすべて撤去し、射撃側の登録も元へ戻す
    for (const e of this.enemies) {
      ctx.scene.remove(e.unit.group);
      e.unit.dispose();
      const ti = ctx.weapons.enemyTargets.indexOf(e.unit.hitbox);
      if (ti >= 0) ctx.weapons.enemyTargets.splice(ti, 1);
      const hi = ctx.weapons.enemyTargets.indexOf(e.unit.headHitbox);
      if (hi >= 0) ctx.weapons.enemyTargets.splice(hi, 1);
    }
    this.enemies = [];
    ctx.weapons.enemyHitHook = null;
    ctx.health.hide();
    ctx.ui.showHud(false);
    this.ctx = null;
  }
}

// ===== モード5：ボット・デスマッチ =====
// 撃ち返してくるボットと戦い、制限時間内のキル数を競う。
// ボットは常に一定数いて、倒すと少し後に別の位置で復活する。
// プレイヤーは体力が0になるとデスが付き、数秒後に初期位置で復活する。
export class BotDeathmatch implements GameMode {
  id = "botdm";
  label = "ボット・デスマッチ";
  description = "撃ち返すボットと戦い、制限時間内のキル数を競う。やられても復活する。";

  private ctx: GameContext | null = null;
  private bots: { unit: EnemyUnit; hp: number; nextShot: number }[] = [];
  private respawnQueue: number[] = []; // ボットを補充する時刻のリスト
  private kills = 0;
  private deaths = 0;
  private endTime = 0;
  private alive = false;
  private playerDead = false;
  private playerRespawnAt = 0;
  private eye = new THREE.Vector3();

  private readonly BOT_COUNT = 3;
  private readonly DURATION = 120; // 制限時間（秒）
  private readonly BOT_HP = 60;
  private readonly BOT_SPEED = 2.2;

  enter(ctx: GameContext, now: number): void {
    this.ctx = ctx;
    this.bots = [];
    this.respawnQueue = [];
    this.kills = 0;
    this.deaths = 0;
    this.alive = true;
    this.playerDead = false;
    this.playerRespawnAt = 0;
    this.endTime = now + this.DURATION;

    ctx.health.reset(100);
    ctx.health.show();
    ctx.ui.showHud(true);
    ctx.player.respawn(0, 0, 8); // 初期位置から開始

    ctx.weapons.enemyHitHook = (obj: THREE.Object3D, damage: number) =>
      this.onBotShot(obj, damage);

    for (let i = 0; i < this.BOT_COUNT; i++) this.spawnBot(now);
    this.updateHud(now);
  }

  // ボットを1体、プレイヤーから離れた位置に出す
  private spawnBot(now: number): void {
    if (!this.ctx) return;
    this.ctx.player.getEyePosition(this.eye);
    const angle = Math.random() * Math.PI * 2;
    const dist = 15 + Math.random() * 10;
    const x = Math.max(-28, Math.min(28, this.eye.x + Math.cos(angle) * dist));
    const z = Math.max(-28, Math.min(28, this.eye.z + Math.sin(angle) * dist));

    const unit = new EnemyUnit();
    unit.setGround(x, z);
    this.ctx.scene.add(unit.group);
    this.ctx.weapons.enemyTargets.push(unit.hitbox);
    this.ctx.weapons.enemyTargets.push(unit.headHitbox);
    this.bots.push({
      unit,
      hp: this.BOT_HP,
      nextShot: now + 1 + Math.random() * 1.5,
    });
  }

  // 弾がボットに当たったとき。武器の威力ぶん体力を削る。
  private onBotShot(obj: THREE.Object3D, damage: number): void {
    const now = performance.now() / 1000;
    const b = this.bots.find(
      (x) => x.unit.hitbox === obj || x.unit.headHitbox === obj
    );
    if (!b) return;
    b.hp -= damage;
    if (b.hp <= 0) this.killBot(b, now);
  }

  // ボットを倒す。撤去して撃破数を増やし、補充を予約する。
  private killBot(
    b: { unit: EnemyUnit; hp: number; nextShot: number },
    now: number
  ): void {
    if (!this.ctx) return;
    this.ctx.scene.remove(b.unit.group);
    b.unit.dispose();
    const ti = this.ctx.weapons.enemyTargets.indexOf(b.unit.hitbox);
    if (ti >= 0) this.ctx.weapons.enemyTargets.splice(ti, 1);
    const hi = this.ctx.weapons.enemyTargets.indexOf(b.unit.headHitbox);
    if (hi >= 0) this.ctx.weapons.enemyTargets.splice(hi, 1);
    const bi = this.bots.indexOf(b);
    if (bi >= 0) this.bots.splice(bi, 1);
    this.kills++;
    this.respawnQueue.push(now + 3); // 3秒後に補充
  }

  update(ctx: GameContext, dt: number, now: number): void {
    if (!this.alive) return;

    // 制限時間
    if (now >= this.endTime) {
      this.finishMatch(ctx);
      return;
    }

    // プレイヤーの復活
    if (this.playerDead && now >= this.playerRespawnAt) {
      ctx.player.respawn(0, 0, 8);
      ctx.health.reset(100);
      this.playerDead = false;
    }

    ctx.player.getEyePosition(this.eye);

    for (const b of this.bots) {
      const dx = this.eye.x - b.unit.group.position.x;
      const dz = this.eye.z - b.unit.group.position.z;
      const d = Math.hypot(dx, dz);
      b.unit.faceTo(dx, dz);

      if (d > 8) {
        // 遠い：壁やブロックを避けて歩いて近づく
        b.unit.moveToward(this.eye.x, this.eye.z, this.BOT_SPEED, dt, ctx.stage.colliders);
        b.unit.update(dt, "walk");
      } else {
        // 射程内：止まって撃つ
        b.unit.update(dt, "attack");
        if (!this.playerDead && now >= b.nextShot) {
          b.nextShot = now + 1.2 + Math.random() * 0.8;
          // 近いほど当たりやすい
          const hitChance = Math.max(0.12, Math.min(0.5, 0.55 - d * 0.03));
          if (Math.random() < hitChance) {
            ctx.health.damage(10);
            if (ctx.health.isDead() && !this.playerDead) {
              this.deaths++;
              this.playerDead = true;
              this.playerRespawnAt = now + 3;
            }
          }
        }
      }
    }

    // 補充の時刻が来たボットを出す
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      if (now >= this.respawnQueue[i]) {
        this.respawnQueue.splice(i, 1);
        this.spawnBot(now);
      }
    }

    this.updateHud(now);
  }

  private updateHud(now: number): void {
    if (!this.ctx) return;
    const remain = Math.max(0, Math.ceil(this.endTime - now));
    const lines = [
      `残り ${remain} 秒`,
      `キル ${this.kills}`,
      `デス ${this.deaths}`,
    ];
    if (this.playerDead) {
      lines.push(`復活まで ${Math.max(0, Math.ceil(this.playerRespawnAt - now))} 秒`);
    }
    this.ctx.ui.setHud(lines);
  }

  private finishMatch(ctx: GameContext): void {
    this.alive = false;
    ctx.finish([
      "ボット・デスマッチ 結果",
      `キル ${this.kills}`,
      `デス ${this.deaths}`,
    ]);
  }

  exit(ctx: GameContext): void {
    for (const b of this.bots) {
      ctx.scene.remove(b.unit.group);
      b.unit.dispose();
      const ti = ctx.weapons.enemyTargets.indexOf(b.unit.hitbox);
      if (ti >= 0) ctx.weapons.enemyTargets.splice(ti, 1);
      const hi = ctx.weapons.enemyTargets.indexOf(b.unit.headHitbox);
      if (hi >= 0) ctx.weapons.enemyTargets.splice(hi, 1);
    }
    this.bots = [];
    this.respawnQueue = [];
    ctx.weapons.enemyHitHook = null;
    ctx.health.hide();
    ctx.ui.showHud(false);
    this.ctx = null;
  }
}
