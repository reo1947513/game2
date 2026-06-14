import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EditableSpec } from "./WeaponDefaults";

// DEV RANGE 用：アセットを大きく自動回転プレビューし、詳細を表示するモーダル。
// カードのクリックで open する。dev 層のため本番には含まれない。
export interface PreviewDetail {
  label: string;
  value: string;
}

const VW = 520;
const VH = 380;

export class PreviewModal {
  private overlay: HTMLElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private env: THREE.Texture | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private pivot: THREE.Group | null = null;
  private obj: THREE.Object3D | null = null;
  private raf = 0;
  private last = 0;

  // make: 表示する Object3D を生成（非同期可）。details: 右側に出す静的な詳細。
  // weapon: 指定すると性能カスタマイズUI＋「射撃場で使う」ボタンを表示する。
  open(
    make: () => Promise<THREE.Object3D | null>,
    title: string,
    details: PreviewDetail[],
    weapon?: { spec: EditableSpec; onUse: () => void }
  ): void {
    this.close();

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(4,6,10,0.78);font-family:system-ui,-apple-system,sans-serif;";
    overlay.addEventListener("keydown", (e) => e.stopPropagation());
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement("div");
    panel.style.cssText =
      "display:flex;flex-direction:column;gap:0;background:linear-gradient(180deg,rgba(18,22,28,0.99),rgba(10,12,16,0.99));" +
      "border:1px solid rgba(255,184,60,0.3);border-radius:12px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.7);";

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;" +
      "border-bottom:1px solid rgba(255,255,255,0.1);";
    const ttl = document.createElement("div");
    ttl.textContent = title;
    ttl.style.cssText = "font-weight:800;color:#ffce7a;font-size:14px;letter-spacing:0.04em;";
    const x = document.createElement("button");
    x.textContent = "× 閉じる";
    x.style.cssText =
      "font-size:12px;font-weight:700;color:#eee;cursor:pointer;background:rgba(255,255,255,0.08);" +
      "border:1px solid rgba(255,255,255,0.22);padding:4px 10px;border-radius:6px;";
    x.onclick = () => this.close();
    header.appendChild(ttl);
    header.appendChild(x);

    const body = document.createElement("div");
    body.style.cssText = "display:flex;gap:0;";

    const viewWrap = document.createElement("div");
    viewWrap.style.cssText = `width:${VW}px;height:${VH}px;background:#0c0e12;`;

    const info = document.createElement("div");
    info.style.cssText =
      "width:240px;height:" + VH + "px;overflow-y:auto;padding:12px 14px;font-size:12px;color:#cdd6e0;line-height:1.9;";
    const dl = document.createElement("div");
    info.appendChild(dl);
    if (weapon) info.appendChild(this.buildWeaponEditor(weapon));

    body.appendChild(viewWrap);
    body.appendChild(info);
    panel.appendChild(header);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    // 3D 準備
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(VW, VH);
    viewWrap.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const scene = new THREE.Scene();
    scene.environment = this.env;
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(3, 5, 4);
    scene.add(dir);
    const pivot = new THREE.Group();
    scene.add(pivot);
    const camera = new THREE.PerspectiveCamera(40, VW / VH, 0.01, 5000);
    camera.position.set(0, 0, 3);
    this.scene = scene;
    this.camera = camera;
    this.pivot = pivot;

    // ESC で閉じる
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") this.close();
    };
    window.addEventListener("keydown", onKey);
    overlay.dataset.hasKey = "1";
    (overlay as unknown as { _onKey: (e: KeyboardEvent) => void })._onKey = onKey;

    // モデル読み込み→配置＋詳細
    void make().then((obj) => {
      if (!obj || this.overlay !== overlay) return;
      this.obj = obj;
      const box = new THREE.Box3().setFromObject(obj);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      obj.position.sub(center); // pivot 中心へ
      pivot.add(obj);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      camera.position.set(0, maxDim * 0.25, maxDim * 2.4);
      camera.lookAt(0, 0, 0);

      // 詳細：静的＋自動算出（三角形数・サイズ）
      const all: PreviewDetail[] = [
        ...details,
        { label: "三角形数", value: this.countTriangles(obj).toLocaleString() },
        {
          label: "サイズ(WHD)",
          value: `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`,
        },
      ];
      dl.innerHTML = all
        .map((d) => `<div><span style="color:#8a93a0">${d.label}：</span><b>${d.value}</b></div>`)
        .join("");
    });

    this.last = performance.now();
    this.loop();
  }

  private loop = (): void => {
    if (!this.renderer || !this.scene || !this.camera) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.pivot) this.pivot.rotation.y += dt * 0.7; // 自動回転
    this.renderer.render(this.scene, this.camera);
  };

  // 性能カスタマイズUI（規定値を編集）＋「射撃場で使う」ボタン。spec を直接書き換える。
  private buildWeaponEditor(weapon: { spec: EditableSpec; onUse: () => void }): HTMLElement {
    const s = weapon.spec;
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:10px;border-top:1px solid rgba(255,255,255,0.12);padding-top:8px;";
    const head = document.createElement("div");
    head.textContent = "性能カスタマイズ";
    head.style.cssText = "font-weight:800;color:#ffce7a;font-size:12px;margin-bottom:6px;";
    wrap.appendChild(head);

    const num = (label: string, get: () => number, set: (v: number) => void, step: number): void => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:11px;color:#aeb6c0;margin:2px 0;";
      const lab = document.createElement("span");
      lab.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = String(step);
      inp.value = String(get());
      inp.style.cssText =
        "width:76px;background:rgba(255,255,255,0.06);color:#fff;border:1px solid rgba(255,255,255,0.2);" +
        "border-radius:4px;padding:2px 5px;font-size:11px;";
      inp.oninput = () => {
        const v = parseFloat(inp.value);
        if (isFinite(v)) set(v);
      };
      row.appendChild(lab);
      row.appendChild(inp);
      wrap.appendChild(row);
    };

    num("ダメージ", () => s.damage, (v) => (s.damage = v), 1);
    num("連射RPM", () => Math.round(60 / s.fireInterval), (v) => {
      if (v > 0) s.fireInterval = 60 / v;
    }, 10);
    num("マガジン", () => s.magSize, (v) => (s.magSize = Math.round(v)), 1);
    num("予備弾", () => s.reserveMax, (v) => (s.reserveMax = Math.round(v)), 1);
    num("リロード(秒)", () => s.reloadTime, (v) => (s.reloadTime = v), 0.1);
    num("縦反動", () => s.recoilKick, (v) => (s.recoilKick = v), 0.001);
    num("ADS視野角", () => s.adsFov, (v) => (s.adsFov = v), 1);
    num("ペレット", () => s.pellets ?? 1, (v) => (s.pellets = Math.round(v)), 1);

    const chkRow = document.createElement("label");
    chkRow.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;color:#aeb6c0;margin:4px 0;";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = !!s.automatic;
    chk.onchange = () => (s.automatic = chk.checked);
    chkRow.appendChild(chk);
    chkRow.appendChild(document.createTextNode("フルオート"));
    wrap.appendChild(chkRow);

    const use = document.createElement("button");
    use.textContent = "▶ 射撃場で使う";
    use.style.cssText =
      "width:100%;margin-top:8px;padding:8px;font-size:13px;font-weight:800;color:#1a1206;" +
      "background:linear-gradient(180deg,#ffd884,#f5a623);border:none;border-radius:8px;cursor:pointer;";
    use.onclick = () => {
      weapon.onUse();
      this.close();
    };
    wrap.appendChild(use);
    return wrap;
  }

  private countTriangles(obj: THREE.Object3D): number {
    let tris = 0;
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry as THREE.BufferGeometry;
      if (g.index) tris += g.index.count / 3;
      else if (g.attributes.position) tris += g.attributes.position.count / 3;
    });
    return Math.round(tris);
  }

  close(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.obj) {
      this.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      this.obj = null;
    }
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
    this.scene = null;
    this.camera = null;
    this.pivot = null;
    if (this.overlay) {
      const onKey = (this.overlay as unknown as { _onKey?: (e: KeyboardEvent) => void })._onKey;
      if (onKey) window.removeEventListener("keydown", onKey);
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
