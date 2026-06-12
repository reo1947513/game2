import * as THREE from "three";
import { DevApp, DevPanel } from "../devTypes";
import { DevTarget, DevTargetKind } from "../DevTarget";

// TARGETS タブ：的の配置（静止／往復／ランダム）と、被弾ダメージログ。
// 的は WeaponSystem.enemyTargets に登録し、enemyHitHook で命中を記録する。
export class TargetsPanel implements DevPanel {
  element: HTMLElement;

  private spawnKind: DevTargetKind = "static";
  private targets: DevTarget[] = [];
  private log: Array<{ head: boolean; text: string }> = [];

  private countEl!: HTMLElement;
  private logEl!: HTMLElement;
  private ray = new THREE.Raycaster();

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
    // 命中フックは DEV RANGE の生存期間中つねに有効にしておく。
    this.app.ctx.weapons.enemyHitHook = (obj, dmg) => this.onHit(obj, dmg);
    this.build();
  }

  private build(): void {
    const cur = document.createElement("div");
    cur.className = "dr-cur";
    cur.textContent = "的を配置（視線の先に出現）";
    this.element.appendChild(cur);

    const kinds = document.createElement("div");
    kinds.className = "dr-stages";
    const defs: Array<{ k: DevTargetKind; label: string }> = [
      { k: "static", label: "静止" },
      { k: "patrol", label: "往復移動" },
      { k: "random", label: "ランダム移動" },
    ];
    const kindBtns: HTMLButtonElement[] = [];
    for (const d of defs) {
      const b = document.createElement("button");
      b.className = "dr-btn" + (d.k === this.spawnKind ? " on" : "");
      b.textContent = d.label;
      b.onclick = () => {
        this.spawnKind = d.k;
        kindBtns.forEach((x, i) => x.classList.toggle("on", defs[i].k === d.k));
      };
      kindBtns.push(b);
      kinds.appendChild(b);
    }
    this.element.appendChild(kinds);

    const actions = document.createElement("div");
    actions.className = "dr-actions";
    actions.appendChild(this.btn("的を追加", () => this.addTarget()));
    actions.appendChild(this.btn("全ての的を削除", () => this.clearAll()));
    actions.appendChild(this.btn("ログクリア", () => this.clearLog()));
    this.countEl = document.createElement("span");
    this.countEl.className = "dr-info";
    actions.appendChild(this.countEl);
    this.element.appendChild(actions);

    this.logEl = document.createElement("div");
    this.logEl.className = "dr-log";
    this.element.appendChild(this.logEl);

    this.refreshCount();
    this.refreshLog();
  }

  private addTarget(): void {
    const ctx = this.app.ctx;
    const dir = new THREE.Vector3();
    ctx.camera.getWorldDirection(dir);
    const origin = new THREE.Vector3();
    ctx.camera.getWorldPosition(origin);
    this.ray.set(origin, dir);
    const hits = this.ray.intersectObjects(ctx.stage.group.children, true);
    let x: number;
    let z: number;
    if (hits.length > 0) {
      x = hits[0].point.x;
      z = hits[0].point.z;
    } else {
      x = origin.x + dir.x * 15;
      z = origin.z + dir.z * 15;
    }

    const t = new DevTarget(ctx.scene, this.spawnKind, x, z);
    ctx.weapons.enemyTargets.push(t.unit.hitbox);
    ctx.weapons.enemyTargets.push(t.unit.headHitbox);
    this.targets.push(t);
    this.refreshCount();
  }

  // DEV RANGE 終了時：全的削除＋命中フック解除。
  dispose(): void {
    this.clearAll();
    this.app.ctx.weapons.enemyHitHook = null;
  }

  private clearAll(): void {
    const ctx = this.app.ctx;
    for (const t of this.targets) {
      this.removeFromTargets(t.unit.hitbox);
      this.removeFromTargets(t.unit.headHitbox);
      t.dispose(ctx.scene);
    }
    this.targets = [];
    this.refreshCount();
  }

  private removeFromTargets(obj: THREE.Object3D): void {
    const arr = this.app.ctx.weapons.enemyTargets;
    const i = arr.indexOf(obj);
    if (i >= 0) arr.splice(i, 1);
  }

  private onHit(obj: THREE.Object3D, dmg: number): void {
    const t = this.targets.find((x) => x.owns(obj));
    if (!t) return;
    const now = performance.now() / 1000;
    const head = t.isHead(obj);
    t.takeHit(dmg, now);

    const ctx = this.app.ctx;
    const dist = ctx.camera.position.distanceTo(t.unit.group.position);
    const weapon = ctx.weapons.devSpec(ctx.weapons.devCurrentKind()).displayName;
    const tag = head ? "HEADSHOT" : "BODY";
    this.log.unshift({
      head,
      text: `[${tag}] ${weapon}  ${Math.round(dmg)} dmg  ${dist.toFixed(1)}m`,
    });
    if (this.log.length > 10) this.log.pop();
    this.refreshLog();
  }

  private clearLog(): void {
    this.log = [];
    this.refreshLog();
  }

  private refreshCount(): void {
    this.countEl.textContent = `的の数: ${this.targets.length}`;
  }

  private refreshLog(): void {
    this.logEl.innerHTML = "";
    for (const e of this.log) {
      const line = document.createElement("div");
      if (e.head) line.className = "hs";
      line.textContent = e.text;
      this.logEl.appendChild(line);
    }
  }

  // タブに関わらず DevRange から毎フレーム呼ばれる（的の移動とHPバー更新）。
  update(dt: number, now: number): void {
    const ctx = this.app.ctx;
    for (const t of this.targets) t.update(dt, now, ctx.stage.colliders, ctx.camera);
  }

  private btn(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "dr-btn";
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }
}
