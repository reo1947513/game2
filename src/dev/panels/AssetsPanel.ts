import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { WeaponKind } from "../../types";
import { Stage, STAGE_LIST, StageId } from "../../Stage";
import { EnemyUnit } from "../../Enemy";
import { DevApp, DevPanel } from "../devTypes";

// ASSETS タブ：読み込み済みの3Dアセットをカテゴリ別にサムネイル一覧する。
// - 取込武器モデル（gltf, src/dev/models/weapons）… GLTFLoader で読み込む実モデル
// - ゲーム内武器（箱モデル）／キャラクター（EnemyUnit）／ステージ … 既存の実モデル
// サムネイルはオフスクリーン WebGLRenderer で描画し toDataURL でキャッシュする。
// 金属マテリアルが真っ黒にならないよう RoomEnvironment の環境マップを与える。
// 本ゲームは画像テクスチャを使わないため、これはテクスチャではなくモデルのプレビュー。
// AssetsPanel は dev でのみ動的 import されるため、取込モデルも本番バンドルには含まれない。

// 取込武器モデル（gltf）を URL として列挙（Vite glob）。
// eager にすると参照コードがツリーシェイクされても本番 dist にアセットが出力されてしまうため、
// 必ず遅延 glob（動的 import）にする。これで dev チャンクが除去される本番には gltf が一切出ない。
const WEAPON_GLTF = import.meta.glob("../models/weapons/*.gltf", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

// 取込テクスチャ（キャラの BaseColor 画像、512px縮小）。遅延 glob（本番除外のため必須）。
const CHARACTER_TEX = import.meta.glob("../textures/characters/*.png", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

// 取込テクスチャ（ステージの BaseColor 画像、512px縮小）。遅延 glob（本番除外のため必須）。
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
  private generated = false;
  private env: THREE.Texture | null = null;

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
    const note = document.createElement("div");
    note.className = "dr-cur";
    note.textContent = "読み込み済みアセット（このゲームは画像テクスチャ未使用＝実モデルのプレビュー）";
    this.element.appendChild(note);
  }

  onShow(): void {
    if (this.generated) return;
    this.generated = true;
    window.setTimeout(() => void this.build(), 0);
  }

  private async build(): Promise<void> {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_W, THUMB_H);

    // 金属マテリアル（武器など）は環境マップが無いと真っ黒になるため、簡易環境光を生成する。
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // 取込武器モデル（gltf）— 非同期で読み込みつつ並べる
    this.element.appendChild(this.section("武器モデル（取込・gltf）"));
    const gGrid = this.grid();
    this.element.appendChild(gGrid);
    const loader = new GLTFLoader();
    for (const [path, getUrl] of Object.entries(WEAPON_GLTF)) {
      try {
        const url = await getUrl();
        const gltf = await loader.loadAsync(url);
        const u = this.renderObject(renderer, gltf.scene);
        gGrid.appendChild(this.card(u, this.niceName(path)));
      } catch {
        // 読み込めないモデルはスキップ
      }
    }

    // ゲーム内武器（箱モデル）
    this.element.appendChild(this.section("ゲーム内武器"));
    const wGrid = this.grid();
    for (const w of INGAME_WEAPONS) {
      const model = this.app.ctx.weapons.devWeaponModel(w.kind).clone();
      model.position.set(0, 0, 0);
      wGrid.appendChild(this.card(this.renderObject(renderer, model), w.label));
    }
    this.element.appendChild(wGrid);

    // キャラクター
    this.element.appendChild(this.section("キャラクター"));
    const cGrid = this.grid();
    for (const c of CHARACTERS) {
      const unit = new EnemyUnit(c.opts);
      const u = this.renderObject(renderer, unit.group);
      unit.dispose();
      cGrid.appendChild(this.card(u, c.label));
    }
    this.element.appendChild(cGrid);

    // テクスチャ（キャラ・BaseColor 画像をそのまま表示）
    this.element.appendChild(this.section("テクスチャ（キャラ・BaseColor）"));
    const tGrid = this.grid();
    this.element.appendChild(tGrid);
    for (const [path, getUrl] of Object.entries(CHARACTER_TEX)) {
      try {
        const url = await getUrl();
        tGrid.appendChild(this.card(url, this.texName(path), "contain"));
      } catch {
        // 読み込めない画像はスキップ
      }
    }

    // ステージ（使い捨てシーンへ一時ロードして俯瞰描画→破棄）
    this.element.appendChild(this.section("ステージ"));
    const sGrid = this.grid();
    for (const s of STAGE_LIST) {
      const cardEl = this.card(this.renderStage(renderer, s.id), s.label);
      cardEl.style.cursor = "pointer";
      cardEl.title = "クリックで確認用ロード";
      cardEl.onclick = () => {
        this.app.ctx.stage.load(s.id);
        this.app.ctx.weapons.refreshShootables();
        const sp = this.app.ctx.stage.playerSpawn;
        this.app.ctx.player.respawn(sp.x, sp.y, sp.z);
      };
      sGrid.appendChild(cardEl);
    }
    this.element.appendChild(sGrid);

    // テクスチャ（ステージ・BaseColor 画像をそのまま表示）
    this.element.appendChild(this.section("テクスチャ（ステージ・BaseColor）"));
    const stGrid = this.grid();
    this.element.appendChild(stGrid);
    for (const [path, getUrl] of Object.entries(STAGE_TEX)) {
      try {
        const url = await getUrl();
        stGrid.appendChild(this.card(url, this.texName(path), "contain"));
      } catch {
        // 読み込めない画像はスキップ
      }
    }

    if (this.env) {
      this.env.dispose();
      this.env = null;
    }
    pmrem.dispose();
    renderer.dispose(); // WebGL コンテキストを解放
  }

  // 1オブジェクトを単独シーンで描画し dataURL を返す。
  private renderObject(renderer: THREE.WebGLRenderer, obj: THREE.Object3D): string {
    const scene = new THREE.Scene();
    scene.environment = this.env;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    scene.add(obj);
    const cam = this.frameCamera(obj);
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL("image/png");
    scene.remove(obj);
    return url;
  }

  // ステージを使い捨てシーンへ一時ロードし俯瞰描画→破棄して dataURL を返す。
  private renderStage(renderer: THREE.WebGLRenderer, id: StageId): string {
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
    renderer.render(scene, cam);
    const url = renderer.domElement.toDataURL("image/png");
    this.disposeScene(scene);
    return url;
  }

  // オブジェクトを画面に収めるカメラを作る。
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

  private disposeScene(scene: THREE.Scene): void {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) for (const m of mat) m.dispose();
      else if (mat) (mat as THREE.Material).dispose();
    });
  }

  // パスからカード名を作る（scifi_ar_1.gltf → "SciFi AR 1"）。
  private niceName(path: string): string {
    const base = path.split("/").pop()?.replace(/\.gltf$/i, "") ?? path;
    return base.replace(/^scifi_ar_/i, "SciFi AR ").replace(/_/g, " ");
  }

  // テクスチャのカード名（ファイル名から拡張子を除く）。
  private texName(path: string): string {
    return path.split("/").pop()?.replace(/\.png$/i, "") ?? path;
  }

  private section(title: string): HTMLElement {
    const h = document.createElement("div");
    h.className = "dr-cur";
    h.style.marginTop = "8px";
    h.textContent = title;
    return h;
  }

  private grid(): HTMLElement {
    const g = document.createElement("div");
    g.style.cssText = "display:flex;flex-wrap:wrap;gap:10px;";
    return g;
  }

  private card(url: string, label: string, fit: "cover" | "contain" = "cover"): HTMLElement {
    const card = document.createElement("div");
    card.style.cssText =
      "width:" + THUMB_W + "px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;" +
      "background:rgba(255,255,255,0.04);overflow:hidden;";
    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = "display:block;width:100%;height:" + THUMB_H + "px;object-fit:" + fit + ";background:#0c0e12;";
    const cap = document.createElement("div");
    cap.textContent = label;
    cap.style.cssText = "padding:4px 8px;font-size:12px;color:#cdd6e0;";
    card.appendChild(img);
    card.appendChild(cap);
    return card;
  }
}
