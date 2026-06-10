import * as THREE from "three";

// 1枚ぶんの斬撃トレイルの板。
interface TrailPlane {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  mat: THREE.MeshBasicMaterial;
  life: number; // 残り寿命（秒）
  maxLife: number; // 生成時の寿命
}

// ナイフの一閃に合わせて、刃先が通った軌跡に光の板を点々と置き、
// 消えながら広がるトレイルにします。常にカメラへ正対させて板の薄さを隠します。
export class SlashTrail {
  private planes: TrailPlane[] = [];
  // 前フレームの刃先のワールド座標。一閃の外では null に戻して軌跡が繋がらないようにします。
  private prevTip: THREE.Vector3 | null = null;

  private readonly MAX_LIFE = 0.16;
  private readonly STEP = 0.03; // 補間点の間隔（m）

  constructor(private scene: THREE.Scene) {}

  // 一閃フェーズ中に毎フレーム呼ぶ。現在の刃先位置までを細かく分割して板を置く。
  emit(tip: THREE.Vector3, camera: THREE.Camera): void {
    if (this.prevTip === null) {
      // 初回フレームは前位置がないので、現在位置に1枚だけ置く。
      this.spawnPlane(tip, camera);
    } else {
      const dist = this.prevTip.distanceTo(tip);
      const count = Math.max(1, Math.floor(dist / this.STEP));
      const point = new THREE.Vector3();
      for (let i = 1; i <= count; i++) {
        point.lerpVectors(this.prevTip, tip, i / count);
        this.spawnPlane(point, camera);
      }
    }
    this.prevTip = this.prevTip ?? new THREE.Vector3();
    this.prevTip.copy(tip);
  }

  // 一閃フェーズの外で呼ぶ。前位置を忘れ、戻りモーション中に軌跡が伸びないようにする。
  resetPrev(): void {
    this.prevTip = null;
  }

  private spawnPlane(pos: THREE.Vector3, camera: THREE.Camera): void {
    const size = 0.05 + Math.random() * 0.05;
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe9b8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    // 常にカメラへ正対させ、そのうえで視線軸まわりにランダムな回転を加える。
    mesh.quaternion.copy(camera.quaternion);
    mesh.rotateZ(Math.random() * Math.PI);
    this.scene.add(mesh);
    this.planes.push({ mesh, geo, mat, life: this.MAX_LIFE, maxLife: this.MAX_LIFE });
  }

  // 毎フレーム呼ぶ。板を寿命に応じて薄く・大きくし、寿命切れは破棄する。
  update(dt: number): void {
    for (let i = this.planes.length - 1; i >= 0; i--) {
      const p = this.planes[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.geo.dispose();
        p.mat.dispose();
        this.planes.splice(i, 1);
        continue;
      }
      const k = p.life / p.maxLife; // 1→0
      p.mat.opacity = 0.85 * k;
      const scale = 0.6 + (1 - k) * 0.9;
      p.mesh.scale.setScalar(scale);
    }
  }

  // モード終了などで一括破棄する。
  clear(): void {
    for (const p of this.planes) {
      this.scene.remove(p.mesh);
      p.geo.dispose();
      p.mat.dispose();
    }
    this.planes = [];
    this.prevTip = null;
  }
}
