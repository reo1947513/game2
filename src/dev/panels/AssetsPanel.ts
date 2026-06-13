import * as THREE from "three";
import { WeaponKind } from "../../types";
import { Stage, STAGE_LIST, StageId } from "../../Stage";
import { EnemyUnit } from "../../Enemy";
import { DevApp, DevPanel } from "../devTypes";

// ASSETS タブ：読み込み済みの3Dアセット（武器・キャラクター・ステージ）を
// オフスクリーンで描画したサムネイルでカテゴリ別に一覧する。
// このゲームは画像テクスチャを使わない（全て単色マテリアル）ため、テクスチャではなく
// 実モデルのプレビューを表示する。サムネイルは初回表示時に一括生成してキャッシュする。

const WEAPONS: Array<{ kind: WeaponKind; label: string }> = [
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
    // レンダラ生成〜描画はやや重いので次フレームに回し、初回マウントの操作感を保つ。
    window.setTimeout(() => this.build(), 0);
  }

  private build(): void {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(THUMB_W, THUMB_H);

    // 武器
    this.element.appendChild(this.section("武器"));
    const wGrid = this.grid();
    for (const w of WEAPONS) {
      const model = this.app.ctx.weapons.devWeaponModel(w.kind).clone();
      model.position.set(0, 0, 0);
      const url = this.renderObject(renderer, model);
      wGrid.appendChild(this.card(url, w.label));
    }
    this.element.appendChild(wGrid);

    // キャラクター
    this.element.appendChild(this.section("キャラクター"));
    const cGrid = this.grid();
    for (const c of CHARACTERS) {
      const unit = new EnemyUnit(c.opts);
      const url = this.renderObject(renderer, unit.group);
      unit.dispose();
      cGrid.appendChild(this.card(url, c.label));
    }
    this.element.appendChild(cGrid);

    // ステージ（使い捨てシーンへ一時ロードして俯瞰描画→破棄）
    this.element.appendChild(this.section("ステージ"));
    const sGrid = this.grid();
    for (const s of STAGE_LIST) {
      const url = this.renderStage(renderer, s.id);
      const cardEl = this.card(url, s.label);
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

    renderer.dispose(); // WebGL コンテキストを解放
  }

  // 1オブジェクトを単独シーンで描画し dataURL を返す。
  private renderObject(renderer: THREE.WebGLRenderer, obj: THREE.Object3D): string {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
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
    const cam = new THREE.PerspectiveCamera(40, THUMB_W / THUMB_H, 0.01, 1000);
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

  private card(url: string, label: string): HTMLElement {
    const card = document.createElement("div");
    card.style.cssText =
      "width:" + THUMB_W + "px;border:1px solid rgba(255,255,255,0.14);border-radius:8px;" +
      "background:rgba(255,255,255,0.04);overflow:hidden;";
    const img = document.createElement("img");
    img.src = url;
    img.style.cssText = "display:block;width:100%;height:" + THUMB_H + "px;object-fit:cover;background:#0c0e12;";
    const cap = document.createElement("div");
    cap.textContent = label;
    cap.style.cssText = "padding:4px 8px;font-size:12px;color:#cdd6e0;";
    card.appendChild(img);
    card.appendChild(cap);
    return card;
  }
}
