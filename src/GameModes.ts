import * as THREE from "three";
import { Stage, Target } from "./Stage";
import { WeaponSystem } from "./WeaponSystem";
import { ModeUI } from "./ModeUI";

// 各モードがゲームの中身へ触るための入口をまとめたものです。
export interface GameContext {
  scene: THREE.Scene;
  stage: Stage;
  weapons: WeaponSystem;
  ui: ModeUI;
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
