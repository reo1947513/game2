import * as THREE from "three";
import { AvatarState } from "./IAvatar";

// 頭上の名前ラベル＋HPバー。Canvas を貼った Sprite（常にカメラを向く）。
// sizeAttenuation により遠いほど小さく見える。
export class NameLabel {
  readonly object3d: THREE.Sprite;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;

  private name = "";
  private color = "#ffffff";
  private hpFrac = -1; // <0 で HPバー非表示
  private state: AvatarState = "alive";

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 256;
    this.canvas.height = 96;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthTest: false });
    this.object3d = new THREE.Sprite(mat);
    this.object3d.scale.set(1.4, 0.52, 1);
    this.object3d.position.set(0, 2.05, 0);
    this.redraw();
  }

  setName(name: string): void {
    this.name = name;
    this.redraw();
  }
  setColor(hex: number): void {
    this.color = "#" + hex.toString(16).padStart(6, "0");
    this.redraw();
  }
  // 0..1 で表示、<0 で非表示。
  setHp(frac: number): void {
    this.hpFrac = frac;
    this.redraw();
  }
  setState(state: AvatarState): void {
    this.state = state;
    this.object3d.visible = state !== "dead";
    this.redraw();
  }

  private redraw(): void {
    const g = this.ctx;
    g.clearRect(0, 0, 256, 96);
    // 名前
    g.font = "bold 30px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 5;
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(this.name, 128, 30);
    g.fillStyle = this.state === "down" ? "#9aa0a6" : this.color;
    g.fillText(this.name, 128, 30);
    // HPバー
    if (this.hpFrac >= 0) {
      const w = 180;
      const x = (256 - w) / 2;
      const y = 62;
      g.fillStyle = "rgba(0,0,0,0.6)";
      g.fillRect(x - 2, y - 2, w + 4, 16);
      const f = Math.max(0, Math.min(1, this.hpFrac));
      g.fillStyle = f > 0.5 ? "#5fd36a" : f > 0.25 ? "#ffce5a" : "#ff5a4d";
      g.fillRect(x, y, w * f, 12);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    (this.object3d.material as THREE.SpriteMaterial).dispose();
  }
}
