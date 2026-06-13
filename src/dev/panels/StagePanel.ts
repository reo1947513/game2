import * as THREE from "three";
import { STAGE_LIST, StageId } from "../../Stage";
import { DevApp, DevPanel } from "../devTypes";

// 取込ステージテクスチャ（BaseColor）。遅延 glob（本番除外のため必須）。
const STAGE_TEX = import.meta.glob("../textures/stages/*.png", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

// STAGE タブ：ステージ切替、テクスチャ／マテリアル確認、コライダー可視化、照明調整。
export class StagePanel implements DevPanel {
  element: HTMLElement;

  private wireframe = false;
  private colliderOn = false;
  private lightFactor = 1;

  // コライダー可視化用のヘルパー群
  private colliderGroup: THREE.Group | null = null;
  // 各ライトの基準 intensity（照明スライダーの基準値）
  private lightBase = new Map<THREE.Light, number>();
  // テクスチャ試着：差し替えたマテリアルの原状（復帰用）と、適用したクローンテクスチャ
  private savedMats = new Map<THREE.MeshStandardMaterial, { map: THREE.Texture | null; color: number }>();
  private appliedTextures: THREE.Texture[] = [];

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
  }

  onShow(): void {
    this.captureLights();
    this.render();
  }

  // シーン内のライトと基準 intensity を取り直す（ステージ切替後に呼ぶ）。
  private captureLights(): void {
    this.lightBase.clear();
    this.app.ctx.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight) this.lightBase.set(l, l.intensity / (this.lightFactor || 1));
    });
  }

  private render(): void {
    const ctx = this.app.ctx;
    this.element.innerHTML = "";

    const curLabel =
      STAGE_LIST.find((s) => s.id === ctx.stage.stageId)?.label ?? ctx.stage.stageId;
    const cur = document.createElement("div");
    cur.className = "dr-cur";
    cur.textContent = `現在のステージ: ${curLabel}`;
    this.element.appendChild(cur);

    // ステージ切替
    // 射撃場（専用レンジ：的・敵が出て、読み込んだ武器で撃てる）
    const rangeWrap = document.createElement("div");
    rangeWrap.className = "dr-stages";
    const rangeBtn = this.btn("▶ 射撃場に入る（的・敵＋武器テスト）", () => this.app.enterRange());
    rangeBtn.classList.toggle("on", (ctx.stage.stageId as string) === "range");
    rangeWrap.appendChild(rangeBtn);
    this.element.appendChild(rangeWrap);

    // 確認用ステージ（素のまま確認。ワイヤーフレーム・コライダー・照明・マテリアル一覧用）
    const stagesLabel = document.createElement("div");
    stagesLabel.className = "dr-cur";
    stagesLabel.textContent = "確認用ステージ（素のまま確認）";
    this.element.appendChild(stagesLabel);

    const stages = document.createElement("div");
    stages.className = "dr-stages";
    for (const s of STAGE_LIST) {
      const b = document.createElement("button");
      b.className = "dr-btn" + (s.id === ctx.stage.stageId ? " on" : "");
      b.textContent = s.label;
      b.onclick = () => this.loadStage(s.id);
      stages.appendChild(b);
    }
    this.element.appendChild(stages);

    // 操作群
    const actions = document.createElement("div");
    actions.className = "dr-actions";
    actions.appendChild(
      this.btn("スポーンへ戻る", () => {
        const sp = ctx.stage.playerSpawn;
        ctx.player.respawn(sp.x, sp.y, sp.z);
      })
    );
    const wf = this.btn("ワイヤーフレーム", () => {
      this.wireframe = !this.wireframe;
      this.applyWireframe(this.wireframe);
      wf.classList.toggle("on", this.wireframe);
    });
    wf.classList.toggle("on", this.wireframe);
    actions.appendChild(wf);

    const col = this.btn("コライダー表示", () => {
      this.colliderOn = !this.colliderOn;
      this.applyColliders(this.colliderOn);
      col.classList.toggle("on", this.colliderOn);
    });
    col.classList.toggle("on", this.colliderOn);
    actions.appendChild(col);

    this.element.appendChild(actions);

    // 照明強度スライダー
    const lightRow = document.createElement("div");
    lightRow.className = "dr-row";
    const ll = document.createElement("label");
    ll.textContent = "照明強度";
    const lr = document.createElement("input");
    lr.type = "range";
    lr.min = "0";
    lr.max = "2";
    lr.step = "0.05";
    lr.value = String(this.lightFactor);
    lr.oninput = () => {
      this.lightFactor = parseFloat(lr.value);
      this.applyLightFactor();
    };
    lightRow.appendChild(ll);
    lightRow.appendChild(lr);
    this.element.appendChild(lightRow);

    // ステージ情報
    this.element.appendChild(this.buildInfo());

    // マテリアル一覧
    this.element.appendChild(this.buildMaterials());

    // テクスチャ試着（テスト環境：現在のステージに貼る）
    this.element.appendChild(this.buildTextureTryOn());
  }

  private loadStage(id: StageId): void {
    const ctx = this.app.ctx;
    this.resetTexState(); // 旧ステージのテクスチャ試着状態を破棄（マテリアルごと作り直されるため）
    if (this.colliderOn) this.applyColliders(false); // 旧コライダーのヘルパーを除去
    ctx.stage.load(id);
    ctx.weapons.refreshShootables();
    const sp = ctx.stage.playerSpawn;
    ctx.player.respawn(sp.x, sp.y, sp.z);
    if (this.wireframe) this.applyWireframe(true);
    this.captureLights();
    this.applyLightFactor();
    if (this.colliderOn) this.applyColliders(true);
    this.render();
  }

  private applyWireframe(on: boolean): void {
    this.app.ctx.stage.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if ("wireframe" in sm) sm.wireframe = on;
      }
    });
  }

  private applyColliders(on: boolean): void {
    const ctx = this.app.ctx;
    if (on) {
      if (this.colliderGroup) this.applyColliders(false);
      const g = new THREE.Group();
      for (const box of ctx.stage.colliders) {
        const helper = new THREE.Box3Helper(box, new THREE.Color(0xff3344));
        g.add(helper);
      }
      ctx.scene.add(g);
      this.colliderGroup = g;
    } else if (this.colliderGroup) {
      ctx.scene.remove(this.colliderGroup);
      this.colliderGroup.traverse((o) => {
        const h = o as THREE.Box3Helper;
        if (h.geometry) h.geometry.dispose();
        const m = h.material as THREE.Material | undefined;
        if (m && typeof m.dispose === "function") m.dispose();
      });
      this.colliderGroup = null;
    }
  }

  private applyLightFactor(): void {
    for (const [light, base] of this.lightBase) light.intensity = base * this.lightFactor;
  }

  private buildInfo(): HTMLElement {
    const ctx = this.app.ctx;
    let meshes = 0;
    ctx.stage.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    let lights = 0;
    ctx.scene.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
    });
    const sp = ctx.stage.playerSpawn;
    const info = document.createElement("div");
    info.className = "dr-info";
    info.innerHTML =
      `<div>コライダー数: <b>${ctx.stage.colliders.length}</b>　メッシュ数: <b>${meshes}</b>　ライト数: <b>${lights}</b></div>` +
      `<div>スポーン地点: <b>(${sp.x.toFixed(1)}, ${sp.y.toFixed(1)}, ${sp.z.toFixed(1)})</b></div>`;
    return info;
  }

  private buildMaterials(): HTMLElement {
    const ctx = this.app.ctx;
    const seen = new Set<THREE.MeshStandardMaterial>();
    ctx.stage.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.isMeshStandardMaterial) seen.add(sm);
      }
    });

    const wrap = document.createElement("div");
    const head = document.createElement("div");
    head.className = "dr-cur";
    head.style.marginTop = "8px";
    head.textContent = `マテリアル一覧（${seen.size} 種）`;
    wrap.appendChild(head);

    const list = document.createElement("div");
    list.className = "dr-mats";
    let shown = 0;
    for (const m of seen) {
      if (shown >= 40) break; // 表示は最大40種に制限（過多なステージ対策）
      shown++;
      const chip = document.createElement("div");
      chip.className = "dr-mat";
      const sw = document.createElement("span");
      sw.className = "dr-sw";
      sw.style.background = `#${m.color.getHexString()}`;
      chip.appendChild(sw);
      const txt = document.createElement("span");
      txt.textContent = `#${m.color.getHexString()} r${m.roughness.toFixed(2)} m${m.metalness.toFixed(2)}`;
      chip.appendChild(txt);
      list.appendChild(chip);
    }
    wrap.appendChild(list);
    return wrap;
  }

  // テクスチャ試着UI：選択した取込テクスチャを現在のステージへ貼る／解除する。
  private buildTextureTryOn(): HTMLElement {
    const wrap = document.createElement("div");
    const head = document.createElement("div");
    head.className = "dr-cur";
    head.style.marginTop = "8px";
    head.textContent = "テクスチャ試着（現在のステージに貼る）";
    wrap.appendChild(head);

    const row = document.createElement("div");
    row.className = "dr-actions";
    const sel = document.createElement("select");
    sel.style.cssText =
      "background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.2);" +
      "border-radius:4px;padding:3px 6px;font-size:12px;max-width:240px;";
    for (const path of Object.keys(STAGE_TEX)) {
      const opt = document.createElement("option");
      opt.value = path;
      opt.textContent = path.split("/").pop()?.replace(/\.png$/i, "") ?? path;
      sel.appendChild(opt);
    }
    row.appendChild(sel);
    row.appendChild(
      this.btn("適用", () => {
        const loader = STAGE_TEX[sel.value];
        if (loader) void loader().then((url) => this.applyStageTexture(url));
      })
    );
    row.appendChild(this.btn("テクスチャ解除", () => this.clearStageTexture()));
    wrap.appendChild(row);

    const hint = document.createElement("div");
    hint.className = "dr-info";
    hint.textContent = "現在のステージの面に繰り返し貼って確認します（テスト環境のみ・面サイズで概算タイリング）。";
    wrap.appendChild(hint);
    return wrap;
  }

  // 選択テクスチャを現在のステージの全 MeshStandardMaterial へ貼る（面サイズで repeat 概算）。
  private async applyStageTexture(url: string): Promise<void> {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    const box = new THREE.Box3();
    this.app.ctx.stage.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.isMeshStandardMaterial) return;
      if (!this.savedMats.has(mat)) this.savedMats.set(mat, { map: mat.map, color: mat.color.getHex() });
      const t = tex.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      box.setFromObject(mesh);
      const sx = box.max.x - box.min.x;
      const sy = box.max.y - box.min.y;
      const sz = box.max.z - box.min.z;
      const rep = Math.max(1, Math.min(12, Math.round(Math.max(sx, sy, sz) / 4)));
      t.repeat.set(rep, rep);
      this.appliedTextures.push(t);
      mat.map = t;
      mat.color.setHex(0xffffff); // map をそのまま見せるため白に
      mat.needsUpdate = true;
    });
  }

  // テクスチャ試着を解除し、元のマテリアル状態へ戻す。
  clearStageTexture(): void {
    for (const [mat, orig] of this.savedMats) {
      mat.map = orig.map;
      mat.color.setHex(orig.color);
      mat.needsUpdate = true;
    }
    this.savedMats.clear();
    for (const t of this.appliedTextures) t.dispose();
    this.appliedTextures = [];
  }

  // ステージ切替時：旧マテリアルは破棄されるので、復帰せず状態だけ捨てる。
  private resetTexState(): void {
    this.savedMats.clear();
    for (const t of this.appliedTextures) t.dispose();
    this.appliedTextures = [];
  }

  private btn(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "dr-btn";
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }
}
