import * as THREE from "three";
import { DevApp, DevPanel } from "../devTypes";
import { DevTarget, DevTargetKind } from "../DevTarget";
import { loadSurvivor, survivorSkins } from "../CharacterModels";

// TARGETS タブ：的の配置（静止／往復／ランダム）と、被弾ダメージログ。
// 的は WeaponSystem.enemyTargets に登録し、enemyHitHook で命中を記録する。
export class TargetsPanel implements DevPanel {
  element: HTMLElement;

  private spawnKind: DevTargetKind = "static";
  private targets: DevTarget[] = [];
  // 配置した実キャラモデル（試着）
  private chars: THREE.Group[] = [];
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

    // キャラモデル配置（実モデル試着・テスト環境）
    const charHead = document.createElement("div");
    charHead.className = "dr-cur";
    charHead.style.marginTop = "8px";
    charHead.textContent = "キャラモデル配置（実モデル試着）";
    this.element.appendChild(charHead);
    const charRow = document.createElement("div");
    charRow.className = "dr-actions";
    const skinSel = document.createElement("select");
    skinSel.style.cssText =
      "background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.2);" +
      "border-radius:4px;padding:3px 6px;font-size:12px;max-width:200px;";
    for (const s of survivorSkins()) {
      const opt = document.createElement("option");
      opt.value = s.path;
      opt.textContent = s.name;
      skinSel.appendChild(opt);
    }
    charRow.appendChild(skinSel);
    charRow.appendChild(this.btn("キャラを配置（視線の先）", () => this.addCharacter(skinSel.value)));
    this.element.appendChild(charRow);

    // SHOOTING GALLERY（本格射撃場）の的配置
    const gHead = document.createElement("div");
    gHead.className = "dr-cur";
    gHead.style.marginTop = "8px";
    gHead.textContent = "SHOOTING GALLERY（本格射撃場）";
    this.element.appendChild(gHead);
    const g1 = document.createElement("div");
    g1.className = "dr-actions";
    g1.appendChild(this.btn("会場へ入る", () => this.app.enterGallery()));
    g1.appendChild(this.btn("静止的6体", () => this.app.getGallery().spawnStaticSet()));
    g1.appendChild(this.btn("往復(遅)", () => this.app.getGallery().spawnPatrol(2)));
    g1.appendChild(this.btn("往復(普)", () => this.app.getGallery().spawnPatrol(4)));
    g1.appendChild(this.btn("往復(速)", () => this.app.getGallery().spawnPatrol(7)));
    g1.appendChild(this.btn("振り子", () => this.app.getGallery().spawnPendulum()));
    g1.appendChild(this.btn("ポップアップ", () => this.app.getGallery().spawnPopup(2)));
    g1.appendChild(this.btn("敵3体", () => this.app.getGallery().spawnEnemies(3)));
    this.element.appendChild(g1);
    const g2 = document.createElement("div");
    g2.className = "dr-actions";
    g2.appendChild(this.btn("プリセット:精度", () => this.app.getGallery().presetAccuracy()));
    g2.appendChild(this.btn("プリセット:追従", () => this.app.getGallery().presetTracking()));
    g2.appendChild(this.btn("プリセット:実戦", () => this.app.getGallery().presetCombat()));
    g2.appendChild(this.btn("会場の的を全消去", () => this.app.getGallery().clear()));
    this.element.appendChild(g2);

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

    this.spawnAt(this.spawnKind, x, z);
  }

  // 指定座標へ的を生成して登録する（addTarget と射撃場プリセットで共用）。
  private spawnAt(kind: DevTargetKind, x: number, z: number): void {
    const ctx = this.app.ctx;
    const t = new DevTarget(ctx.scene, kind, x, z);
    ctx.weapons.enemyTargets.push(t.unit.hitbox);
    ctx.weapons.enemyTargets.push(t.unit.headHitbox);
    this.targets.push(t);
    this.refreshCount();
  }

  // 射撃場用：既存の的を一掃してから、動く敵を数体だけ自動配置する。
  // （静止ターゲットは射撃場ステージ側に整列しているので、ここでは動く敵を出す。）
  spawnPreset(): void {
    this.clearAll();
    this.spawnAt("patrol", -6, -22);
    this.spawnAt("patrol", 6, -22);
    this.spawnAt("random", 0, -26);
  }

  // DEV RANGE 終了時：全的削除＋命中フック解除。
  dispose(): void {
    this.clearAll();
    this.app.ctx.weapons.enemyHitHook = null;
  }

  // 視線の先に実キャラモデルを配置する（指定 skin を適用）。
  private addCharacter(skinPath: string): void {
    const ctx = this.app.ctx;
    const dir = new THREE.Vector3();
    ctx.camera.getWorldDirection(dir);
    const origin = new THREE.Vector3();
    ctx.camera.getWorldPosition(origin);
    this.ray.set(origin, dir);
    const hits = this.ray.intersectObjects(ctx.stage.group.children, true);
    const x = hits.length > 0 ? hits[0].point.x : origin.x + dir.x * 8;
    const z = hits.length > 0 ? hits[0].point.z : origin.z + dir.z * 8;
    void loadSurvivor(skinPath).then((grp) => {
      if (!grp) return;
      grp.position.x = x;
      grp.position.z = z;
      grp.lookAt(ctx.camera.position.x, grp.position.y, ctx.camera.position.z); // プレイヤーの方を向く
      ctx.scene.add(grp);
      this.chars.push(grp);
    });
  }

  private clearAll(): void {
    const ctx = this.app.ctx;
    for (const t of this.targets) {
      this.removeFromTargets(t.unit.hitbox);
      this.removeFromTargets(t.unit.headHitbox);
      t.dispose(ctx.scene);
    }
    this.targets = [];
    for (const g of this.chars) {
      ctx.scene.remove(g);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) for (const mm of mat) mm.dispose();
        else if (mat && typeof (mat as THREE.Material).dispose === "function") (mat as THREE.Material).dispose();
      });
    }
    this.chars = [];
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
