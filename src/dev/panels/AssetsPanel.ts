import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WeaponKind } from "../../types";
import { Stage, STAGE_LIST, StageId } from "../../Stage";
import { EnemyUnit } from "../../Enemy";
import { DevApp, DevPanel } from "../devTypes";
import { loadSurvivor, survivorSkins } from "../CharacterModels";
import { PreviewModal, type PreviewDetail } from "../PreviewModal";
import { loadModel } from "../ModelLoader";
import { defaultSpec, gunTypeLabel, type EditableSpec } from "../WeaponDefaults";

// ASSETS タブ：取込アセットをカテゴリ別に3Dサムネイル一覧する。
// モデルが多数（武器だけで100以上）になるため、サムネイルは IntersectionObserver による
// 遅延生成（画面内に入ったものだけ描画）。永続オフスクリーン WebGLRenderer を1つ使い回す。
// クリックで PreviewModal（自動回転3D＋詳細）。本ゲームは画像テクスチャ未使用＝実モデルのプレビュー。
// 本パネルは dev でのみ動的 import されるため、取込モデルも本番バンドルには含まれない。

const WEAPON_GLTF = import.meta.glob("../models/weapons/*.gltf", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const WEAPON_OTHER = import.meta.glob("../models/weapons/*.{fbx,obj}", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const MONSTERS = import.meta.glob("../models/monsters/*.{gltf,glb}", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const PROPS = import.meta.glob("../models/props/*.{fbx,gltf,glb,obj}", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const MAN_MODEL = import.meta.glob("../models/characters/man.fbx", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const CHAR_MODELS = import.meta.glob("../models/characters/*.fbx", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const CHARACTER_TEX = import.meta.glob("../textures/characters/*.png", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const STAGE_TEX = import.meta.glob("../textures/stages/*.png", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

const INGAME_WEAPONS: Array<{ kind: WeaponKind; label: string }> = [
  { kind: WeaponKind.Assault, label: "ASSAULT" },
  { kind: WeaponKind.Sniper, label: "SNIPER" },
  { kind: WeaponKind.Shotgun, label: "SHOTGUN" },
  { kind: WeaponKind.Smg, label: "SMG" },
];

const CHARACTERS: Array<{ label: string; opts: ConstructorParameters<typeof EnemyUnit>[0] }> = [
  { label: "標準", opts: { scale: 1.0, bodyColor: 0x23262e, accentColor: 0xff6a00 } },
  { label: "重装", opts: { scale: 1.3, bodyColor: 0x2a2330, accentColor: 0x9a5cff } },
  { label: "射撃型", opts: { scale: 1.0, bodyColor: 0x1f2a26, accentColor: 0x3ad6a0 } },
  { label: "飛行", opts: { scale: 1.0, bodyColor: 0x26222e, accentColor: 0xff5a8a, flying: true } },
];

const THUMB_W = 184;
const THUMB_H = 132;

export class AssetsPanel implements DevPanel {
  element: HTMLElement;
  private built = false;
  private modal = new PreviewModal();
  // 取込武器ごとのカスタム性能（規定値から開始・セッション内保持）
  private weaponSpecs = new Map<string, EditableSpec>();

  // 永続オフスクリーン描画（使い回す）
  private renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private env: THREE.Texture | null = null;

  // 遅延サムネイル生成
  private observer: IntersectionObserver | null = null;
  private lazy = new Map<Element, () => void>();

  // プレビュー（サムネ群）の表示制御：全画面でない時は既定で隠し、ボタンで表示する。
  private galleryEl: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private hostFull = true; // DevRange が全画面かどうか
  private previewOn = false; // 通常表示時にユーザーがボタンで表示させたか

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
    const note = document.createElement("div");
    note.className = "dr-cur";
    note.textContent = "読み込み済みアセット（実モデルのプレビュー・画面内に入った順にサムネ生成）";
    this.element.appendChild(note);

    // 通常表示（全画面でない）時にプレビューを出し入れするボタン。
    this.toggleBtn = document.createElement("button");
    this.toggleBtn.className = "dr-tgl";
    this.toggleBtn.style.margin = "6px 0";
    this.toggleBtn.onclick = () => {
      this.previewOn = !this.previewOn;
      this.applyPreviewVisibility();
    };
    this.element.appendChild(this.toggleBtn);

    // サムネ群はこのコンテナへ入れ、まとめて表示/非表示を切り替える。
    this.galleryEl = document.createElement("div");
    this.element.appendChild(this.galleryEl);

    this.applyPreviewVisibility();
  }

  // DevRange の全画面状態を受け取り、プレビューの表示可否を更新する。
  setHostFullscreen(full: boolean): void {
    this.hostFull = full;
    if (full) this.previewOn = false; // 全画面に戻したら通常表示時の手動表示はリセット
    this.applyPreviewVisibility();
  }

  // 全画面なら常時表示、通常表示ならボタンON時のみ表示。
  private applyPreviewVisibility(): void {
    const visible = this.hostFull || this.previewOn;
    this.galleryEl.style.display = visible ? "" : "none";
    this.toggleBtn.style.display = this.hostFull ? "none" : ""; // 全画面ではボタン不要
    this.toggleBtn.textContent = this.previewOn ? "プレビューを隠す" : "プレビューを表示";
  }

  onShow(): void {
    if (this.built) return;
    this.built = true;
    window.setTimeout(() => this.build(), 0);
  }

  private build(): void {
    this.ensureRenderer();
    this.ensureObserver();

    // 武器（取込 gltf）
    this.section("武器モデル（取込・gltf）");
    const wg = this.grid();
    for (const [path, getUrl] of Object.entries(WEAPON_GLTF)) {
      const name = this.niceName(path);
      const make = () => this.loadGltf(getUrl);
      wg.appendChild(
        this.modelCard(name, make, [{ label: "種別", value: gunTypeLabel(name) }, { label: "形式", value: "glTF" }], this.weaponCfg(name, make))
      );
    }

    // 武器（取込 fbx/obj：リアル系・FPS銃・Ultimate Gun Pack）
    this.section("武器モデル（取込・fbx/obj）");
    const wo = this.grid();
    for (const [path, getUrl] of Object.entries(WEAPON_OTHER)) {
      const ext = this.modelExt(path);
      const name = this.modelName(path);
      const make = () => this.loadAny(getUrl, ext);
      wo.appendChild(
        this.modelCard(name, make, [{ label: "種別", value: gunTypeLabel(name) }, { label: "形式", value: ext.toUpperCase() }], this.weaponCfg(name, make))
      );
    }

    // ゲーム内武器（箱モデル）
    this.section("ゲーム内武器");
    const ig = this.grid();
    for (const w of INGAME_WEAPONS) {
      ig.appendChild(this.modelCard(w.label, () => this.cloneIngame(w.kind), this.weaponSpecDetails(w.kind)));
    }

    // キャラ実モデル（survivor＋skin）
    this.section("キャラ実モデル（skin適用・3D）");
    const cs = this.grid();
    for (const skin of survivorSkins()) {
      cs.appendChild(
        this.modelCard(skin.name, () => loadSurvivor(skin.path), [
          { label: "種別", value: "実モデル（FBX）" },
          { label: "skin", value: skin.name },
        ])
      );
    }

    // 人体（実モデル）
    this.section("人体（実モデル）");
    const mg = this.grid();
    const manSkin = this.texLoaderByName("素体_明るい肌");
    for (const [path, getUrl] of Object.entries(MAN_MODEL)) {
      mg.appendChild(
        this.modelCard(this.modelName(path), () => this.loadAndTex(getUrl, "fbx", manSkin), [
          { label: "種別", value: "人体（FBX）" },
        ])
      );
    }

    // モンスター（実モデル＋アトラス）
    this.section("モンスター（実モデル）");
    const mo = this.grid();
    const atlas = this.texLoaderByName("モンスター_アトラス");
    for (const [path, getUrl] of Object.entries(MONSTERS)) {
      mo.appendChild(
        this.modelCard(this.modelName(path), () => this.loadAndTex(getUrl, "gltf", atlas), [
          { label: "種別", value: "モンスター（glTF）" },
        ])
      );
    }

    // キャラクター（ゲーム内 EnemyUnit）
    this.section("キャラクター（ゲーム内）");
    const cg = this.grid();
    for (const c of CHARACTERS) {
      cg.appendChild(
        this.modelCard(c.label, async () => new EnemyUnit(c.opts).group, [
          { label: "種別", value: "ゲーム内キャラ（EnemyUnit）" },
        ])
      );
    }

    // キャラテクスチャ：対応する実モデルに貼った3Dサムネで表示（平面ではなく3D）。
    this.section("キャラテクスチャ（実モデルに適用・3D）");
    const tg = this.grid();
    for (const [path, getUrl] of Object.entries(CHARACTER_TEX)) {
      const make = this.texturePreviewMake(path);
      if (make) {
        tg.appendChild(
          this.modelCard(this.texName(path), make, [{ label: "種別", value: "キャラテクスチャ→実モデル3D" }])
        );
      } else {
        // 対応モデルが無いものだけ平面表示にフォールバック
        tg.appendChild(this.texCard(getUrl, this.texName(path), undefined));
      }
    }

    // プロップ（木・室内・実モデル）
    this.section("プロップ（木・室内・実モデル）");
    const pg = this.grid();
    for (const [path, getUrl] of Object.entries(PROPS)) {
      const ext = this.modelExt(path);
      pg.appendChild(
        this.modelCard(this.modelName(path), () => this.loadAny(getUrl, ext), [{ label: "形式", value: ext.toUpperCase() }])
      );
    }

    // ステージ（俯瞰3Dサムネ・クリックで確認用ロード）
    this.section("ステージ");
    const sg = this.grid();
    for (const s of STAGE_LIST) {
      sg.appendChild(this.stageCard(s.id, s.label));
    }

    // テクスチャ（ステージ・BaseColor）
    this.section("テクスチャ（ステージ・BaseColor）");
    const stg = this.grid();
    for (const [path, getUrl] of Object.entries(STAGE_TEX)) {
      stg.appendChild(this.texCard(getUrl, this.texName(path), undefined));
    }
  }

  // ===== セットアップ =====
  private ensureRenderer(): void {
    if (this.renderer) return;
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(THUMB_W, THUMB_H);
    this.renderer = r;
    this.pmrem = new THREE.PMREMGenerator(r);
    this.env = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }

  private ensureObserver(): void {
    if (this.observer) return;
    const root = this.element.parentElement ?? null;
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const fn = this.lazy.get(e.target);
          if (fn) {
            this.lazy.delete(e.target);
            this.observer?.unobserve(e.target);
            fn();
          }
        }
      },
      { root, rootMargin: "600px 0px" }
    );
  }

  private observe(el: Element, fn: () => void): void {
    this.lazy.set(el, fn);
    this.observer?.observe(el);
  }

  // ===== ローダー（make: Object3D を返す） =====
  private async loadGltf(getUrl: () => Promise<string>): Promise<THREE.Object3D | null> {
    try {
      const gltf = await new GLTFLoader().loadAsync(await getUrl());
      return gltf.scene;
    } catch {
      return null;
    }
  }

  private async loadAny(getUrl: () => Promise<string>, ext: string): Promise<THREE.Object3D | null> {
    return loadModel(await getUrl(), ext);
  }

  private async cloneIngame(kind: WeaponKind): Promise<THREE.Object3D | null> {
    const m = this.app.ctx.weapons.devWeaponModel(kind).clone();
    m.visible = true;
    m.traverse((o) => (o.visible = true)); // 非選択武器は visible=false のため戻す
    m.position.set(0, 0, 0);
    return m;
  }

  // モデルを読み込み、texLoader があれば全メッシュにそのテクスチャを map 適用して返す。
  private async loadAndTex(
    getUrl: () => Promise<string>,
    ext: string,
    texLoader: (() => Promise<string>) | null
  ): Promise<THREE.Object3D | null> {
    const obj = await loadModel(await getUrl(), ext);
    if (obj && texLoader) {
      const tex = await new THREE.TextureLoader().loadAsync(await texLoader());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.0 });
      });
    }
    return obj;
  }

  // ===== カード生成 =====
  // モデルカード：遅延でサムネ描画、クリックで PreviewModal。
  private modelCard(
    name: string,
    makeObj: () => Promise<THREE.Object3D | null>,
    details: PreviewDetail[],
    weaponCfg?: { spec: EditableSpec; onUse: () => void }
  ): HTMLElement {
    return this.lazyCard(
      name,
      "cover",
      async () => {
        const obj = await makeObj();
        if (!obj) return null;
        const u = this.renderThumb(obj);
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.geometry) m.geometry.dispose();
        });
        return u;
      },
      () => this.modal.open(makeObj, name, details, weaponCfg)
    );
  }

  // 取込武器のカスタム性能（無ければ規定値で初期化）。
  private getWeaponSpec(name: string): EditableSpec {
    let s = this.weaponSpecs.get(name);
    if (!s) {
      s = defaultSpec(name);
      this.weaponSpecs.set(name, s);
    }
    return s;
  }

  // 武器カードに渡すカスタマイズ設定。
  private weaponCfg(name: string, makeObj: () => Promise<THREE.Object3D | null>): { spec: EditableSpec; onUse: () => void } {
    return { spec: this.getWeaponSpec(name), onUse: () => void this.equipWeapon(makeObj, name) };
  }

  // 「射撃場で使う」：射撃場へ入り、このモデルを手元に装着して、カスタム性能を適用する。
  private async equipWeapon(makeObj: () => Promise<THREE.Object3D | null>, name: string): Promise<void> {
    const spec = this.getWeaponSpec(name);
    const obj = await makeObj();
    if (!obj) return;
    this.fitViewmodel(obj);
    this.app.enterRange(); // 射撃場へ（的・敵が出る）
    this.app.ctx.weapons.devSetViewmodel(WeaponKind.Assault, obj);
    Object.assign(this.app.ctx.weapons.devSpec(WeaponKind.Assault), spec);
    this.app.ctx.input.queueSwitch(WeaponKind.Assault);
  }

  // 手元ビューモデル用にモデルを回頭・縮尺・原点寄せする。
  // 取込武器の多くは横(x)向きで作られているため、銃身を前方(-z)へ向けて
  // 既定の箱武器と同じ持ち方にする。
  private fitViewmodel(obj: THREE.Object3D): void {
    // 1) 素の寸法を測り、銃身が横(x)向きなら前方(-z)へ回頭する。
    obj.rotation.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const raw = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    if (raw.x > raw.z * 1.15) obj.rotation.y = -Math.PI / 2; // 横向き → 前方
    obj.updateMatrixWorld(true);

    // 2) 最長辺を基準にスケールを合わせる。
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    obj.scale.setScalar(0.6 / (Math.max(size.x, size.y, size.z) || 1));
    obj.updateMatrixWorld(true);

    // 3) 原点寄せ＋手元の少し前へ置く。
    const c = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -c.y - 0.05, -c.z - 0.3);
  }

  // ステージカード：遅延で俯瞰サムネ、クリックで確認用ロード。
  private stageCard(id: StageId, label: string): HTMLElement {
    return this.lazyCard(
      label,
      "cover",
      async () => this.renderStage(id),
      () => {
        this.app.ctx.stage.load(id);
        this.app.ctx.weapons.refreshShootables();
        const sp = this.app.ctx.stage.playerSpawn;
        this.app.ctx.player.respawn(sp.x, sp.y, sp.z);
      }
    );
  }

  // テクスチャカード：画像をそのまま表示（遅延不要）。
  private texCard(getUrl: () => Promise<string>, name: string, onClick?: () => void): HTMLElement {
    const card = this.cardShell(name, "contain", onClick);
    const img = card.firstChild as HTMLImageElement;
    void getUrl().then((u) => (img.src = u));
    return card;
  }

  // 遅延サムネカード：observe で画面内に入ったら renderThumbFn を一度だけ実行。
  private lazyCard(
    name: string,
    fit: "cover" | "contain",
    renderThumbFn: () => Promise<string | null>,
    onClick?: () => void
  ): HTMLElement {
    const card = this.cardShell(name, fit, onClick);
    const img = card.firstChild as HTMLImageElement;
    this.observe(img, () => {
      void renderThumbFn().then((u) => {
        if (u) img.src = u;
      });
    });
    return card;
  }

  private cardShell(name: string, fit: "cover" | "contain", onClick?: () => void): HTMLElement {
    const card = document.createElement("div");
    card.style.cssText =
      "width:" + THUMB_W + "px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;" +
      "background:rgba(255,255,255,0.04);overflow:hidden;";
    if (onClick) {
      card.style.cursor = "pointer";
      card.title = "クリックでプレビューと詳細";
      card.onclick = onClick;
    }
    const img = document.createElement("img");
    img.style.cssText =
      "display:block;width:100%;height:" + THUMB_H + "px;object-fit:" + fit + ";background:#0c0e12;";
    const cap = document.createElement("div");
    cap.textContent = name;
    cap.style.cssText = "padding:4px 8px;font-size:12px;color:#cdd6e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    card.appendChild(img);
    card.appendChild(cap);
    return card;
  }

  // ===== 描画 =====
  private renderThumb(obj: THREE.Object3D): string {
    const scene = new THREE.Scene();
    scene.environment = this.env;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    scene.add(obj);
    const cam = this.frameCamera(obj);
    this.renderer!.render(scene, cam);
    const u = this.renderer!.domElement.toDataURL("image/png");
    scene.remove(obj);
    return u;
  }

  private renderStage(id: StageId): string {
    const scene = new THREE.Scene();
    scene.environment = this.env;
    const stage = new Stage(scene, id);
    const cam = new THREE.PerspectiveCamera(50, THUMB_W / THUMB_H, 0.1, 1000);
    const box = new THREE.Box3().setFromObject(stage.group);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 20) * 0.9;
    cam.position.set(center.x + r, center.y + r * 0.8 + 8, center.z + r);
    cam.lookAt(center.x, center.y, center.z);
    this.renderer!.render(scene, cam);
    const u = this.renderer!.domElement.toDataURL("image/png");
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else if (mat) (mat as THREE.Material).dispose();
    });
    return u;
  }

  private frameCamera(obj: THREE.Object3D): THREE.PerspectiveCamera {
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const cam = new THREE.PerspectiveCamera(40, THUMB_W / THUMB_H, 0.01, 5000);
    const dist = maxDim * 2.3;
    cam.position.set(center.x + dist * 0.7, center.y + dist * 0.5, center.z + dist * 0.9);
    cam.lookAt(center);
    return cam;
  }

  // ===== 補助 =====
  private section(title: string): void {
    const h = document.createElement("div");
    h.className = "dr-cur";
    h.style.marginTop = "8px";
    h.textContent = title;
    this.galleryEl.appendChild(h);
  }

  private grid(): HTMLElement {
    const g = document.createElement("div");
    g.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;";
    this.galleryEl.appendChild(g);
    return g;
  }

  private niceName(path: string): string {
    const base = path.split("/").pop()?.replace(/\.gltf$/i, "") ?? path;
    return base.replace(/^scifi_ar_/i, "SciFi AR ").replace(/_/g, " ");
  }

  private texName(path: string): string {
    return path.split("/").pop()?.replace(/\.png$/i, "") ?? path;
  }

  private modelExt(path: string): string {
    return (path.split(".").pop() ?? "").toLowerCase();
  }

  private modelName(path: string): string {
    return (path.split("/").pop() ?? path).replace(/\.(gltf|glb|fbx|obj)$/i, "");
  }

  private texLoaderByName(sub: string): (() => Promise<string>) | null {
    const k = Object.keys(CHARACTER_TEX).find((p) => (p.split("/").pop() ?? "").includes(sub));
    return k ? CHARACTER_TEX[k] : null;
  }

  private charModelLoader(file: string): (() => Promise<string>) | null {
    const k = Object.keys(CHAR_MODELS).find((p) => p.endsWith("/" + file));
    return k ? CHAR_MODELS[k] : null;
  }

  private weaponSpecDetails(kind: WeaponKind): PreviewDetail[] {
    const s = this.app.ctx.weapons.devSpec(kind);
    return [
      { label: "種別", value: "ゲーム内武器（箱）" },
      { label: "ダメージ", value: String(s.damage) },
      { label: "連射RPM", value: String(Math.round(60 / s.fireInterval)) },
      { label: "マガジン", value: String(s.magSize) },
      { label: "予備弾", value: String(s.reserveMax) },
      { label: "リロード", value: s.reloadTime.toFixed(1) + "s" },
      { label: "フルオート", value: s.automatic ? "ON" : "OFF" },
    ];
  }

  // 平面キャラテクスチャ→対応する実モデルに貼って3D表示する make()。対応モデルが無ければ null。
  private texturePreviewMake(skinPath: string): (() => Promise<THREE.Object3D | null>) | null {
    const name = skinPath.split("/").pop() ?? "";
    const skinLoader = CHARACTER_TEX[skinPath];
    if (!skinLoader) return null;
    if (name.startsWith("モンスター")) {
      const k = Object.keys(MONSTERS)[0];
      if (!k) return null;
      const ml = MONSTERS[k];
      return () => this.loadAndTex(ml, "gltf", skinLoader);
    }
    let file: string | null = null;
    if (name.startsWith("サバイバー") || name.includes("ゾンビ")) file = "survivor.fbx";
    else if (name.startsWith("レンジャー")) file = "ranger.fbx";
    else if (name.startsWith("農民")) file = "peasant.fbx";
    else if (name.startsWith("素体") || name.startsWith("服あり") || name.startsWith("女性") || name.startsWith("男性"))
      file = "man.fbx";
    if (!file) return null;
    const ml = this.charModelLoader(file);
    if (!ml) return null;
    return () => this.loadAndTex(ml, "fbx", skinLoader);
  }

  // DEV RANGE 終了時：永続レンダラー・監視を解放。
  dispose(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.lazy.clear();
    if (this.env) {
      this.env.dispose();
      this.env = null;
    }
    if (this.pmrem) {
      this.pmrem.dispose();
      this.pmrem = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}
