import * as THREE from "three";
import { Grenade } from "./Grenade";

// 手榴弾の全体管理。長押し中は放物線の軌道を点で見せ、離すと投げる。
// 飛行・爆発・爆発エフェクト・所持数をまとめて扱い、爆発時にコールバックで通知する。
export class GrenadeSystem {
  private grenades: Grenade[] = [];
  private previewDots: THREE.Mesh[] = [];
  private explosions: {
    mesh: THREE.Mesh;
    t: number;
    dur: number;
    geo: THREE.BufferGeometry;
    mat: THREE.MeshBasicMaterial;
  }[] = [];

  private enabled = false;
  private ammo = 0;

  private readonly THROW_SPEED = 20; // 投擲の初速
  private readonly THROW_UP = 4.5; // 上向きに加える初速
  private readonly G = 22; // 重力（軌道予測用。Grenade と合わせる）
  private readonly STEP = 0.07; // 軌道予測の時間刻み
  private readonly RADIUS = 4.5; // 爆発の半径

  // 爆発したとき呼ばれる。爆発位置と半径を渡す。範囲内の敵処理はモード側で行う。
  onExplode: ((x: number, y: number, z: number, radius: number) => void) | null = null;
  // 所持数が変わったとき呼ばれる。HUD表示などに使う。
  onAmmoChange: ((ammo: number) => void) | null = null;

  private dotGeo: THREE.SphereGeometry;
  private dotMat: THREE.MeshBasicMaterial;

  constructor(private scene: THREE.Scene) {
    // 軌道予測の点（あらかじめ作っておき、毎フレーム位置だけ更新する）
    this.dotGeo = new THREE.SphereGeometry(0.07, 8, 6);
    this.dotMat = new THREE.MeshBasicMaterial({
      color: 0xffd23a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    for (let i = 0; i < 30; i++) {
      const dot = new THREE.Mesh(this.dotGeo, this.dotMat);
      dot.visible = false;
      this.scene.add(dot);
      this.previewDots.push(dot);
    }
  }

  // 手榴弾を使えるモードかどうかを切り替える
  setEnabled(b: boolean): void {
    this.enabled = b;
    if (!b) this.hidePreview();
  }

  setAmmo(n: number): void {
    this.ammo = n;
    if (this.onAmmoChange) this.onAmmoChange(this.ammo);
  }

  getAmmo(): number {
    return this.ammo;
  }

  update(
    dt: number,
    held: boolean,
    released: boolean,
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    colliders: THREE.Box3[]
  ): void {
    // 軌道プレビュー：長押し中かつ残弾があるときだけ出す
    if (this.enabled && held && this.ammo > 0) this.showPreview(origin, dir);
    else this.hidePreview();

    // 投擲：離した瞬間かつ残弾があれば投げる
    if (this.enabled && released && this.ammo > 0) {
      this.throwGrenade(origin, dir);
      this.setAmmo(this.ammo - 1);
    }

    // 飛行中の手榴弾を進める
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.update(dt, colliders)) {
        const p = g.getPosition();
        if (this.onExplode) this.onExplode(p.x, p.y, p.z, this.RADIUS);
        this.spawnExplosion(p.x, p.y, p.z);
        g.dispose(this.scene);
        this.grenades.splice(i, 1);
      }
    }

    // 爆発エフェクト（光球が膨らんで消える）
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.t += dt;
      const k = ex.t / ex.dur;
      ex.mesh.scale.setScalar(0.5 + k * this.RADIUS * 1.6);
      ex.mat.opacity = Math.max(0, 0.6 * (1 - k));
      if (ex.t >= ex.dur) {
        this.scene.remove(ex.mesh);
        ex.geo.dispose();
        ex.mat.dispose();
        this.explosions.splice(i, 1);
      }
    }
  }

  // モード終了時などに、飛行中の手榴弾とプレビューを片付ける
  clear(): void {
    for (const g of this.grenades) g.dispose(this.scene);
    this.grenades = [];
    this.hidePreview();
  }

  private throwGrenade(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const vel = dir.clone().multiplyScalar(this.THROW_SPEED);
    vel.y += this.THROW_UP;
    const g = new Grenade(origin, vel);
    this.scene.add(g.group);
    this.grenades.push(g);
  }

  private showPreview(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const vx = dir.x * this.THROW_SPEED;
    const vy = dir.y * this.THROW_SPEED + this.THROW_UP;
    const vz = dir.z * this.THROW_SPEED;
    let shown = 0;
    for (let i = 0; i < this.previewDots.length; i++) {
      const t = i * this.STEP;
      const py = origin.y + vy * t - 0.5 * this.G * t * t;
      if (py <= 0.05) break; // 地面より下は描かない
      const dot = this.previewDots[i];
      dot.position.set(origin.x + vx * t, py, origin.z + vz * t);
      dot.visible = true;
      shown = i + 1;
    }
    for (let i = shown; i < this.previewDots.length; i++) {
      this.previewDots[i].visible = false;
    }
  }

  private hidePreview(): void {
    for (const d of this.previewDots) d.visible = false;
  }

  private spawnExplosion(x: number, y: number, z: number): void {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffa033,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.5);
    this.scene.add(mesh);
    this.explosions.push({ mesh, t: 0, dur: 0.4, geo, mat });
  }
}
