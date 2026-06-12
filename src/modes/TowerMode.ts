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
// 段階実装の現在地（タスク3）：
//   - フロアの状態機械（カウントダウン→Wave→休憩→次層→…→クリア）  ※タスク2
//   - 敵6種のスポーン・見た目・ステータス・基本接近・撃破・全滅判定    ※タスク3（本コミット）
// 残り：
//   - 敵6種の固有行動（遠距離射撃・爆発・召喚など）                  ※タスク4
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
  attackInterval: number; // 接触ダメージの最小間隔（秒）
  score: number; // 撃破スコア
}

const STANDARD_SPEED = 3.0; // 標準タイプの基準速度（m/s）

const ENEMY_CONFIG: Record<EnemyType, EnemyConfig> = {
  // 標準：バランス型（オレンジ）
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
  // 高速：細く速く脆い（明るい赤）
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
  // タンク：大きく遅く硬い（灰青）
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
  // 遠距離：中距離から撃つ（青紫）。射撃はタスク4で実装。
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
  // 爆発：接触ダメージなし、死亡時に爆発（オレンジ）。爆発はタスク4で実装。
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
  // 召喚：遅く硬めで雑魚を呼ぶ（紫）。召喚はタスク4で実装。
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

// 90層は「全ボスの縮小版ラッシュ」を表す特別マーカー。
type BossKind = BossType | "rush";

// 1フロアのボス配置情報。hpMul は強化フロアでのHP倍率。
interface BossSlot {
  kind: BossKind;
  hpMul: number;
  label: string;
}

// フロアの進行フェーズ。
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
  attackCd: number; // 次に接触ダメージを与えられるまでの残り秒数
}

const MAX_FLOOR = 100;
const REST_SECONDS = 5;
const COUNTDOWN_SECONDS = 3;
const ARENA_BOUND = 28; // 敵を収めるおおまかな範囲（±）

// 10層ごとのボス配置表（section 1 のフロア構成に準拠）。
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
  private eye = new THREE.Vector3();

  // ボスフロアの暫定プレースホルダ（タスク5で実ボスに置換）。
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

  // 現フロアの残り討伐対象数（敵＋暫定ボス）。
  private remaining(): number {
    return this.enemies.length + (this.bossPlaceholderActive ? 1 : 0);
  }

  // フロア開始。
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

  // 通常Waveの敵数 = 4 + floor*2（section 1）。
  private waveEnemyCount(floor: number): number {
    return 4 + floor * 2;
  }

  // 層に応じた敵種別の出現比率（RATIO_KEYS の間は線形補間）。
  private ratioFor(floor: number): number[] {
    const f = Math.max(RATIO_KEYS[0], Math.min(RATIO_KEYS[RATIO_KEYS.length - 1], floor));
    // 上下のキーを探す。
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

  // 比率に従って敵種を1つ抽選する。
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

  // 通常Waveのスポーン。比率に従って waveEnemyCount 体を生成する。
  private spawnWave(floor: number): void {
    const count = this.waveEnemyCount(floor);
    for (let i = 0; i < count; i++) {
      this.spawnEnemy(this.pickType(floor), floor);
    }
  }

  // 敵を1体生成してフィールドへ出す。
  // hpScaleFloor: HPを層に応じて少しずつ底上げする（後半フロアの歯ごたえ確保）。
  private spawnEnemy(type: EnemyType, floor: number): TowerEnemy | null {
    if (!this.ctx) return null;
    const cfg = ENEMY_CONFIG[type];

    this.ctx.player.getEyePosition(this.eye);
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.random() * 4;
    const x = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.eye.x + Math.cos(angle) * dist));
    const z = Math.max(-ARENA_BOUND, Math.min(ARENA_BOUND, this.eye.z + Math.sin(angle) * dist));

    const unit = new EnemyUnit({
      scale: cfg.scale,
      bodyColor: cfg.bodyColor,
      accentColor: cfg.accentColor,
    });
    unit.setGround(x, z);
    this.ctx.scene.add(unit.group);
    this.ctx.weapons.enemyTargets.push(unit.hitbox);
    this.ctx.weapons.enemyTargets.push(unit.headHitbox);

    // 層が上がるごとにHPを緩やかに底上げ（10層ごとに +10%）。
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
      attackCd: 0,
    };
    this.enemies.push(e);
    return e;
  }

  // ボスのスポーン。
  // 【暫定】実ボスの状態機械はタスク5で実装する。ここでは短い待機で消化する
  // プレースホルダとし、フロアが完了できる状態だけを担保する。
  private spawnBoss(_floor: number, slot: BossSlot): void {
    this.bossPlaceholderActive = true;
    this.bossPlaceholderTimer = slot.kind === "rush" ? 1.5 : 1.0;
  }

  // 戦闘フェーズの毎フレーム処理。
  private updateCombat(ctx: GameContext, dt: number): void {
    ctx.player.getEyePosition(this.eye);
    let contactDamage = 0;
    let playerDamaged = false;

    // 敵の更新（撤去が起きても安全なよう後ろから回す）。
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = this.eye.x - e.unit.group.position.x;
      const dz = this.eye.z - e.unit.group.position.z;
      const d = Math.hypot(dx, dz);
      e.unit.faceTo(dx, dz);

      if (e.attackCd > 0) e.attackCd -= dt;

      // よろけ中はAIを止めて吹き飛ばす。
      if (e.unit.staggerTimer > 0) {
        e.unit.updateKnockback(dt, ctx.stage.colliders, ARENA_BOUND);
        e.unit.update(dt, "idle");
        continue;
      }

      // 【タスク3】全種とも基本接近。固有行動はタスク4で分岐実装する。
      if (d > 0.9) {
        e.unit.moveToward(this.eye.x, this.eye.z, e.speed, dt, ctx.stage.colliders);
      }
      e.unit.update(dt, d < 1.5 ? "attack" : "walk");

      // 接触ダメージ（touch=0 の爆発タイプは接触では無害）。
      if (d < 1.3 && e.touch > 0 && e.attackCd <= 0) {
        contactDamage += e.touch;
        e.attackCd = e.attackInterval;
      }
    }

    // 敵同士の重なりとプレイヤーのすり抜けを解消する。
    resolveBodyCollisions(
      this.enemies.map((x) => x.unit),
      ctx.player
    );

    if (contactDamage > 0) {
      ctx.health.damage(contactDamage);
      playerDamaged = true;
    }

    // 暫定ボスの消化。
    if (this.bossPlaceholderActive && this.bossPlaceholderTimer > 0) {
      this.bossPlaceholderTimer -= dt;
      if (this.bossPlaceholderTimer <= 0) {
        this.bossPlaceholderActive = false;
      }
    }

    if (playerDamaged && ctx.health.isDead()) {
      this.die(ctx);
    }
  }

  // 射撃が敵に当たったときのフック。
  private onHit(obj: object, dmg: number): void {
    const e = this.enemies.find(
      (x) => x.unit.hitbox === obj || x.unit.headHitbox === obj
    );
    if (!e) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.removeEnemy(e, true);
  }

  // 敵を1体取り除く。killed=true ならスコアを加算する。
  private removeEnemy(e: TowerEnemy, killed: boolean): void {
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
      this.totalScore += ENEMY_CONFIG[e.type].score;
    }
  }

  // 近接システムへ現在の敵を共通対象として公開する。
  getMeleeTargets(): MeleeTarget[] {
    return makeMeleeTargets(this.enemies, (e) => this.removeEnemy(e, true));
  }

  // フロアクリア時の処理。
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

  // 100層クリア。専用演出はタスク6で実装。
  private clearTower(): void {
    this.phase = "cleared";
    this.clearEnemies();
    const sec = Math.round(this.elapsedMs / 1000);
    this.ctx?.finish(
      [
        "TOWER CLEARED",
        `クリアタイム ${fmtTime(sec)}`,
        `総スコア ${this.totalScore}`,
      ],
      true
    );
  }

  // プレイヤー死亡。
  private die(ctx: GameContext): void {
    if (this.phase === "dead") return;
    this.phase = "dead";
    this.clearEnemies();
    ctx.finish(
      [
        "TOWER 失敗",
        `到達 ${this.currentFloor} / ${MAX_FLOOR} 層`,
        `総スコア ${this.totalScore}`,
      ],
      true
    );
  }

  // フィールド上の敵を一括撤去する。
  private clearEnemies(): void {
    if (!this.ctx) return;
    for (const e of this.enemies) {
      this.ctx.scene.remove(e.unit.group);
      e.unit.dispose();
      const ti = this.ctx.weapons.enemyTargets.indexOf(e.unit.hitbox);
      if (ti >= 0) this.ctx.weapons.enemyTargets.splice(ti, 1);
      const hi = this.ctx.weapons.enemyTargets.indexOf(e.unit.headHitbox);
      if (hi >= 0) this.ctx.weapons.enemyTargets.splice(hi, 1);
    }
    this.enemies = [];
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
    this.clearEnemies();
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

// 秒数を mm:ss 表記にする。
function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
