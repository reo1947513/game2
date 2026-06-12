import * as THREE from "three";
import {
  GameMode,
  GameContext,
  makeMeleeTargets,
  resolveBodyCollisions,
} from "../GameModes";
import { EnemyUnit } from "../Enemy";
import { MeleeTarget, MeleeTargetProvider } from "../combat/MeleeTarget";
import { ModeHUD } from "../ui/ModeHUD";

// ===== TOWER（100層フロア制）オフライン版 =====
//
// 1層から100層まで、各フロアの敵Waveを全滅させて上を目指すタワーモードです。
// 10層ごとにボスフロアが配置され、100層をクリアすると「TOWER CLEARED」で終了します。
//
// 段階実装の現在地（タスク4）：
//   - フロアの状態機械（カウントダウン→Wave→休憩→次層→…→クリア）  ※タスク2
//   - 敵6種のスポーン・見た目・ステータス・撃破・全滅判定            ※タスク3
//   - 敵6種の固有行動                                               ※タスク4（本コミット）
//       fast     : 高速接近
//       tank     : 低速・硬い・ワールド空間にHPバー表示
//       ranged   : 8m以上で接近、8m未満で後退しながら射撃（敵弾・視線遮蔽あり）
//       exploder : 死亡時に半径4mの爆発、爆発タイプ同士の連鎖
//       summoner : 20秒ごとに標準タイプ2体を召喚
// 残り：
//   - ボス5種の状態機械                                             ※タスク5
//   - 専用FloorHUD / BossHUD / クリア演出                           ※タスク6
//
// ボスフロアはタスク5まで暫定プレースホルダ（短い待機で消化）のままです。

// 敵6種。
export type EnemyType =
  | "standard"
  | "fast"
  | "tank"
  | "ranged"
  | "exploder"
  | "summoner";

// 敵種別の出現比率の並び順（ENEMY_RATIO の各配列もこの順）。
const TYPE_ORDER: EnemyType[] = [
  "standard",
  "fast",
  "tank",
  "ranged",
  "exploder",
  "summoner",
];

// 敵1種の設定。
// speed は「標準速度 × 倍率」を事前計算した絶対値（m/s）。
// プロンプトは速度を「通常×倍率」と括弧内の絶対m/sの両方で記しているが、
// 両者は内部で矛盾するため、一次仕様である倍率を STANDARD_SPEED に掛けて採用する。
interface EnemyConfig {
  scale: number;
  bodyColor: number;
  accentColor: number;
  hp: number;
  speed: number;
  touch: number; // 接触ダメージ
  attackInterval: number; // 接触ダメージ／射撃の最小間隔（秒）
  score: number; // 撃破スコア
}

const STANDARD_SPEED = 3.0; // 標準タイプの基準速度（m/s）

const ENEMY_CONFIG: Record<EnemyType, EnemyConfig> = {
  standard: {
    scale: 1.0,
    bodyColor: 0x23262e,
    accentColor: 0xff6a00,
    hp: 100,
    speed: STANDARD_SPEED * 1.0,
    touch: 10,
    attackInterval: 1.0,
    score: 100,
  },
  fast: {
    scale: 0.7,
    bodyColor: 0x3a1515,
    accentColor: 0xff2020,
    hp: 30,
    speed: STANDARD_SPEED * 2.2,
    touch: 8,
    attackInterval: 0.6,
    score: 80,
  },
  tank: {
    scale: 1.4,
    bodyColor: 0x2a3038,
    accentColor: 0x6688aa,
    hp: 400,
    speed: STANDARD_SPEED * 0.5,
    touch: 25,
    attackInterval: 2.0,
    score: 250,
  },
  ranged: {
    scale: 1.0,
    bodyColor: 0x2a1d3a,
    accentColor: 0x6644aa,
    hp: 60,
    speed: STANDARD_SPEED * 0.6,
    touch: 5,
    attackInterval: 1.5,
    score: 120,
  },
  exploder: {
    scale: 0.85,
    bodyColor: 0x2e2012,
    accentColor: 0xff6600,
    hp: 80,
    speed: STANDARD_SPEED * 0.9,
    touch: 0,
    attackInterval: 1.0,
    score: 100,
  },
  summoner: {
    scale: 1.2,
    bodyColor: 0x2a1230,
    accentColor: 0xcc44cc,
    hp: 120,
    speed: STANDARD_SPEED * 0.4,
    touch: 8,
    attackInterval: 1.0,
    score: 300,
  },
};

// 層に応じた敵種別の出現比率テーブル（[standard, fast, tank, ranged, exploder, summoner]）。
const ENEMY_RATIO: Record<number, number[]> = {
  1: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  5: [0.6, 0.2, 0.1, 0.1, 0.0, 0.0],
  10: [0.4, 0.2, 0.1, 0.1, 0.1, 0.1],
  20: [0.2, 0.2, 0.2, 0.2, 0.1, 0.1],
  50: [0.1, 0.2, 0.2, 0.2, 0.2, 0.1],
  80: [0.1, 0.2, 0.1, 0.2, 0.2, 0.2],
};
const RATIO_KEYS = [1, 5, 10, 20, 50, 80];

// ボスの種類。
export type BossType = "crusher" | "phantom" | "warlord" | "hivemind" | "siege";
type BossKind = BossType | "rush";

interface BossSlot {
  kind: BossKind;
  hpMul: number;
  label: string;
}

type Phase =
  | "countdown"
  | "wave"
  | "boss"
  | "rest"
  | "result"
  | "cleared"
  | "dead";

// 生成後の敵1体ぶんのデータ。
interface TowerEnemy {
  unit: EnemyUnit;
  type: EnemyType;
  hp: number;
  maxHp: number;
  speed: number;
  touch: number;
  attackInterval: number;
  attackCd: number; // 接触／射撃のクールダウン残り（秒）
  summonCd: number; // 召喚タイプの次回召喚までの残り（秒）
  dead: boolean; // 二重撃破防止
  hpBar: HpBar | null; // タンクのワールドHPバー
}

// 敵弾1発。
interface TowerProjectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number; // 残り寿命（秒）
}

// タンク頭上のワールドHPバー（背景＋塗り）。
interface HpBar {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
}

const MAX_FLOOR = 100;
const REST_SECONDS = 5;
const COUNTDOWN_SECONDS = 3;
const ARENA_BOUND = 28;

// 敵の固有行動パラメータ。
const RANGED_FIRE_DIST = 8; // この距離未満で後退しながら射撃
const BULLET_SPEED = 18; // 敵弾の速度（m/s）
const BULLET_DAMAGE = 12; // 敵弾の被弾ダメージ
const BULLET_LIFE = 3.0; // 敵弾の寿命（秒）
const EXPLODER_RADIUS = 4; // 爆発タイプの爆発半径（m）
const EXPLODER_MAX_DAMAGE = 45; // 爆発の中心ダメージ
const EXPLODER_MIN_DAMAGE = 12; // 爆発の最小ダメージ
const SUMMON_INTERVAL = 20; // 召喚タイプの召喚間隔（秒）
const SUMMON_COUNT = 2; // 1回の召喚数

const BOSS_SCHEDULE: Record<number, BossSlot> = {
  10: { kind: "crusher", hpMul: 1.0, label: "CRUSHER" },
  20: { kind: "phantom", hpMul: 1.0, label: "PHANTOM" },
  30: { kind: "warlord", hpMul: 1.0, label: "WARLORD" },
  40: { kind: "phantom", hpMul: 1.3, label: "PHANTOM+" },
  50: { kind: "warlord", hpMul: 1.3, label: "WARLORD+" },
  60: { kind: "hivemind", hpMul: 1.0, label: "HIVE MIND" },
  70: { kind: "hivemind", hpMul: 1.3, label: "HIVE MIND+" },
  80: { kind: "siege", hpMul: 1.0, label: "SIEGE ENGINE" },
  90: { kind: "rush", hpMul: 1.0, label: "BOSS RUSH" },
  100: { kind: "siege", hpMul: 1.5, label: "SIEGE ENGINE 最終形態" },
};

// 視線判定用の使い回しオブジェクト（毎フレームのGCを避ける）。
const _ray = new THREE.Ray();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _hit = new THREE.Vector3();

export class TowerMode implements GameMode, MeleeTargetProvider {
  id = "tower";
  label = "TOWER（100層）";
  description =
    "1層ずつ敵Waveを全滅させて上を目指す。10層ごとにボス。100層クリアでTOWER CLEARED。";

  private ctx: GameContext | null = null;
  private hud: ModeHUD | null = null;

  private phase: Phase = "countdown";
  private countdown = COUNTDOWN_SECONDS;
  private currentFloor = 1;
  private restCountdown = 0;
  private totalScore = 0;
  private elapsedMs = 0;

  private enemies: TowerEnemy[] = [];
  private projectiles: TowerProjectile[] = [];
  private eye = new THREE.Vector3();

  private bossPlaceholderTimer = 0;
  private bossPlaceholderActive = false;

  enter(ctx: GameContext, _now: number): void {
    this.ctx = ctx;
    this.phase = "countdown";
    this.countdown = COUNTDOWN_SECONDS;
    this.currentFloor = 1;
    this.restCountdown = 0;
    this.totalScore = 0;
    this.elapsedMs = 0;
    this.enemies = [];
    this.projectiles = [];
    this.bossPlaceholderTimer = 0;
    this.bossPlaceholderActive = false;

    ctx.meleeProvider = this;
    ctx.health.reset(100);
    ctx.health.show();
    ctx.ui.showHud(false);
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(true);
      ctx.grenadeSystem.reset();
    }
    ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg);

    this.hud = new ModeHUD();
    this.hud.setCenter(String(COUNTDOWN_SECONDS), "#ffffff");
    this.updateHud();
  }

  update(ctx: GameContext, dt: number, _now: number): void {
    if (this.phase === "result" || this.phase === "cleared" || this.phase === "dead") {
      return;
    }

    if (ctx.health.isDead()) {
      this.die(ctx);
      return;
    }

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.hud?.setCenter("GO", "#46d36a");
        window.setTimeout(() => this.hud?.clearCenter(), 500);
        this.beginFloor(this.currentFloor);
      } else {
        this.hud?.setCenter(String(Math.max(1, Math.ceil(this.countdown))), "#ffffff");
      }
      return;
    }

    this.elapsedMs += dt * 1000;

    if (this.phase === "wave" || this.phase === "boss") {
      this.updateCombat(ctx, dt);
      // updateCombat 内の死亡で phase が dead に切り替わる場合があるため再確認。
      if (this.phase !== "wave" && this.phase !== "boss") return;
      if (this.remaining() <= 0) {
        this.onFloorCleared();
        return;
      }
      this.updateHud();
      return;
    }

    if (this.phase === "rest") {
      this.restCountdown -= dt;
      this.hud?.setCenter(
        `次のフロアまで ${Math.max(1, Math.ceil(this.restCountdown))}`,
        "#ffe6c7"
      );
      if (this.restCountdown <= 0) {
        this.hud?.clearCenter();
        this.currentFloor += 1;
        this.beginFloor(this.currentFloor);
      }
      this.updateHud();
      return;
    }
  }

  private remaining(): number {
    return this.enemies.length + (this.bossPlaceholderActive ? 1 : 0);
  }

  private beginFloor(floor: number): void {
    const boss = BOSS_SCHEDULE[floor];
    if (boss) {
      this.phase = "boss";
      this.spawnBoss(floor, boss);
      this.hud?.setCenter(boss.label, "#ff5a5a");
      window.setTimeout(() => this.hud?.clearCenter(), 900);
    } else {
      this.phase = "wave";
      this.spawnWave(floor);
    }
    this.updateHud();
  }

  private waveEnemyCount(floor: number): number {
    return 4 + floor * 2;
  }

  private ratioFor(floor: number): number[] {
    const f = Math.max(RATIO_KEYS[0], Math.min(RATIO_KEYS[RATIO_KEYS.length - 1], floor));
    let lo = RATIO_KEYS[0];
    let hi = RATIO_KEYS[RATIO_KEYS.length - 1];
    for (let i = 0; i < RATIO_KEYS.length - 1; i++) {
      if (f >= RATIO_KEYS[i] && f <= RATIO_KEYS[i + 1]) {
        lo = RATIO_KEYS[i];
        hi = RATIO_KEYS[i + 1];
        break;
      }
    }
    const a = ENEMY_RATIO[lo];
    const b = ENEMY_RATIO[hi];
    const t = hi === lo ? 0 : (f - lo) / (hi - lo);
    const out: number[] = [];
    for (let i = 0; i < TYPE_ORDER.length; i++) {
      out.push(a[i] + (b[i] - a[i]) * t);
    }
    return out;
  }

  private pickType(floor: number): EnemyType {
    const ratio = this.ratioFor(floor);
    let sum = 0;
    for (const v of ratio) sum += v;
    let r = Math.random() * (sum > 0 ? sum : 1);
    for (let i = 0; i < TYPE_ORDER.length; i++) {
      r -= ratio[i];
      if (r <= 0) return TYPE_ORDER[i];
    }
    return "standard";
  }

  private spawnWave(floor: number): void {
    const count = this.waveEnemyCount(floor);
    for (let i = 0; i < count; i++) {
      this.spawnEnemy(this.pickType(floor), floor);
    }
  }

  // 敵を1体生成してフィールドへ出す。
  // atX/atZ を渡すとその近傍へ、無ければプレイヤー周囲のリング状に配置する。
  private spawnEnemy(
    type: EnemyType,
    floor: number,
    atX?: number,
    atZ?: number
  ): TowerEnemy | null {
    if (!this.ctx) return null;
    const cfg = ENEMY_CONFIG[type];

    let x: number;
    let z: number;
    if (atX !== undefined && atZ !== undefined) {
      x = atX + (Math.random() - 0.5) * 2;
      z = atZ + (Math.random() - 0.5) * 2;
    } else {
      this.ctx.player.getEyePosition(this.eye);
      const angle = Math.random() * Math.PI * 2;
      const dist = 18 + Math.random() * 4;
      x = this.eye.x + Math.cos(angle) * dist;
      z = this.eye.z + Math.sin(angle) * dist;
    }
    x = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, x));
    z = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, z));

    const unit = new EnemyUnit({
      scale: cfg.scale,
      bodyColor: cfg.bodyColor,
      accentColor: cfg.accentColor,
    });
    unit.setGround(x, z);
    this.ctx.scene.add(unit.group);
    this.ctx.weapons.enemyTargets.push(unit.hitbox);
    this.ctx.weapons.enemyTargets.push(unit.headHitbox);

    const hpScale = 1 + Math.floor(floor / 10) * 0.1;
    const maxHp = Math.round(cfg.hp * hpScale);

    const e: TowerEnemy = {
      unit,
      type,
      hp: maxHp,
      maxHp,
      speed: cfg.speed,
      touch: cfg.touch,
      attackInterval: cfg.attackInterval,
      attackCd: type === "ranged" ? 1 + Math.random() : 0,
      summonCd: type === "summoner" ? SUMMON_INTERVAL : 0,
      dead: false,
      hpBar: type === "tank" ? this.makeHpBar(cfg.scale) : null,
    };
    this.enemies.push(e);
    return e;
  }

  private spawnBoss(_floor: number, slot: BossSlot): void {
    this.bossPlaceholderActive = true;
    this.bossPlaceholderTimer = slot.kind === "rush" ? 1.5 : 1.0;
  }

  private updateCombat(ctx: GameContext, dt: number): void {
    ctx.player.getEyePosition(this.eye);
    const colliders = ctx.stage.colliders;
    let contactDamage = 0;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;
      const ex = e.unit.group.position.x;
      const ez = e.unit.group.position.z;
      const dx = this.eye.x - ex;
      const dz = this.eye.z - ez;
      const d = Math.hypot(dx, dz);
      e.unit.faceTo(dx, dz);

      if (e.attackCd > 0) e.attackCd -= dt;

      if (e.unit.staggerTimer > 0) {
        e.unit.updateKnockback(dt, colliders, ARENA_BOUND);
        e.unit.update(dt, "idle");
        this.syncHpBar(e);
        continue;
      }

      if (e.type === "ranged") {
        // 遠距離：8m以上で接近、8m未満で後退しながら射撃。
        if (d > RANGED_FIRE_DIST) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, colliders);
          e.unit.update(dt, "walk");
        } else {
          // 後退（プレイヤーから離れる向きの点へ移動）。
          const nx = d > 0.001 ? dx / d : 0;
          const nz = d > 0.001 ? dz / d : 1;
          e.unit.moveToward(ex - nx * 5, ez - nz * 5, e.speed, dt, colliders);
          e.unit.update(dt, "attack");
          // 視線が通っていれば射撃。
          if (e.attackCd <= 0 && this.hasLineOfSight(e)) {
            this.fireEnemyBullet(e);
            e.attackCd = e.attackInterval;
          }
        }
      } else if (e.type === "summoner") {
        // 召喚：10m以上で接近、10m未満は停止して召喚を優先。生存中は召喚し続ける。
        if (d > 10) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, colliders);
          e.unit.update(dt, "walk");
        } else {
          e.unit.update(dt, "attack");
        }
        e.summonCd -= dt;
        if (e.summonCd <= 0) {
          e.summonCd = SUMMON_INTERVAL;
          this.summonFrom(e);
        }
        if (d < 1.3 && e.touch > 0 && e.attackCd <= 0) {
          contactDamage += e.touch;
          e.attackCd = e.attackInterval;
        }
      } else {
        // standard / fast / tank / exploder：接近。
        if (d > 0.9) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, colliders);
        }
        e.unit.update(dt, d < 1.5 ? "attack" : "walk");
        if (d < 1.3 && e.touch > 0 && e.attackCd <= 0) {
          contactDamage += e.touch;
          e.attackCd = e.attackInterval;
        }
      }

      this.syncHpBar(e);
    }

    resolveBodyCollisions(
      this.enemies.filter((x) => !x.dead).map((x) => x.unit),
      ctx.player
    );

    if (contactDamage > 0) ctx.health.damage(contactDamage);

    this.updateProjectiles(ctx, dt);

    if (this.bossPlaceholderActive && this.bossPlaceholderTimer > 0) {
      this.bossPlaceholderTimer -= dt;
      if (this.bossPlaceholderTimer <= 0) this.bossPlaceholderActive = false;
    }

    // 取り除き予約された敵（dead）をまとめて掃除する。
    this.flushDead();

    if (ctx.health.isDead()) this.die(ctx);
  }

  // ===== 敵弾 =====

  private hasLineOfSight(e: TowerEnemy): boolean {
    if (!this.ctx) return false;
    _from.set(e.unit.group.position.x, e.unit.group.position.y + 1.2, e.unit.group.position.z);
    _to.copy(this.eye);
    _dir.copy(_to).sub(_from);
    const dist = _dir.length();
    if (dist < 0.001) return true;
    _dir.divideScalar(dist);
    _ray.set(_from, _dir);
    for (const c of this.ctx.stage.colliders) {
      if (_ray.intersectBox(c, _hit)) {
        if (_from.distanceTo(_hit) < dist - 0.2) return false;
      }
    }
    return true;
  }

  private fireEnemyBullet(e: TowerEnemy): void {
    if (!this.ctx) return;
    const ox = e.unit.group.position.x;
    const oy = e.unit.group.position.y + 1.2;
    const oz = e.unit.group.position.z;
    const dirx = this.eye.x - ox;
    const diry = this.eye.y - oy;
    const dirz = this.eye.z - oz;
    const len = Math.hypot(dirx, diry, dirz) || 1;

    const geo = new THREE.SphereGeometry(0.13, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff5a3c });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ox, oy, oz);
    this.ctx.scene.add(mesh);

    this.projectiles.push({
      mesh,
      vel: new THREE.Vector3(
        (dirx / len) * BULLET_SPEED,
        (diry / len) * BULLET_SPEED,
        (dirz / len) * BULLET_SPEED
      ),
      life: BULLET_LIFE,
    });
  }

  private updateProjectiles(ctx: GameContext, dt: number): void {
    const px = ctx.player.position.x;
    const py = ctx.player.position.y;
    const pz = ctx.player.position.z;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];
      b.life -= dt;
      b.mesh.position.x += b.vel.x * dt;
      b.mesh.position.y += b.vel.y * dt;
      b.mesh.position.z += b.vel.z * dt;

      let remove = b.life <= 0;

      // プレイヤー命中判定（簡易AABB：水平0.6m・縦は体の高さ）。
      if (!remove) {
        const hx = b.mesh.position.x - px;
        const hz = b.mesh.position.z - pz;
        if (
          Math.hypot(hx, hz) < 0.6 &&
          b.mesh.position.y > py + 0.2 &&
          b.mesh.position.y < py + 1.9
        ) {
          ctx.health.damage(BULLET_DAMAGE);
          remove = true;
        }
      }

      // コライダー命中で消滅。
      if (!remove) {
        for (const c of ctx.stage.colliders) {
          if (c.containsPoint(b.mesh.position)) {
            remove = true;
            break;
          }
        }
      }

      if (remove) {
        this.disposeProjectile(b);
        this.projectiles.splice(i, 1);
      }
    }
  }

  private disposeProjectile(b: TowerProjectile): void {
    this.ctx?.scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    (b.mesh.material as THREE.Material).dispose();
  }

  // ===== 召喚 =====

  private summonFrom(e: TowerEnemy): void {
    const sx = e.unit.group.position.x;
    const sz = e.unit.group.position.z;
    for (let i = 0; i < SUMMON_COUNT; i++) {
      this.spawnEnemy("standard", this.currentFloor, sx, sz);
    }
  }

  // ===== 爆発（爆発タイプ）=====

  // 爆発を起こす。プレイヤーへ範囲ダメージし、近くの爆発タイプを連鎖させる。
  private explodeAt(x: number, y: number, z: number): void {
    if (!this.ctx) return;
    // 見た目・音・自機の吹き飛ばしは既存のフラグ爆発演出を流用する。
    if (this.ctx.grenadeSystem) this.ctx.grenadeSystem.explodeFragAt(x, y, z);

    // プレイヤーへのHPダメージ（半径4m・距離減衰）。
    const p = this.ctx.player.position;
    const pd = Math.hypot(p.x - x, p.y + 1.0 - y, p.z - z);
    if (pd <= EXPLODER_RADIUS) {
      const falloff = 1 - pd / EXPLODER_RADIUS;
      const dmg = Math.max(
        EXPLODER_MIN_DAMAGE,
        Math.round(EXPLODER_MAX_DAMAGE * falloff)
      );
      this.ctx.health.damage(dmg);
    }

    // 連鎖：半径内の他の爆発タイプを誘爆させる。
    for (const other of this.enemies) {
      if (other.dead || other.type !== "exploder") continue;
      const od = Math.hypot(
        other.unit.group.position.x - x,
        other.unit.group.position.z - z
      );
      if (od <= EXPLODER_RADIUS) {
        // killEnemy 経由で連鎖（dead ガードで無限ループを防止）。
        this.killEnemy(other);
      }
    }
  }

  // ===== HPバー（タンク）=====

  private makeHpBar(scale: number): HpBar {
    const group = new THREE.Group();
    const w = 1.2;
    const h = 0.16;
    const bgGeo = new THREE.PlaneGeometry(w, h);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x111418, depthTest: false });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.renderOrder = 998;
    group.add(bg);

    const fillGeo = new THREE.PlaneGeometry(w - 0.06, h - 0.05);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x46d36a, depthTest: false });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.z = 0.01;
    fill.renderOrder = 999;
    group.add(fill);

    group.userData.scale = scale;
    this.ctx?.scene.add(group);
    return { group, fill, fillMat };
  }

  // HPバーを敵頭上へ配置し、プレイヤーへ向け、残量に応じて幅・色を更新する。
  private syncHpBar(e: TowerEnemy): void {
    if (!e.hpBar) return;
    const scale = (e.hpBar.group.userData.scale as number) || 1;
    const p = e.unit.group.position;
    e.hpBar.group.position.set(p.x, p.y + 1.9 * scale + 0.45, p.z);
    e.hpBar.group.lookAt(this.eye.x, e.hpBar.group.position.y, this.eye.z);

    const ratio = Math.max(0, Math.min(1, e.hp / e.maxHp));
    e.hpBar.fill.scale.x = ratio;
    e.hpBar.fill.position.x = -(1 - ratio) * (1.14 / 2);
    const col = ratio > 0.5 ? 0x46d36a : ratio > 0.25 ? 0xffd23a : 0xff4040;
    e.hpBar.fillMat.color.set(col);
  }

  private disposeHpBar(e: TowerEnemy): void {
    if (!e.hpBar) return;
    this.ctx?.scene.remove(e.hpBar.group);
    e.hpBar.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
    e.hpBar = null;
  }

  // ===== ダメージ・撃破 =====

  private onHit(obj: object, dmg: number): void {
    const e = this.enemies.find(
      (x) => !x.dead && (x.unit.hitbox === obj || x.unit.headHitbox === obj)
    );
    if (!e) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.killEnemy(e);
  }

  // 敵を撃破扱いにする。スコア加算・爆発・撤去予約を行う。
  private killEnemy(e: TowerEnemy): void {
    if (e.dead) return;
    e.dead = true;
    this.totalScore += ENEMY_CONFIG[e.type].score;
    if (e.type === "exploder") {
      const p = e.unit.group.position;
      this.explodeAt(p.x, p.y + 0.8, p.z);
    }
    // 実際の撤去は flushDead でまとめて行う（ループ中の配列操作を避ける）。
  }

  // dead フラグの立った敵をフィールドから取り除く。
  private flushDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.removeFromField(e);
        this.enemies.splice(i, 1);
      }
    }
  }

  // 敵の描画・当たり判定登録を片付ける（スコアには触れない）。
  private removeFromField(e: TowerEnemy): void {
    if (!this.ctx) return;
    this.ctx.scene.remove(e.unit.group);
    e.unit.dispose();
    const ti = this.ctx.weapons.enemyTargets.indexOf(e.unit.hitbox);
    if (ti >= 0) this.ctx.weapons.enemyTargets.splice(ti, 1);
    const hi = this.ctx.weapons.enemyTargets.indexOf(e.unit.headHitbox);
    if (hi >= 0) this.ctx.weapons.enemyTargets.splice(hi, 1);
    this.disposeHpBar(e);
  }

  getMeleeTargets(): MeleeTarget[] {
    return makeMeleeTargets(this.enemies, (e) => this.killEnemy(e));
  }

  // ===== フロア進行・終了 =====

  private onFloorCleared(): void {
    const bonus = this.floorClearBonus(this.currentFloor);
    this.totalScore += bonus;

    if (this.currentFloor >= MAX_FLOOR) {
      this.clearTower();
      return;
    }

    this.phase = "rest";
    this.restCountdown = REST_SECONDS;
    this.hud?.setCenter(`FLOOR ${this.currentFloor} CLEARED  +${bonus}pt`, "#ffd23a");
    this.updateHud();
  }

  private floorClearBonus(floor: number): number {
    return BOSS_SCHEDULE[floor] ? 2000 : 200 + floor * 30;
  }

  private clearTower(): void {
    this.phase = "cleared";
    this.clearField();
    const sec = Math.round(this.elapsedMs / 1000);
    this.ctx?.finish(
      ["TOWER CLEARED", `クリアタイム ${fmtTime(sec)}`, `総スコア ${this.totalScore}`],
      true
    );
  }

  private die(ctx: GameContext): void {
    if (this.phase === "dead") return;
    this.phase = "dead";
    this.clearField();
    ctx.finish(
      [
        "TOWER 失敗",
        `到達 ${this.currentFloor} / ${MAX_FLOOR} 層`,
        `総スコア ${this.totalScore}`,
      ],
      true
    );
  }

  // 敵・敵弾をすべて撤去する。
  private clearField(): void {
    if (!this.ctx) return;
    for (const e of this.enemies) this.removeFromField(e);
    this.enemies = [];
    for (const b of this.projectiles) this.disposeProjectile(b);
    this.projectiles = [];
    this.bossPlaceholderActive = false;
  }

  private updateHud(): void {
    if (!this.hud) return;
    this.hud.setTimer(fmtTime(Math.round(this.elapsedMs / 1000)));
    this.hud.setInfo([
      `Floor ${this.currentFloor} / ${MAX_FLOOR}`,
      `残り敵 ${this.remaining()}`,
      `スコア ${this.totalScore}`,
    ]);
  }

  exit(ctx: GameContext): void {
    ctx.meleeProvider = null;
    this.clearField();
    ctx.weapons.enemyHitHook = null;
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(false);
      ctx.grenadeSystem.clear();
    }
    ctx.health.hide();
    ctx.ui.showHud(false);
    this.hud?.dispose();
    this.hud = null;
    this.ctx = null;
  }
}

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
