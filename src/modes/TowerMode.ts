import * as THREE from "three";
import {
  GameMode,
  GameContext,
  makeMeleeTargets,
  resolveBodyCollisions,
} from "../GameModes";
import { EnemyUnit } from "../Enemy";
import { MeleeTarget, MeleeTargetProvider } from "../combat/MeleeTarget";
import { FloorHUD } from "../ui/FloorHUD";
import { BossHUD } from "../ui/BossHUD";

// ===== TOWER（100層フロア制）オフライン版 =====
//
// 1層から100層まで、各フロアの敵Waveを全滅させて上を目指すタワーモードです。
// 10層ごとにボスフロアが配置され、100層をクリアすると「TOWER CLEARED」で終了します。
//
// 段階実装の現在地（タスク5）：
//   - フロアの状態機械（カウントダウン→Wave→休憩→次層→…→クリア）  ※タスク2
//   - 敵6種のスポーン・見た目・ステータス・撃破・全滅判定            ※タスク3
//   - 敵6種の固有行動（接近/射撃/爆発/召喚）                        ※タスク4
//   - ボス5種の状態機械 + 90層ボスラッシュ                         ※タスク5（本コミット）
//       CRUSHER  : 随伴4体 + 15秒ごとチャージ突進（フェーズ2で8秒）
//       PHANTOM  : 8秒ごとテレポート（残像）。フェーズ2で4秒・速度上昇
//       WARLORD  : 6秒ごと弾幕(16/24発) + 20秒ごと集中射撃8連
//       HIVE MIND: 8秒ごとに高速タイプ召喚（フェーズ2で間隔短縮・増量）
//       SIEGE    : チャージ+弾幕+爆発召喚を継承、HPで3フェーズ強化
// 残り：
//   - 専用FloorHUD / BossHUD / クリア演出                           ※タスク6
//
// 注：PHANTOM の「背後3mへワープ」はプレイヤーの向きを取得するAPIが無いため、
// プレイヤーから3m離れた近接位置へのワープで近似している。

// 敵6種。
export type EnemyType =
  | "standard"
  | "fast"
  | "tank"
  | "ranged"
  | "exploder"
  | "summoner";

const TYPE_ORDER: EnemyType[] = [
  "standard",
  "fast",
  "tank",
  "ranged",
  "exploder",
  "summoner",
];

interface EnemyConfig {
  scale: number;
  bodyColor: number;
  accentColor: number;
  hp: number;
  speed: number;
  touch: number;
  attackInterval: number;
  score: number;
}

const STANDARD_SPEED = 3.0;

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

const ENEMY_RATIO: Record<number, number[]> = {
  1: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  5: [0.6, 0.2, 0.1, 0.1, 0.0, 0.0],
  10: [0.4, 0.2, 0.1, 0.1, 0.1, 0.1],
  20: [0.2, 0.2, 0.2, 0.2, 0.1, 0.1],
  50: [0.1, 0.2, 0.2, 0.2, 0.2, 0.1],
  80: [0.1, 0.2, 0.1, 0.2, 0.2, 0.2],
};
const RATIO_KEYS = [1, 5, 10, 20, 50, 80];

// ===== ボス =====

export type BossType = "crusher" | "phantom" | "warlord" | "hivemind" | "siege";
type BossKind = BossType | "rush";

interface BossSlot {
  kind: BossKind;
  hpMul: number;
  label: string;
}

interface BossBase {
  hp: number;
  speedMul: number;
  touch: number;
  scale: number;
  body: number;
  accent: number;
}

const BOSS_BASE: Record<BossType, BossBase> = {
  crusher: { hp: 3000, speedMul: 0.7, touch: 40, scale: 2.2, body: 0x223044, accent: 0x6688aa },
  phantom: { hp: 1500, speedMul: 3.0, touch: 30, scale: 1.3, body: 0xb8b8cc, accent: 0xffffff },
  warlord: { hp: 2000, speedMul: 0.6, touch: 20, scale: 1.8, body: 0x6a1a00, accent: 0xff5522 },
  hivemind: { hp: 2500, speedMul: 0.5, touch: 15, scale: 1.9, body: 0x36004f, accent: 0xaa44ff },
  siege: { hp: 8000, speedMul: 0.8, touch: 50, scale: 2.6, body: 0x111122, accent: 0x4466ff },
};

// ボスの行動パラメータ。
const CRUSHER_CHARGE_CD = 15;
const CRUSHER_CHARGE_CD_P2 = 8;
const CHARGE_DURATION = 3;
const CHARGE_RECOVER = 2;
const CHARGE_SPEED_MUL = 4;
const CHARGE_SPEED_MUL_SIEGE_P2 = 5;
const CHARGE_DAMAGE = 60;

const PHANTOM_TP_CD = 8;
const PHANTOM_TP_CD_P2 = 4;

const WARLORD_BARRAGE_CD = 6;
const WARLORD_FOCUS_CD = 20;
const BARRAGE_COUNT = 16;
const BARRAGE_COUNT_P2 = 24;
const SIEGE_BARRAGE_COUNT = 20;
const SIEGE_BARRAGE_COUNT_P3 = 32;
const FOCUS_SHOTS = 8;
const FOCUS_INTERVAL = 0.3;

const HIVE_SUMMON_CD = 8;
const HIVE_SUMMON_CD_P2 = 4;
const HIVE_SUMMON_COUNT = 3;
const HIVE_SUMMON_COUNT_P2 = 5;
const HIVE_PAUSE = 2;

const SIEGE_CHARGE_CD = 12;
const SIEGE_BARRAGE_CD = 8;
const SIEGE_SUMMON_CD = 10;
const SIEGE_SUMMON_EXPLODER = 2;
const SIEGE_P3_INSTANT_EXPLODER = 4;

const BARRAGE_BULLET_SPEED = 12;
const BARRAGE_DAMAGE = 10;
const FOCUS_DAMAGE = 12;

type Phase =
  | "countdown"
  | "wave"
  | "boss"
  | "rest"
  | "result"
  | "cleared"
  | "dead";

interface TowerEnemy {
  unit: EnemyUnit;
  type: EnemyType;
  hp: number;
  maxHp: number;
  speed: number;
  touch: number;
  attackInterval: number;
  attackCd: number;
  summonCd: number;
  dead: boolean;
  hpBar: HpBar | null;
}

interface TowerProjectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
}

interface HpBar {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
}

// 残像（PHANTOM のテレポート跡）。
interface Ghost {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
}

// ボス1体ぶんの状態。
interface BossState {
  unit: EnemyUnit;
  kind: BossType;
  hp: number;
  maxHp: number;
  baseSpeed: number;
  touch: number;
  scale: number;
  label: string;
  phase: number; // 1 / 2 / 3（siege のみ3まで）
  mode: "move" | "charge" | "recover" | "pause";
  modeTimer: number;
  cdx: number;
  cdz: number;
  chargeHitDone: boolean;
  touchCd: number;
  tA: number; // チャージ／弾幕／召喚（ボスにより用途が変わる主タイマー）
  tB: number; // 集中射撃／弾幕など副タイマー
  tC: number; // siege の爆発召喚タイマー
  focusLeft: number;
  focusTimer: number;
  p3Done: boolean; // siege フェーズ3突入時の即時召喚を一度だけ行うフラグ
}

const MAX_FLOOR = 100;
const REST_SECONDS = 5;
const COUNTDOWN_SECONDS = 3;
const ARENA_BOUND = 28;

const RANGED_FIRE_DIST = 8;
const BULLET_SPEED = 18;
const BULLET_DAMAGE = 12;
const BULLET_LIFE = 3.0;
const EXPLODER_RADIUS = 4;
const EXPLODER_MAX_DAMAGE = 45;
const EXPLODER_MIN_DAMAGE = 12;
const SUMMON_INTERVAL = 20;
const SUMMON_COUNT = 2;

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

// 90層ボスラッシュで連続登場させるボスの並び。
const RUSH_ORDER: BossType[] = ["crusher", "phantom", "warlord", "hivemind", "siege"];
const RUSH_HP_MUL = 0.4;
const RUSH_SCALE_MUL = 0.7;

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
  private hud: FloorHUD | null = null;
  private bossHud: BossHUD | null = null;

  private phase: Phase = "countdown";
  private countdown = COUNTDOWN_SECONDS;
  private currentFloor = 1;
  private restCountdown = 0;
  private totalScore = 0;
  private elapsedMs = 0;

  private enemies: TowerEnemy[] = [];
  private projectiles: TowerProjectile[] = [];
  private ghosts: Ghost[] = [];
  private eye = new THREE.Vector3();

  private boss: BossState | null = null;
  private rushQueue: BossType[] = [];

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
    this.ghosts = [];
    this.boss = null;
    this.rushQueue = [];

    ctx.meleeProvider = this;
    ctx.health.reset(100);
    ctx.health.show();
    ctx.ui.showHud(false);
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(true);
      ctx.grenadeSystem.reset();
    }
    ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg);

    this.hud = new FloorHUD();
    this.bossHud = new BossHUD();
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
    if (this.phase === "boss") {
      return (this.boss ? 1 : 0) + this.rushQueue.length;
    }
    return this.enemies.length;
  }

  private beginFloor(floor: number): void {
    const boss = BOSS_SCHEDULE[floor];
    if (boss) {
      this.phase = "boss";
      this.spawnBossFloor(floor, boss);
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

  // ボスフロアの開始。通常ボスは1体、90層はラッシュを仕込む。
  private spawnBossFloor(floor: number, slot: BossSlot): void {
    if (slot.kind === "rush") {
      this.rushQueue = RUSH_ORDER.slice(1); // 先頭はすぐ生成する
      this.spawnBoss(RUSH_ORDER[0], RUSH_HP_MUL, RUSH_SCALE_MUL, "RUSH 1/5", false);
    } else {
      const withEscorts = slot.kind === "crusher";
      this.spawnBoss(slot.kind, slot.hpMul, 1.0, slot.label, withEscorts);
    }
    void floor;
  }

  // ボス1体を生成する。
  private spawnBoss(
    kind: BossType,
    hpMul: number,
    scaleMul: number,
    label: string,
    withEscorts: boolean
  ): void {
    if (!this.ctx) return;
    const base = BOSS_BASE[kind];
    const scale = base.scale * scaleMul;

    this.ctx.player.getEyePosition(this.eye);
    const angle = Math.random() * Math.PI * 2;
    const x = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.eye.x + Math.cos(angle) * 16));
    const z = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.eye.z + Math.sin(angle) * 16));

    const unit = new EnemyUnit({ scale, bodyColor: base.body, accentColor: base.accent });
    unit.setGround(x, z);
    this.ctx.scene.add(unit.group);
    this.ctx.weapons.enemyTargets.push(unit.hitbox);
    this.ctx.weapons.enemyTargets.push(unit.headHitbox);

    const maxHp = Math.round(base.hp * hpMul);
    this.boss = {
      unit,
      kind,
      hp: maxHp,
      maxHp,
      baseSpeed: STANDARD_SPEED * base.speedMul,
      touch: base.touch,
      scale,
      label,
      phase: 1,
      mode: "move",
      modeTimer: 0,
      cdx: 0,
      cdz: 1,
      chargeHitDone: false,
      touchCd: 0,
      tA: this.bossFirstActionDelay(kind),
      tB: kind === "warlord" || kind === "siege" ? WARLORD_FOCUS_CD : 0,
      tC: kind === "siege" ? SIEGE_SUMMON_CD : 0,
      focusLeft: 0,
      focusTimer: 0,
      p3Done: false,
    };

    if (withEscorts) {
      for (let i = 0; i < 4; i++) this.spawnEnemy("standard", this.currentFloor, x, z);
    }
  }

  private bossFirstActionDelay(kind: BossType): number {
    switch (kind) {
      case "crusher":
        return CRUSHER_CHARGE_CD;
      case "phantom":
        return PHANTOM_TP_CD;
      case "warlord":
        return WARLORD_BARRAGE_CD;
      case "hivemind":
        return HIVE_SUMMON_CD;
      case "siege":
        return SIEGE_CHARGE_CD;
    }
  }

  // ===== 戦闘更新 =====

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
        if (d > RANGED_FIRE_DIST) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, colliders);
          e.unit.update(dt, "walk");
        } else {
          const nx = d > 0.001 ? dx / d : 0;
          const nz = d > 0.001 ? dz / d : 1;
          e.unit.moveToward(ex - nx * 5, ez - nz * 5, e.speed, dt, colliders);
          e.unit.update(dt, "attack");
          if (e.attackCd <= 0 && this.hasLineOfSight(e.unit.group.position)) {
            this.fireAtPlayer(
              e.unit.group.position.x,
              e.unit.group.position.y + 1.2,
              e.unit.group.position.z,
              BULLET_SPEED,
              BULLET_DAMAGE,
              0xff5a3c
            );
            e.attackCd = e.attackInterval;
          }
        }
      } else if (e.type === "summoner") {
        if (d > 10) {
          e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, colliders);
          e.unit.update(dt, "walk");
        } else {
          e.unit.update(dt, "attack");
        }
        e.summonCd -= dt;
        if (e.summonCd <= 0) {
          e.summonCd = SUMMON_INTERVAL;
          for (let s = 0; s < SUMMON_COUNT; s++) {
            this.spawnEnemy("standard", this.currentFloor, ex, ez);
          }
        }
        if (d < 1.3 && e.touch > 0 && e.attackCd <= 0) {
          contactDamage += e.touch;
          e.attackCd = e.attackInterval;
        }
      } else {
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

    if (this.boss) this.updateBoss(ctx, dt);

    resolveBodyCollisions(
      this.enemies.filter((x) => !x.dead).map((x) => x.unit),
      ctx.player
    );

    if (contactDamage > 0) ctx.health.damage(contactDamage);

    this.updateProjectiles(ctx, dt);
    this.updateGhosts(dt);

    this.flushDead();

    if (ctx.health.isDead()) this.die(ctx);
  }

  // ===== ボス状態機械 =====

  private updateBoss(ctx: GameContext, dt: number): void {
    const b = this.boss;
    if (!b) return;
    const colliders = ctx.stage.colliders;
    const bx = b.unit.group.position.x;
    const bz = b.unit.group.position.z;
    const dx = this.eye.x - bx;
    const dz = this.eye.z - bz;
    const d = Math.hypot(dx, dz);
    b.unit.faceTo(dx, dz);

    // フェーズ更新。
    this.updateBossPhase(b);

    // 接触ダメージ。
    if (b.touchCd > 0) b.touchCd -= dt;
    const reach = b.scale * 0.8 + 0.6;
    if (d < reach && b.touchCd <= 0 && b.mode !== "charge") {
      ctx.health.damage(b.touch);
      b.touchCd = 1.0;
    }

    // 集中射撃の連射スケジューラ（モードに関係なく進める）。
    if (b.focusLeft > 0) {
      b.focusTimer -= dt;
      if (b.focusTimer <= 0) {
        this.fireAtPlayer(bx, b.unit.group.position.y + 1.4, bz, BARRAGE_BULLET_SPEED, FOCUS_DAMAGE, 0xffaa33);
        b.focusTimer = FOCUS_INTERVAL;
        b.focusLeft -= 1;
      }
    }

    // モード別の挙動。
    if (b.mode === "charge") {
      const mul = b.kind === "siege" && b.phase >= 2 ? CHARGE_SPEED_MUL_SIEGE_P2 : CHARGE_SPEED_MUL;
      b.unit.moveToward(bx + b.cdx * 100, bz + b.cdz * 100, b.baseSpeed * mul, dt, colliders, undefined);
      b.unit.update(dt, "attack");
      if (!b.chargeHitDone && d < reach + 0.6) {
        ctx.health.damage(CHARGE_DAMAGE);
        const kx = d > 0.001 ? -dx / d : 0;
        const kz = d > 0.001 ? -dz / d : 1;
        ctx.player.applyExplosionImpulse(kx * 18, 6, kz * 18);
        b.chargeHitDone = true;
      }
      b.modeTimer -= dt;
      if (b.modeTimer <= 0) {
        b.mode = "recover";
        b.modeTimer = CHARGE_RECOVER;
      }
      return;
    }

    if (b.mode === "recover" || b.mode === "pause") {
      b.unit.update(dt, "idle");
      b.modeTimer -= dt;
      if (b.modeTimer <= 0) b.mode = "move";
      return;
    }

    // move：接近しつつ行動タイマーを進める。
    const speed = b.kind === "phantom" && b.phase >= 2 ? b.baseSpeed * 1.3 : b.baseSpeed;
    if (d > reach) b.unit.moveToward(this.eye.x, this.eye.z, speed, dt, colliders);
    b.unit.update(dt, d < reach + 1 ? "attack" : "walk");

    this.tickBossActions(b, dt);
  }

  private updateBossPhase(b: BossState): void {
    const r = b.hp / b.maxHp;
    if (b.kind === "siege") {
      if (r <= 0.3) {
        if (b.phase < 3) {
          b.phase = 3;
          // フェーズ3突入時、即座に爆発タイプ4体を召喚（一度だけ）。
          if (!b.p3Done) {
            b.p3Done = true;
            for (let i = 0; i < SIEGE_P3_INSTANT_EXPLODER; i++) {
              this.spawnEnemy("exploder", this.currentFloor, b.unit.group.position.x, b.unit.group.position.z);
            }
          }
        }
      } else if (r <= 0.6) {
        if (b.phase < 2) b.phase = 2;
      }
      return;
    }
    // crusher 50% / phantom 40% / warlord 50% / hivemind 40%
    const th = b.kind === "phantom" || b.kind === "hivemind" ? 0.4 : 0.5;
    if (r <= th && b.phase < 2) b.phase = 2;
  }

  private tickBossActions(b: BossState, dt: number): void {
    switch (b.kind) {
      case "crusher": {
        b.tA -= dt;
        if (b.tA <= 0) {
          this.startCharge(b);
          b.tA = b.phase >= 2 ? CRUSHER_CHARGE_CD_P2 : CRUSHER_CHARGE_CD;
        }
        break;
      }
      case "phantom": {
        b.tA -= dt;
        if (b.tA <= 0) {
          this.teleportBoss(b);
          b.tA = b.phase >= 2 ? PHANTOM_TP_CD_P2 : PHANTOM_TP_CD;
        }
        break;
      }
      case "warlord": {
        b.tA -= dt;
        if (b.tA <= 0) {
          this.barrage(b, b.phase >= 2 ? BARRAGE_COUNT_P2 : BARRAGE_COUNT);
          b.tA = WARLORD_BARRAGE_CD;
        }
        b.tB -= dt;
        if (b.tB <= 0) {
          b.focusLeft = FOCUS_SHOTS;
          b.focusTimer = 0;
          b.tB = WARLORD_FOCUS_CD;
        }
        break;
      }
      case "hivemind": {
        b.tA -= dt;
        if (b.tA <= 0) {
          const n = b.phase >= 2 ? HIVE_SUMMON_COUNT_P2 : HIVE_SUMMON_COUNT;
          for (let i = 0; i < n; i++) {
            this.spawnEnemy("fast", this.currentFloor, b.unit.group.position.x, b.unit.group.position.z);
          }
          b.mode = "pause";
          b.modeTimer = HIVE_PAUSE;
          b.tA = b.phase >= 2 ? HIVE_SUMMON_CD_P2 : HIVE_SUMMON_CD;
        }
        break;
      }
      case "siege": {
        const mul = b.phase >= 3 ? 0.49 : b.phase >= 2 ? 0.7 : 1;
        b.tA -= dt;
        if (b.tA <= 0) {
          this.startCharge(b);
          b.tA = SIEGE_CHARGE_CD * mul;
        }
        b.tB -= dt;
        if (b.tB <= 0) {
          this.barrage(b, b.phase >= 3 ? SIEGE_BARRAGE_COUNT_P3 : SIEGE_BARRAGE_COUNT);
          b.tB = SIEGE_BARRAGE_CD * mul;
        }
        b.tC -= dt;
        if (b.tC <= 0) {
          for (let i = 0; i < SIEGE_SUMMON_EXPLODER; i++) {
            this.spawnEnemy("exploder", this.currentFloor, b.unit.group.position.x, b.unit.group.position.z);
          }
          b.tC = SIEGE_SUMMON_CD * mul;
        }
        break;
      }
    }
  }

  private startCharge(b: BossState): void {
    const dx = this.eye.x - b.unit.group.position.x;
    const dz = this.eye.z - b.unit.group.position.z;
    const len = Math.hypot(dx, dz) || 1;
    b.cdx = dx / len;
    b.cdz = dz / len;
    b.chargeHitDone = false;
    b.mode = "charge";
    b.modeTimer = CHARGE_DURATION;
  }

  private teleportBoss(b: BossState): void {
    // 残像を残す。
    this.spawnGhost(
      b.unit.group.position.x,
      b.unit.group.position.y,
      b.unit.group.position.z,
      b.scale
    );
    // プレイヤーの向きが取れないため、プレイヤーから3m離れた近接位置へワープする。
    const a = Math.random() * Math.PI * 2;
    const tx = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.eye.x + Math.cos(a) * 3));
    const tz = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.eye.z + Math.sin(a) * 3));
    b.unit.setGround(tx, tz);
  }

  private barrage(b: BossState, count: number): void {
    const ox = b.unit.group.position.x;
    const oy = b.unit.group.position.y + 1.4;
    const oz = b.unit.group.position.z;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      this.spawnBullet(ox, oy, oz, Math.cos(a), 0, Math.sin(a), BARRAGE_BULLET_SPEED, BARRAGE_DAMAGE, 0xff7733);
    }
  }

  // ===== 弾 =====

  private hasLineOfSight(fromPos: THREE.Vector3): boolean {
    if (!this.ctx) return false;
    _from.set(fromPos.x, fromPos.y + 1.2, fromPos.z);
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

  // プレイヤーへ向けて1発撃つ。
  private fireAtPlayer(
    ox: number,
    oy: number,
    oz: number,
    speed: number,
    dmg: number,
    color: number
  ): void {
    const dirx = this.eye.x - ox;
    const diry = this.eye.y - oy;
    const dirz = this.eye.z - oz;
    const len = Math.hypot(dirx, diry, dirz) || 1;
    this.spawnBullet(ox, oy, oz, dirx / len, diry / len, dirz / len, speed, dmg, color);
  }

  // 任意方向へ弾を1発撃つ。
  private spawnBullet(
    ox: number,
    oy: number,
    oz: number,
    nx: number,
    ny: number,
    nz: number,
    speed: number,
    dmg: number,
    color: number
  ): void {
    if (!this.ctx) return;
    const geo = new THREE.SphereGeometry(0.13, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ox, oy, oz);
    this.ctx.scene.add(mesh);
    this.projectiles.push({
      mesh,
      vel: new THREE.Vector3(nx * speed, ny * speed, nz * speed),
      life: BULLET_LIFE,
      dmg,
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

      if (!remove) {
        const hx = b.mesh.position.x - px;
        const hz = b.mesh.position.z - pz;
        if (
          Math.hypot(hx, hz) < 0.6 &&
          b.mesh.position.y > py + 0.2 &&
          b.mesh.position.y < py + 1.9
        ) {
          ctx.health.damage(b.dmg);
          remove = true;
        }
      }

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

  // ===== 残像 =====

  private spawnGhost(x: number, y: number, z: number, scale: number): void {
    if (!this.ctx) return;
    const geo = new THREE.BoxGeometry(0.6 * scale, 1.6 * scale, 0.6 * scale);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xccccff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + 0.8 * scale, z);
    this.ctx.scene.add(mesh);
    this.ghosts.push({ mesh, mat, life: 0.5, maxLife: 0.5 });
  }

  private updateGhosts(dt: number): void {
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.life -= dt;
      g.mat.opacity = Math.max(0, (g.life / g.maxLife) * 0.5);
      if (g.life <= 0) {
        this.disposeGhost(g);
        this.ghosts.splice(i, 1);
      }
    }
  }

  private disposeGhost(g: Ghost): void {
    this.ctx?.scene.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mat.dispose();
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
    if (this.boss && (this.boss.unit.hitbox === obj || this.boss.unit.headHitbox === obj)) {
      this.boss.hp -= dmg;
      if (this.boss.hp <= 0) this.killBoss();
      return;
    }
    const e = this.enemies.find(
      (x) => !x.dead && (x.unit.hitbox === obj || x.unit.headHitbox === obj)
    );
    if (!e) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.killEnemy(e);
  }

  private killEnemy(e: TowerEnemy): void {
    if (e.dead) return;
    e.dead = true;
    this.totalScore += ENEMY_CONFIG[e.type].score;
    if (e.type === "exploder") {
      const p = e.unit.group.position;
      this.explodeAt(p.x, p.y + 0.8, p.z);
    }
  }

  // ボス撃破。ラッシュ中なら次のボスへ、そうでなければ随伴ごと一掃する。
  private killBoss(): void {
    const b = this.boss;
    if (!b) return;
    this.totalScore += 5000;
    this.removeBossUnit(b);
    this.boss = null;

    if (this.rushQueue.length > 0) {
      const next = this.rushQueue.shift() as BossType;
      const idx = RUSH_ORDER.length - this.rushQueue.length; // 1..5
      this.spawnBoss(next, RUSH_HP_MUL, RUSH_SCALE_MUL, `RUSH ${idx}/5`, false);
    } else {
      // 通常ボス撃破：場の随伴・召喚をすべて片付け、ボスHUDを隠す。
      this.clearMinions();
      this.bossHud?.hide();
    }
  }

  private removeBossUnit(b: BossState): void {
    if (!this.ctx) return;
    this.ctx.scene.remove(b.unit.group);
    b.unit.dispose();
    const ti = this.ctx.weapons.enemyTargets.indexOf(b.unit.hitbox);
    if (ti >= 0) this.ctx.weapons.enemyTargets.splice(ti, 1);
    const hi = this.ctx.weapons.enemyTargets.indexOf(b.unit.headHitbox);
    if (hi >= 0) this.ctx.weapons.enemyTargets.splice(hi, 1);
  }

  private explodeAt(x: number, y: number, z: number): void {
    if (!this.ctx) return;
    if (this.ctx.grenadeSystem) this.ctx.grenadeSystem.explodeFragAt(x, y, z);

    const p = this.ctx.player.position;
    const pd = Math.hypot(p.x - x, p.y + 1.0 - y, p.z - z);
    if (pd <= EXPLODER_RADIUS) {
      const falloff = 1 - pd / EXPLODER_RADIUS;
      const dmg = Math.max(EXPLODER_MIN_DAMAGE, Math.round(EXPLODER_MAX_DAMAGE * falloff));
      this.ctx.health.damage(dmg);
    }

    for (const other of this.enemies) {
      if (other.dead || other.type !== "exploder") continue;
      const od = Math.hypot(
        other.unit.group.position.x - x,
        other.unit.group.position.z - z
      );
      if (od <= EXPLODER_RADIUS) this.killEnemy(other);
    }
  }

  private flushDead(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        this.removeFromField(e);
        this.enemies.splice(i, 1);
      }
    }
  }

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

  // 場の雑魚（随伴・召喚）をすべて取り除く。
  private clearMinions(): void {
    for (const e of this.enemies) this.removeFromField(e);
    this.enemies = [];
  }

  getMeleeTargets(): MeleeTarget[] {
    const list = makeMeleeTargets(this.enemies, (e) => this.killEnemy(e));
    if (this.boss) list.push(this.bossMeleeTarget(this.boss));
    return list;
  }

  // ボスを近接攻撃の対象として公開する。
  private bossMeleeTarget(b: BossState): MeleeTarget {
    return {
      position: b.unit.group.position,
      isAlive: () => this.boss === b && b.hp > 0,
      applyDamage: (damage: number) => {
        if (this.boss !== b) return false;
        b.hp -= damage;
        if (b.hp <= 0) {
          this.killBoss();
          return true;
        }
        return false;
      },
      applyKnockback: (vx: number, vz: number, stagger?: number, tilt?: number) =>
        b.unit.applyKnockback(vx, vz, stagger, tilt),
      applyStagger: (seconds: number) => b.unit.applyStagger(seconds),
    };
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
    this.bossHud?.hide();
    this.hud?.clearCenter();
    // 画面を白くフェードさせてから結果を表示する（BGM停止APIは未露出のため省略）。
    this.hud?.showClearFade();
    const sec = Math.round(this.elapsedMs / 1000);
    const ctx = this.ctx;
    const score = this.totalScore;
    window.setTimeout(() => {
      ctx?.finish(
        ["TOWER CLEARED", `クリアタイム ${fmtTime(sec)}`, `総スコア ${score}`],
        true
      );
    }, 1300);
  }

  private die(ctx: GameContext): void {
    if (this.phase === "dead") return;
    this.phase = "dead";
    this.clearField();
    this.bossHud?.hide();
    ctx.finish(
      [
        "TOWER 失敗",
        `到達 ${this.currentFloor} / ${MAX_FLOOR} 層`,
        `総スコア ${this.totalScore}`,
      ],
      true
    );
  }

  private clearField(): void {
    if (!this.ctx) return;
    for (const e of this.enemies) this.removeFromField(e);
    this.enemies = [];
    for (const b of this.projectiles) this.disposeProjectile(b);
    this.projectiles = [];
    for (const g of this.ghosts) this.disposeGhost(g);
    this.ghosts = [];
    if (this.boss) {
      this.removeBossUnit(this.boss);
      this.boss = null;
    }
    this.rushQueue = [];
    this.bossHud?.hide();
  }

  private updateHud(): void {
    if (!this.hud) return;
    this.hud.setTimer(fmtTime(Math.round(this.elapsedMs / 1000)));
    this.hud.setHeader(this.currentFloor, MAX_FLOOR, this.remaining(), this.totalScore);
    if (this.boss) {
      this.bossHud?.show(this.boss.label);
      this.bossHud?.setHp(this.boss.hp, this.boss.maxHp);
    } else {
      this.bossHud?.hide();
    }
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
    this.bossHud?.dispose();
    this.bossHud = null;
    this.ctx = null;
  }
}

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
