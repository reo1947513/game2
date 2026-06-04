import * as THREE from "three";
import { Input } from "./Input";
import { Stage } from "./Stage";
import { PlayerController } from "./PlayerController";
import { WeaponSystem } from "./WeaponSystem";
import { HUD } from "./HUD";

// すべてのシステムを組み合わせて毎フレーム動かす中心クラスです。
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private input: Input;
  private stage: Stage;
  private player: PlayerController;
  private weapons: WeaponSystem;
  private hud: HUD;

  private clock = new THREE.Clock();
  private eye = new THREE.Vector3();
  private running = false;

  constructor(container: HTMLElement) {
    // レンダラー
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // カメラ
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.05,
      300
    );

    // 入力（ポインタロックの対象はcanvas）
    this.input = new Input(this.renderer.domElement);

    // ステージ・プレイヤー・武器・HUD
    this.stage = new Stage(this.scene);
    this.player = new PlayerController(this.stage.colliders);
    this.hud = new HUD();
    this.weapons = new WeaponSystem(this.camera, this.scene, this.input, this.stage, this.hud);

    window.addEventListener("resize", this.onResize);
  }

  // クリックされたらポインタロックを要求して開始
  start(): void {
    this.input.requestLock();
    if (!this.running) {
      this.running = true;
      this.clock.start();
      this.loop();
    }
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private loop = (): void => {
    requestAnimationFrame(this.loop);

    // 経過時間。タブ復帰などで跳ねないよう上限を設ける。
    let dt = this.clock.getDelta();
    if (dt > 0.05) dt = 0.05;
    const now = performance.now() / 1000;

    // ポインタロック中だけ操作を受け付ける
    const locked = this.input.isLocked();
    const inputState = this.input.sample();
    if (!locked) {
      // 未ロック時は移動入力を無効化（視点は固定）
      inputState.forward = 0;
      inputState.right = 0;
      inputState.firing = false;
      inputState.aiming = false;
      inputState.jumpPressed = false;
    }

    // プレイヤー更新
    this.player.update(dt, inputState);

    // カメラ位置＝目線、向き＝マウスで作ったyaw/pitch（反動はInput側に加算済み）
    this.player.getEyePosition(this.eye);
    this.camera.position.copy(this.eye);
    this.camera.rotation.set(this.input.getPitch(), this.input.getYaw(), 0, "YXZ");

    // 武器・的・HUD更新
    this.weapons.update(dt, inputState, this.player.horizontalSpeed, now);
    this.stage.updateTargets(now);
    this.hud.update(dt);
    this.hud.setStance(this.player.stance);
    this.hud.setSpeed(this.player.horizontalSpeed);

    this.renderer.render(this.scene, this.camera);
  };
}
