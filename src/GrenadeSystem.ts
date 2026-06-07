import * as THREE from "three";
import { Grenade } from "./Grenade";

// 手榴弾の全体管理。長押し中は放物線の軌道を線で見せ、離すと投げる。
// 飛行・爆発・爆発エフェクト・所持数をまとめて扱い、爆発時にコールバックで通知する。
export class GrenadeSystem {
  private grenades: Grenade[] = [];
  private lineMesh!: THREE.Mesh; // 軌道の連続線（チューブ）
  private lineMat!: THREE.MeshBasicMaterial;
  private ringMesh!: THREE.Mesh; // 着弾点の輪
  private ringMat!: THREE.MeshBasicMaterial;
  private explosions: {
    mesh: THREE.Mesh;
    t: number;
    dur: number;
    geo: THREE.BufferGeometry;
    mat: THREE.MeshBasicMaterial;
  }[] = [];

  private enabled = false;
  private ammo = 0;
  private readonly MAX_AMMO = 5; // 所持できる手榴弾の上限
  private hudEl: HTMLElement; // 所持数の画面表示

  private readonly THROW_SPEED = 20; // 投擲の初速
  private readonly THROW_UP = 4.5; // 上向きに加える初速
  private readonly G = 22; // 重力（軌道予測用。Grenade と合わせる）
  private readonly STEP = 0.07; // 軌道予測の時間刻み
  private readonly RADIUS = 4.5; // 爆発の半径

  // 爆発したとき呼ばれる。爆発位置と半径を渡す。範囲内の敵処理はモード側で行う。
  onExplode: ((x: number, y: number, z: number, radius: number) => void) | null = null;
  // 所持数が変わったとき呼ばれる。HUD表示などに使う。
  onAmmoChange: ((ammo: number) => void) | null = null;

  constructor(private scene: THREE.Scene) {
    // 軌道の連続線（チューブ）。毎フレーム形だけ作り直す。
    this.lineMat = new THREE.MeshBasicMaterial({
      color: 0xff5a2a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.lineMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.lineMat);
    this.lineMesh.visible = false;
    this.lineMesh.frustumCulled = false;
    this.scene.add(this.lineMesh);

    // 着弾点の輪（地面に水平に置く）
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5a2a,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.35, 0.5, 24);
    this.ringMesh = new THREE.Mesh(ringGeo, this.ringMat);
    this.ringMesh.rotation.x = -Math.PI / 2;
    this.ringMesh.visible = false;
    this.scene.add(this.ringMesh);

    // 所持数の画面表示（手榴弾が使えるモードのときだけ出す）
    this.hudEl = document.createElement("div");
    this.hudEl.id = "grenade-count";
    this.hudEl.style.cssText =
      "position:fixed; left:24px; bottom:96px; color:#ffd23a; font-weight:bold;" +
      " font-size:20px; text-shadow:0 1px 3px rgba(0,0,0,0.8);" +
      " font-family:system-ui,sans-serif; pointer-events:none; z-index:50; display:none;";
    this.hudEl.textContent = "手榴弾 0";
    document.body.appendChild(this.hudEl);
  }

  // 手榴弾を使えるモードかどうかを切り替える
  setEnabled(b: boolean): void {
    this.enabled = b;
    this.hudEl.style.display = b ? "block" : "none";
    if (!b) this.hidePreview();
  }

  setAmmo(n: number): void {
    this.ammo = Math.max(0, Math.min(this.MAX_AMMO, n));
    this.hudEl.textContent = `手榴弾 ${this.ammo}`;
    if (this.onAmmoChange) this.onAmmoChange(this.ammo);
  }

  // アイテムで補充する。上限を超えない範囲で増やす。
  addAmmo(n: number): void {
    this.setAmmo(this.ammo + n);
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

    // 放物線に沿った点を集め、地面に着いたところで打ち切る
    const pts: THREE.Vector3[] = [];
    let landing: THREE.Vector3 | null = null;
    for (let i = 0; i < 80; i++) {
      const t = i * this.STEP;
      const py = origin.y + vy * t - 0.5 * this.G * t * t;
      const px = origin.x + vx * t;
      const pz = origin.z + vz * t;
      if (py <= 0.05) {
        landing = new THREE.Vector3(px, 0.06, pz);
        break;
      }
      pts.push(new THREE.Vector3(px, py, pz));
    }

    if (pts.length < 2) {
      this.hidePreview();
      return;
    }
    if (landing) pts.push(landing);

    // 点を滑らかな曲線にして、太いチューブの線として描く
    const curve = new THREE.CatmullRomCurve3(pts);
    const segments = Math.max(12, pts.length * 2);
    const geo = new THREE.TubeGeometry(curve, segments, 0.05, 8, false);
    this.lineMesh.geometry.dispose();
    this.lineMesh.geometry = geo;
    this.lineMesh.visible = true;

    // 着弾点に輪を出す
    if (landing) {
      this.ringMesh.position.set(landing.x, 0.06, landing.z);
      this.ringMesh.visible = true;
    } else {
      this.ringMesh.visible = false;
    }
  }

  private hidePreview(): void {
    this.lineMesh.visible = false;
    this.ringMesh.visible = false;
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
