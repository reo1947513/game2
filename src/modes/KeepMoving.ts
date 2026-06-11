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

// ===== 確定値（あとで調整しやすいよう分離） =====
const KEEP_MOVING_SPEED_THRESHOLD = 2.5; // 水平速度がこの値以下で停止ペナルティのカウント開始
const KEEP_MOVING_DAMAGE_PER_SEC = 18; // 猶予後、毎秒このダメージ
const KEEP_MOVING_GRACE = 0.8; // 閾値を下回ってからダメージ開始までの猶予（秒）
const REGEN_DELAY = 4.0; // 最終被弾からこの秒数後に回復開始
const REGEN_PER_SEC = 9; // 回復速度

const HISCORE_KEY = "arena_strike_keepmoving_hiscore";
const MAXWAVE_KEY = "arena_strike_keepmoving_maxwave";

// 1体ぶんの敵
interface ModeEnemy {
  unit: EnemyUnit;
  hp: number;
  speed: number;
  floorY: number;
}

// KEEP MOVING：止まると死ぬサバイバル。動き撃ちの精度を試す。
// 速度監視は playerId を取れる純関数に分離し、将来のPVP拡張に備える。
export class KeepMoving implements GameMode, MeleeTargetProvider {
  id = "keepmoving";
  label = "KEEP MOVING";
  description = "止まると死ぬ。走り続けて敵を倒し、できる限り生き延びる。";

  private ctx: GameContext | null = null;
  private hud: ModeHUD | null = null;

  private phase: "countdown" | "playing" | "dead" = "countdown";
  private countdown = 3.0;
  private survivalT = 0;
  private bound = 55; // スポーンの座標クランプ範囲

  private enemies: ModeEnemy[] = [];
  private wave = 0;
  private score = 0;
  private combo = 0;
  private totalKills = 0;

  private slowTimer = 0; // 閾値を下回っている継続時間
  private wasSlow = false;
  private lastDamageAt = -999;
  private beepTimer = 0;
  private moveTimer = 0; // 連続移動時間
  private longestMove = 0;

  private nextContactTime = 0;
  private hpMul = 1;
  private speedMul = 1;
  private countMul = 1;

  enter(ctx: GameContext, now: number): void {
    this.ctx = ctx;
    this.phase = "countdown";
    this.countdown = 3.0;
    this.survivalT = 0;
    this.enemies = [];
    this.wave = 0;
    this.score = 0;
    this.combo = 0;
    this.totalKills = 0;
    this.slowTimer = 0;
    this.wasSlow = false;
    this.lastDamageAt = now;
    this.beepTimer = 0;
    this.moveTimer = 0;
    this.longestMove = 0;
    this.nextContactTime = now;

    const hard = ctx.difficulty === "hard";
    this.hpMul = hard ? 1.5 : 1;
    this.speedMul = hard ? 1.3 : 1;
    this.countMul = hard ? 1.3 : 1;
    this.bound = ctx.stage.stageId === "dusk" ? 28 : 55;

    ctx.health.reset(100);
    ctx.health.show();
    ctx.meleeProvider = this;
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(true);
      ctx.grenadeSystem.reset();
    }
    ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg, now);

    this.hud = new ModeHUD();
    this.hud.setCenter("3", "#ffffff");
    this.hud.setInfo(["KEEP MOVING"]);
    ctx.ui.showHud(false);
  }

  update(ctx: GameContext, dt: number, now: number): void {
    if (this.phase === "dead") return;

    if (this.phase === "countdown") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (this.countdown <= 0) {
        if (this.hud) {
          this.hud.setCenter("GO", "#46d36a");
          window.setTimeout(() => this.hud?.clearCenter(), 500);
        }
        this.phase = "playing";
        this.startWave(now);
      } else if (this.hud) {
        this.hud.setCenter(String(Math.max(1, n)), "#ffffff");
      }
      // カウントダウン中も移動可能・敵更新はまだ
      return;
    }

    this.survivalT += dt;

    // ----- 速度監視（停止ペナルティ） -----
    const speed = ctx.player.horizontalSpeed;
    const slow = isUnderSpeed(speed);
    if (slow) {
      this.moveTimer = 0;
      if (!this.wasSlow && ctx.sound) ctx.sound.warningTone();
      this.slowTimer += dt;
      if (this.slowTimer <= KEEP_MOVING_GRACE) {
        this.hud?.setPulse(1); // 猶予中はパルスのみ
      } else {
        this.hud?.setPulse(2);
        ctx.health.damage(KEEP_MOVING_DAMAGE_PER_SEC * dt);
        this.lastDamageAt = now;
        this.combo = 0; // 停止ペナルティでコンボ即リセット
        this.beepTimer -= dt;
        if (this.beepTimer <= 0) {
          ctx.sound?.beep();
          this.beepTimer = 0.25;
        }
      }
    } else {
      this.slowTimer = 0;
      this.hud?.setPulse(0);
      this.moveTimer += dt;
      if (this.moveTimer > this.longestMove) this.longestMove = this.moveTimer;
      // 最終被弾から一定時間でHP回復
      if (now - this.lastDamageAt > REGEN_DELAY) {
        ctx.health.heal(REGEN_PER_SEC * dt);
      }
    }
    this.wasSlow = slow;

    // ----- 敵の更新 -----
    const eye = ctx.player.position;
    let contacting = false;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dx = eye.x - e.unit.group.position.x;
      const dz = eye.z - e.unit.group.position.z;
      const d = Math.hypot(dx, dz);
      e.unit.faceTo(dx, dz);
      if (e.unit.staggerTimer > 0) {
        e.unit.updateKnockback(dt, ctx.stage.colliders, this.bound);
        e.unit.update(dt, "idle");
      } else {
        if (d > 1.0) {
          e.unit.moveToward(eye.x, eye.z, e.speed, dt, ctx.stage.colliders);
        }
        e.unit.update(dt, d < 1.6 ? "attack" : "walk");
      }
      e.unit.group.position.y = e.floorY; // 段差のある床に置いた敵の高さを保つ
      if (d < 1.4 && Math.abs(e.floorY - eye.y) < 2.0) contacting = true;
    }
    resolveBodyCollisions(this.enemies.map((e) => e.unit), ctx.player);

    // 接触ダメージ
    if (contacting && now >= this.nextContactTime) {
      ctx.health.damage(10);
      this.lastDamageAt = now;
      this.nextContactTime = now + 0.8;
    }

    // 死亡判定
    if (ctx.health.isDead()) {
      this.die(ctx);
      return;
    }

    // ウェーブ全滅で次へ
    if (this.enemies.length === 0) {
      this.score += this.wave * 500; // ウェーブクリアボーナス
      this.startWave(now);
    }

    this.updateHud(speed);
  }

  // ----- ウェーブ開始 -----
  private startWave(now: number): void {
    if (!this.ctx) return;
    this.wave += 1;

    // 敵数：wave1=4, wave2=6, wave3=8, wave4+ は +2 ずつ
    let count = 4 + Math.max(0, this.wave - 1) * 2;
    if (this.wave === 2) count = 6;
    if (this.wave === 3) count = 8;
    count = Math.round(count * this.countMul);

    // 速度係数：wave×0.08（上限×1.8）。wave2では2体を高速タイプにする。
    const waveSpeedCoef = Math.min(1.8, 1 + this.wave * 0.08);

    for (let i = 0; i < count; i++) {
      const fast = (this.wave === 2 && i < 2) || (this.wave >= 4 && i % 4 === 0);
      const speed = (fast ? 5.6 : 3.4) * this.speedMul * (this.wave >= 3 ? waveSpeedCoef : 1);
      const hp = (fast ? 60 : 80) * this.hpMul;
      this.spawnForward(speed, hp, fast, now, i, count);
    }
  }

  // プレイヤーの移動方向前方を優先してスポーンする（逃げながら前を向くと湧く緊張感）。
  private spawnForward(
    speed: number,
    hp: number,
    fast: boolean,
    now: number,
    index: number,
    count: number
  ): void {
    if (!this.ctx) return;
    const p = this.ctx.player;
    const v = p.velocity;
    const sp = Math.hypot(v.x, v.z);
    let baseAng: number;
    if (sp > 1) baseAng = Math.atan2(v.z, v.x);
    else baseAng = ((index / count) * Math.PI * 2); // 静止時は全方位へ散らす
    // wave3は全方位同時、それ以外は前方コーンに寄せる
    const spread = this.wave === 3 ? Math.PI : 0.7;
    const ang = baseAng + (Math.random() * 2 - 1) * spread;
    const dist = 8 + Math.random() * 8;
    let x = p.position.x + Math.cos(ang) * dist;
    let z = p.position.z + Math.sin(ang) * dist;
    x = clamp(x, -this.bound, this.bound);
    z = clamp(z, -this.bound, this.bound);
    this.spawnEnemy(x, z, 0, hp, speed, fast, now);
  }

  private spawnEnemy(
    x: number,
    z: number,
    floorY: number,
    hp: number,
    speed: number,
    fast: boolean,
    _now: number
  ): void {
    if (!this.ctx) return;
    const unit = new EnemyUnit({
      bodyColor: fast ? 0x3a1f1f : 0x23262e,
      accentColor: fast ? 0xff3a3a : 0xff6a00,
      scale: fast ? 0.9 : 1,
    });
    unit.setGround(x, z);
    unit.group.position.y = floorY;
    this.ctx.scene.add(unit.group);
    this.ctx.weapons.enemyTargets.push(unit.hitbox);
    this.ctx.weapons.enemyTargets.push(unit.headHitbox);
    this.enemies.push({ unit, hp, speed, floorY });
  }

  // 射撃のヒット処理
  private onHit(obj: THREE.Object3D, dmg: number, now: number): void {
    const e = this.enemies.find(
      (x) => x.unit.hitbox === obj || x.unit.headHitbox === obj
    );
    if (!e) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.killEnemy(e, now);
  }

  private killEnemy(e: ModeEnemy, _now: number): void {
    if (!this.ctx) return;
    const idx = this.enemies.indexOf(e);
    if (idx < 0) return;
    this.enemies.splice(idx, 1);
    this.ctx.scene.remove(e.unit.group);
    const ti = this.ctx.weapons.enemyTargets.indexOf(e.unit.hitbox);
    if (ti >= 0) this.ctx.weapons.enemyTargets.splice(ti, 1);
    const hi = this.ctx.weapons.enemyTargets.indexOf(e.unit.headHitbox);
    if (hi >= 0) this.ctx.weapons.enemyTargets.splice(hi, 1);
    e.unit.dispose();

    // スコア：撃破100＋コンボ（止まらず連続撃破した数）×50
    this.combo += 1;
    this.totalKills += 1;
    this.score += 100 + this.combo * 50;
  }

  // 近接システムへ敵を公開する
  getMeleeTargets(): MeleeTarget[] {
    return makeMeleeTargets(this.enemies, (e) => this.killEnemy(e, 0));
  }

  private updateHud(speed: number): void {
    if (!this.hud) return;
    this.hud.setTimer(this.survivalT.toFixed(1));
    this.hud.setInfo([
      `WAVE ${this.wave}`,
      `SCORE ${this.score}`,
      `COMBO x${this.combo}`,
      `SPEED ${speed.toFixed(1)}`,
    ]);
  }

  private die(ctx: GameContext): void {
    this.phase = "dead";
    const best = loadInt(HISCORE_KEY);
    const bestWave = loadInt(MAXWAVE_KEY);
    const newBest = this.score > best;
    if (newBest) saveInt(HISCORE_KEY, this.score);
    if (this.wave > bestWave) saveInt(MAXWAVE_KEY, this.wave);
    this.hud?.setPulse(0);
    if (newBest) this.hud?.flashBest();

    ctx.finish(
      [
        "KEEP MOVING 結果",
        `スコア ${this.score}` + (newBest ? "（ベスト更新！）" : ""),
        `最大ウェーブ ${this.wave}`,
        `総撃破 ${this.totalKills}`,
        `最長連続移動 ${this.longestMove.toFixed(1)} 秒`,
        `ハイスコア ${Math.max(best, this.score)}`,
      ],
      true
    );
  }

  onPlayerDeath(): void {
    // 死亡判定は update 内で行う（health.isDead）。
  }

  exit(ctx: GameContext): void {
    for (const e of this.enemies) {
      ctx.scene.remove(e.unit.group);
      const ti = ctx.weapons.enemyTargets.indexOf(e.unit.hitbox);
      if (ti >= 0) ctx.weapons.enemyTargets.splice(ti, 1);
      const hi = ctx.weapons.enemyTargets.indexOf(e.unit.headHitbox);
      if (hi >= 0) ctx.weapons.enemyTargets.splice(hi, 1);
      e.unit.dispose();
    }
    this.enemies = [];
    ctx.weapons.enemyHitHook = null;
    ctx.meleeProvider = null;
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(false);
      ctx.grenadeSystem.clear();
    }
    ctx.health.hide();
    this.hud?.dispose();
    this.hud = null;
    this.ctx = null;
  }
}

// 速度監視（将来のPVP拡張に備え playerId を取れる純関数として分離）。
function isUnderSpeed(horizontalSpeed: number, _playerId = 0): boolean {
  return horizontalSpeed <= KEEP_MOVING_SPEED_THRESHOLD;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function loadInt(key: string, def = 0): number {
  const v = localStorage.getItem(key);
  if (!v) return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function saveInt(key: string, val: number): void {
  localStorage.setItem(key, String(Math.round(val)));
}
