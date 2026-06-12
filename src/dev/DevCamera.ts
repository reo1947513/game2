import * as THREE from "three";
import { InputState } from "../types";
import { CameraMode, DevCtx } from "./devTypes";

// DEV RANGE のデバッグカメラ。
// Free：ポインタロック＋WASD/QE 相当（視線方向へ自由飛行、Shiftで高速、しゃがみで下降）。
// Orbit：注視点まわりをマウスドラッグで回転、ホイールでズーム。
export class DevCamera {
  private mode: CameraMode = "fps";

  // Orbit 状態
  private target = new THREE.Vector3(0, 1, 0);
  private azimuth = 0;
  private elevation = 0.5;
  private radius = 18;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private attached = false;

  constructor(private ctx: DevCtx) {}

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "orbit") {
      this.target.copy(this.ctx.player.position);
      this.target.y += 1;
      this.attachOrbit();
    } else {
      this.detachOrbit();
    }
  }

  update(dt: number, input: InputState): void {
    if (this.mode === "free") this.updateFree(dt, input);
    else if (this.mode === "orbit") this.updateOrbit();
  }

  // ===== Free（自由飛行）=====
  private updateFree(dt: number, input: InputState): void {
    const cam = this.ctx.camera;
    const yaw = this.ctx.input.getYaw();
    const pitch = this.ctx.input.getPitch();
    cam.rotation.set(pitch, yaw, 0, "YXZ");

    const speed = input.sprint ? 26 : 10;
    const cp = Math.cos(pitch);
    const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    const rgt = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3();
    move.addScaledVector(fwd, input.forward);
    move.addScaledVector(rgt, input.right);
    if (input.crouch) move.y -= 1; // しゃがみで真下へ
    if (move.lengthSq() > 0) move.normalize();
    cam.position.addScaledVector(move, speed * dt);
  }

  // ===== Orbit（周回）=====
  private updateOrbit(): void {
    const cam = this.ctx.camera;
    const el = Math.max(-1.45, Math.min(1.45, this.elevation));
    const x = this.target.x + this.radius * Math.cos(el) * Math.sin(this.azimuth);
    const y = this.target.y + this.radius * Math.sin(el);
    const z = this.target.z + this.radius * Math.cos(el) * Math.cos(this.azimuth);
    cam.position.set(x, y, z);
    cam.lookAt(this.target);
  }

  private onDown = (e: MouseEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };
  private onMove = (e: MouseEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.azimuth -= dx * 0.005;
    this.elevation += dy * 0.005;
  };
  private onUp = (): void => {
    this.dragging = false;
  };
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.radius = Math.max(3, Math.min(90, this.radius + e.deltaY * 0.02));
  };

  private attachOrbit(): void {
    if (this.attached) return;
    const el = this.ctx.renderer.domElement;
    el.addEventListener("mousedown", this.onDown);
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mouseup", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    this.attached = true;
  }

  private detachOrbit(): void {
    if (!this.attached) return;
    const el = this.ctx.renderer.domElement;
    el.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("mouseup", this.onUp);
    el.removeEventListener("wheel", this.onWheel);
    this.dragging = false;
    this.attached = false;
  }
}
