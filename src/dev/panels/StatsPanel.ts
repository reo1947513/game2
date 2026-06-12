import * as THREE from "three";
import { DevApp, DevPanel } from "../devTypes";

// STATS タブ：renderer.info とフレーム統計のリアルタイム表示。
export class StatsPanel implements DevPanel {
  element: HTMLElement;

  private body!: HTMLElement;
  private acc = 0; // 表示更新の throttle 用
  private frames = 0;
  private sumDt = 0;

  constructor(private app: DevApp) {
    this.element = document.createElement("div");
    const cur = document.createElement("div");
    cur.className = "dr-cur";
    cur.textContent = "パフォーマンス統計";
    this.element.appendChild(cur);
    this.body = document.createElement("div");
    this.body.className = "dr-info";
    this.element.appendChild(this.body);
  }

  onShow(): void {
    this.acc = 1; // 表示に入ったら即更新
  }

  update(dt: number): void {
    this.frames++;
    this.sumDt += dt;
    this.acc += dt;
    if (this.acc < 0.25) return; // 4Hz で更新（レイアウト負荷を抑える）

    const avgDt = this.frames > 0 ? this.sumDt / this.frames : dt;
    const fps = avgDt > 0 ? 1 / avgDt : 0;
    const frameMs = avgDt * 1000;
    this.acc = 0;
    this.frames = 0;
    this.sumDt = 0;

    const info = this.app.ctx.renderer.info as THREE.WebGLInfo;
    const programs = info.programs ? info.programs.length : 0;

    const mem = (performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    const heap = mem
      ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}MB`
      : "（非対応ブラウザ）";

    this.body.innerHTML =
      `<div>FPS: <b>${fps.toFixed(1)}</b>　Frame time: <b>${frameMs.toFixed(1)}ms</b></div>` +
      `<div>Draw calls: <b>${info.render.calls}</b>　Triangles: <b>${info.render.triangles.toLocaleString()}</b></div>` +
      `<div>Geometries: <b>${info.memory.geometries}</b>　Textures: <b>${info.memory.textures}</b>　Programs: <b>${programs}</b></div>` +
      `<div>JS Heap: <b>${heap}</b></div>` +
      `<div>コライダー数: <b>${this.app.ctx.stage.colliders.length}</b></div>`;
  }
}
