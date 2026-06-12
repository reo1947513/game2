import * as THREE from "three";
import { CameraMode, DevApp, DevPanel } from "../devTypes";

// CAMERA タブ：カメラモード（FPS/Free/Orbit）切替、カメラ情報、座標コピー。
export class CameraPanel implements DevPanel {
  element: HTMLElement;

  private modeButtons = new Map<CameraMode, HTMLButtonElement>();
  private info!: HTMLElement;
  private dir = new THREE.Vector3();

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
    this.build();
  }

  private build(): void {
    const cur = document.createElement("div");
    cur.className = "dr-cur";
    cur.textContent = "カメラモード";
    this.element.appendChild(cur);

    const modes = document.createElement("div");
    modes.className = "dr-stages";
    const defs: Array<{ m: CameraMode; label: string }> = [
      { m: "fps", label: "FPS視点" },
      { m: "free", label: "フリーカメラ" },
      { m: "orbit", label: "オービット" },
    ];
    for (const d of defs) {
      const b = document.createElement("button");
      b.className = "dr-btn";
      b.textContent = d.label;
      b.onclick = () => this.app.setCameraMode(d.m);
      this.modeButtons.set(d.m, b);
      modes.appendChild(b);
    }
    this.element.appendChild(modes);

    const actions = document.createElement("div");
    actions.className = "dr-actions";
    actions.appendChild(
      this.btn("スポーン地点へ", () => {
        const sp = this.app.ctx.stage.playerSpawn;
        this.app.ctx.camera.position.set(sp.x, sp.y + 1.6, sp.z);
      })
    );
    const copy = this.btn("座標をコピー", () => {
      const p = this.app.ctx.camera.position;
      const json = `{ x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}, z: ${p.z.toFixed(2)} }`;
      void navigator.clipboard.writeText(json).then(() => {
        copy.textContent = "コピーしました";
        window.setTimeout(() => (copy.textContent = "座標をコピー"), 1200);
      });
    });
    actions.appendChild(copy);
    this.element.appendChild(actions);

    const hint = document.createElement("div");
    hint.className = "dr-info";
    hint.textContent =
      "フリー：クリックで視点ロック→WASD移動・見上げて前進で上昇・しゃがみで下降。オービット：ドラッグ回転／ホイールでズーム。";
    this.element.appendChild(hint);

    this.info = document.createElement("div");
    this.info.className = "dr-info";
    this.element.appendChild(this.info);
  }

  onShow(): void {
    this.refresh();
  }

  update(): void {
    this.refresh();
  }

  private refresh(): void {
    const mode = this.app.getCameraMode();
    for (const [m, b] of this.modeButtons) b.classList.toggle("on", m === mode);

    const cam = this.app.ctx.camera;
    cam.getWorldDirection(this.dir);
    const p = cam.position;
    this.info.innerHTML =
      `<div>Position: <b>(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})</b></div>` +
      `<div>Direction: <b>(${this.dir.x.toFixed(2)}, ${this.dir.y.toFixed(2)}, ${this.dir.z.toFixed(2)})</b>　FOV: <b>${cam.fov.toFixed(0)}</b></div>`;
  }

  private btn(text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "dr-btn";
    b.textContent = text;
    b.onclick = onClick;
    return b;
  }
}
