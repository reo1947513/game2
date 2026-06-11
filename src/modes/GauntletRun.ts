import * as THREE from "three";
import {
  GameMode,
  GameContext,
  makeMeleeTargets,
  resolveBodyCollisions,
} from "../GameModes";
import { EnemyUnit } from "../Enemy";
import { StageId } from "../Stage";
import { MeleeTarget, MeleeTargetProvider } from "../combat/MeleeTarget";
import { ModeHUD } from "../ui/ModeHUD";

type Route = "fixed" | "free";

// チェックポイント／ゾーン1つ分。cluster は敵の配置 [x, z, floorY]。
interface Gate {
  x: number;
  y: number; // CP柱の基準床高さ（通過の縦判定に使う）
  z: number;
  cluster: Array<[number, number, number]>;
}

interface ModeEnemy {
  unit: EnemyUnit;
  hp: number;
  speed: number;
  floorY: number;
}

// GAUNTLET RUN：ルート上の敵を全員倒しながら最短タイムで駆け抜ける。
// 壁ジャンや屋上経由の立体移動を使うほどタイムが縮む（移動スキルが直接スコアに影響）。
export class GauntletRun implements GameMode, MeleeTargetProvider {
  id: string;
  label: string;
  description: string;

  private route: Route;
  private ctx: GameContext | null = null;
  private hud: ModeHUD | null = null;

  private phase: "countdown" | "running" | "done" = "countdown";
  private countdown = 3.0;
  private elapsedMs = 0;

  private enemies: ModeEnemy[] = [];
  private gates: Gate[] = [];
  private goalPos: [number, number, number] = [0, 0, 0];
  private bound = 60;

  // FIXED 用
  private activeGate = 0;
  private gateMeshes: THREE.Mesh[] = [];
  // FREE 用
  private goalMesh: THREE.Mesh | null = null;
  private goalOpen = false;

  private hpMul = 1;
  private speedMul = 1;
  private hard = false;
  private nextContactTime = 0;

  constructor(route: Route) {
    this.route = route;
    this.id = `gauntlet_${route}`;
    this.label = route === "fixed" ? "GAUNTLET RUN（固定ルート）" : "GAUNTLET RUN（自由）";
    this.description =
      route === "fixed"
        ? "番号順のチェックポイントを辿り、各ゾーンの敵を倒して最短タイムでゴール。"
        : "全敵を自由ルートで撃破し、北端のゴール光柱へ。";
  }

  enter(ctx: GameContext, now: number): void {
    this.ctx = ctx;
    this.phase = "countdown";
    this.countdown = 3.0;
    this.elapsedMs = 0;
    this.enemies = [];
    this.activeGate = 0;
    this.gateMeshes = [];
    this.goalMesh = null;
    this.goalOpen = false;
    this.nextContactTime = now;

    this.hard = ctx.difficulty === "hard";
    this.hpMul = this.hard ? 1.5 : 1;
    this.speedMul = this.hard ? 1.3 : 1;
    this.bound = ctx.stage.stageId === "dusk" ? 28 : 60;

    const cfg = this.buildConfig(ctx.stage.stageId);
    this.gates = cfg.gates;
    this.goalPos = cfg.goal;

    ctx.health.reset(100);
    ctx.health.show();
    ctx.meleeProvider = this;
    if (ctx.grenadeSystem) {
      ctx.grenadeSystem.setEnabled(true);
      ctx.grenadeSystem.reset();
    }
    ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg, now);
    ctx.ui.showHud(false);

    this.hud = new ModeHUD();
    this.hud.setCenter("3", "#ffffff");

    if (this.route === "fixed") {
      // 全CP柱を作り（ロック色）、最初のゾーンの敵を出す
      for (const g of this.gates) this.gateMeshes.push(this.makeCylinder(g.x, g.y, g.z, 0xff4040));
      this.spawnCluster(this.gates[0]);
    } else {
      // 全ゾーンの敵を撒き、北端にゴール光柱（ロック）を置く
      for (const g of this.gates) this.spawnCluster(g);
      this.goalMesh = this.makeCylinder(this.goalPos[0], this.goalPos[1], this.goalPos[2], 0xff4040, 5);
    }
    this.updateHud();
  }

  update(ctx: GameContext, dt: number, now: number): void {
    if (this.phase === "done") return;

    if (this.phase === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.hud?.setCenter("GO", "#46d36a");
        window.setTimeout(() => this.hud?.clearCenter(), 500);
        this.phase = "running";
      } else {
        this.hud?.setCenter(String(Math.max(1, Math.ceil(this.countdown))), "#ffffff");
      }
      return;
    }

    this.elapsedMs += dt * 1000;
    this.updateEnemies(ctx, dt, now);

    if (ctx.health.isDead()) {
      this.die(ctx);
      return;
    }

    if (this.route === "fixed") this.updateFixed(ctx);
    else this.updateFree(ctx);

    this.updateHud();
  }

  // ----- FIXED：ゾーン制圧→CP通過 -----
  private updateFixed(ctx: GameContext): void {
    const gate = this.gates[this.activeGate];
    if (!gate) return;
    const open = this.enemies.length === 0; // 現ゾーンの敵は全てこのゲートのもの
    const mesh = this.gateMeshes[this.activeGate];
    if (mesh) {
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.color.set(open ? 0x46d36a : 0xff4040);
    }
    if (open && this.inGate(ctx, gate)) {
      // CP通過：柱を消して次へ
      if (mesh) {
        this.ctx?.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      this.activeGate += 1;
      if (this.activeGate >= this.gates.length) {
        this.win(ctx);
        return;
      }
      this.spawnCluster(this.gates[this.activeGate]);
    }
  }

  // ----- FREE：全敵撃破→ゴール解放 -----
  private updateFree(ctx: GameContext): void {
    if (!this.goalOpen && this.enemies.length === 0) {
      this.goalOpen = true;
      if (this.goalMesh) (this.goalMesh.material as THREE.MeshBasicMaterial).color.set(0xffd23a);
    }
    if (this.goalOpen) {
      const g: Gate = { x: this.goalPos[0], y: this.goalPos[1], z: this.goalPos[2], cluster: [] };
      if (this.inGate(ctx, g)) this.win(ctx);
    }
  }

  // CP/ゴールの円柱内にプレイヤーがいるか（水平半径＋縦範囲）。
  private inGate(ctx: GameContext, g: Gate): boolean {
    const p = ctx.player.position;
    const d = Math.hypot(p.x - g.x, p.z - g.z);
    return d < 1.8 && p.y > g.y - 1.2 && p.y < g.y + 3.6;
  }

  private updateEnemies(ctx: GameContext, dt: number, now: number): void {
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
        if (d > 1.0) e.unit.moveToward(eye.x, eye.z, e.speed, dt, ctx.stage.colliders);
        e.unit.update(dt, d < 1.6 ? "attack" : "walk");
      }
      e.unit.group.position.y = e.floorY;
      if (d < 1.4 && Math.abs(e.floorY - eye.y) < 2.0) contacting = true;
    }
    // プレイヤーと同じ高さ（同フロア）の敵だけ押し出し対象にする（別階の敵で誤って
    // プレイヤーが押されるのを防ぐ）。
    const py = ctx.player.position.y;
    resolveBodyCollisions(
      this.enemies.filter((e) => Math.abs(e.floorY - py) < 2.5).map((e) => e.unit),
      ctx.player
    );
    if (contacting && now >= this.nextContactTime) {
      ctx.health.damage(8);
      this.nextContactTime = now + 0.8;
    }
  }

  private spawnCluster(gate: Gate): void {
    if (!this.ctx) return;
    const extra = this.hard ? Math.round(gate.cluster.length * 0.3) : 0;
    const positions = gate.cluster.slice();
    for (let i = 0; i < extra; i++) {
      const base = gate.cluster[i % gate.cluster.length];
      positions.push([base[0] + (Math.random() * 2 - 1) * 2, base[1] + (Math.random() * 2 - 1) * 2, base[2]]);
    }
    for (const [x, z, floorY] of positions) {
      this.spawnEnemy(x, z, floorY);
    }
  }

  private spawnEnemy(x: number, z: number, floorY: number): void {
    if (!this.ctx) return;
    const unit = new EnemyUnit({ bodyColor: 0x262a33, accentColor: 0xff7b1c, scale: 1 });
    unit.setGround(x, z);
    unit.group.position.y = floorY;
    this.ctx.scene.add(unit.group);
    this.ctx.weapons.enemyTargets.push(unit.hitbox);
    this.ctx.weapons.enemyTargets.push(unit.headHitbox);
    this.enemies.push({ unit, hp: 80 * this.hpMul, speed: 3.2 * this.speedMul, floorY });
  }

  private onHit(obj: THREE.Object3D, dmg: number, now: number): void {
    const e = this.enemies.find(
      (x) => x.unit.hitbox === obj || x.unit.headHitbox === obj
    );
    if (!e) return;
    e.hp -= dmg;
    if (e.hp <= 0) this.killEnemy(e);
    void now;
  }

  private killEnemy(e: ModeEnemy): void {
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
  }

  getMeleeTargets(): MeleeTarget[] {
    return makeMeleeTargets(this.enemies, (e) => this.killEnemy(e));
  }

  // 半透明の光柱（CP/ゴール）を作る
  private makeCylinder(x: number, y: number, z: number, color: number, height = 3): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(1, 1, height, 16, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + height / 2, z);
    this.ctx?.scene.add(m);
    return m;
  }

  private win(ctx: GameContext): void {
    this.phase = "done";
    const key = this.bestKey(ctx);
    const ms = Math.round(this.elapsedMs);
    const prev = loadInt(key, 0);
    const newBest = prev === 0 || ms < prev;
    if (newBest) saveInt(key, ms);
    if (newBest) this.hud?.flashBest();

    ctx.finish(
      [
        "GAUNTLET RUN クリア",
        `タイム ${fmtTime(ms)}` + (newBest ? "（ベスト更新！）" : ""),
        `ベスト ${fmtTime(newBest ? ms : prev)}`,
      ],
      true
    );
  }

  private die(ctx: GameContext): void {
    this.phase = "done";
    ctx.finish(["GAUNTLET RUN 失敗", "倒れてしまった…", "リスタートで再挑戦"], true);
  }

  onPlayerDeath(): void {
    // 死亡判定は update 内（health.isDead）で行う。
  }

  private bestKey(ctx: GameContext): string {
    const diff = this.hard ? "hard" : "normal";
    const r = this.route === "fixed" ? "fixed" : "free";
    return `arena_strike_gauntlet_${r}_best_${ctx.stage.stageId}_${diff}`;
  }

  private updateHud(): void {
    if (!this.hud) return;
    this.hud.setTimer(fmtTime(Math.round(this.elapsedMs)));
    if (this.route === "fixed") {
      this.hud.setInfo([
        `CP ${Math.min(this.activeGate + 1, this.gates.length)} / ${this.gates.length}`,
        `残り敵 ${this.enemies.length}`,
      ]);
    } else {
      this.hud.setInfo([`残り敵 ${this.enemies.length}`, this.goalOpen ? "ゴール解放！" : "全敵を撃破せよ"]);
    }
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
    for (const m of this.gateMeshes) {
      ctx.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.gateMeshes = [];
    if (this.goalMesh) {
      ctx.scene.remove(this.goalMesh);
      this.goalMesh.geometry.dispose();
      (this.goalMesh.material as THREE.Material).dispose();
      this.goalMesh = null;
    }
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

  // ステージ別の CP / 敵クラスター / ゴール配置
  private buildConfig(stageId: StageId): { gates: Gate[]; goal: [number, number, number] } {
    if (stageId === "skyframe") {
      // 縦ルート：地上→1F→2F→3F→屋上→北端へ降下。上階の敵は床の高さに置く。
      const gates: Gate[] = [
        { x: 0, y: 0, z: 28, cluster: [[3, 28, 0], [-3, 28, 0], [0, 32, 0]] },
        { x: 0, y: 0, z: 5, cluster: [[3, 6, 0], [-3, 6, 0], [0, 9, 0]] },
        { x: 0, y: 3.6, z: 0, cluster: [[4, 2, 3.6], [-4, 2, 3.6], [0, -3, 3.6]] },
        { x: 8, y: 7.2, z: 2, cluster: [[8, 5, 7.2], [10, -1, 7.2], [6, -4, 7.2]] },
        { x: 0, y: 10.8, z: -6, cluster: [[4, -8, 10.8], [-4, -8, 10.8], [0, -11, 10.8]] },
        { x: 0, y: 0, z: -55, cluster: [] }, // ゴール（北ヤード）
      ];
      return { gates, goal: [0, 0, -58] };
    }
    // dusk（平坦寄り）：地上中心の簡易ルート。
    const gates: Gate[] = [
      { x: 0, y: 0, z: 12, cluster: [[3, 12, 0], [-3, 12, 0]] },
      { x: 12, y: 0, z: 0, cluster: [[12, 3, 0], [10, -3, 0]] },
      { x: -10, y: 0, z: -8, cluster: [[-10, -8, 0], [-13, -5, 0]] },
      { x: 22, y: 0, z: -10, cluster: [[22, -10, 0], [25, -7, 0]] },
      { x: 0, y: 0, z: -24, cluster: [] }, // ゴール（北）
    ];
    return { gates, goal: [0, 0, -26] };
  }
}

function fmtTime(ms: number): string {
  const total = Math.max(0, ms);
  const s = Math.floor(total / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  const cc = Math.floor((total % 1000) / 10);
  return `${mm}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
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
