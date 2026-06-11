import * as THREE from "three";

// 破片1個ぶん。
interface Shard {
  mesh: THREE.Mesh;
  geo: THREE.PlaneGeometry;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
}

// フラグ爆発1回ぶん。
interface FragEffect {
  fireball: THREE.Mesh;
  core: THREE.Mesh;
  light: THREE.PointLight;
  shards: Shard[];
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  t: number;
  dur: number;
}

// フラッシュ閃光1回ぶん。
interface FlashEffect {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  geo: THREE.BufferGeometry;
  mat: THREE.MeshBasicMaterial;
  t: number;
  dur: number;
}

// グレネードの爆発・閃光のビジュアルを生成・管理するクラスです。
// 火球・白コア・点光源・破片（カメラ正対のビルボード）でフラグ爆発を、
// 一気に膨らむ白球と強い点光源でフラッシュの閃光を表現します。
export class ExplosionFx {
  private frags: FragEffect[] = [];
  private flashes: FlashEffect[] = [];

  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {}

  // 指定位置にフラグ爆発を生成する（寿命0.5秒）。
  spawnFrag(x: number, y: number, z: number): void {
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];

    const ballGeo = new THREE.SphereGeometry(1, 16, 12);
    const ballMat = new THREE.MeshBasicMaterial({
      color: 0xffc070,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geos.push(ballGeo);
    mats.push(ballMat);
    const fireball = new THREE.Mesh(ballGeo, ballMat);
    fireball.position.set(x, y, z);
    this.scene.add(fireball);

    const coreGeo = new THREE.SphereGeometry(1, 16, 12);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xfff4dc,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    geos.push(coreGeo);
    mats.push(coreMat);
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(x, y, z);
    this.scene.add(core);

    const light = new THREE.PointLight(0xffa040, 9, 26);
    light.position.set(x, y, z);
    this.scene.add(light);

    // 破片16個。水平ランダム方位に飛ばし、上向き成分を加える。
    const shards: Shard[] = [];
    for (let i = 0; i < 16; i++) {
      const size = 0.1 + Math.random() * 0.12;
      const geo = new THREE.PlaneGeometry(size, size);
      const color = i % 2 === 0 ? 0xffc070 : 0xff7b1c;
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      const az = Math.random() * Math.PI * 2;
      const speed = 5 + Math.random() * 8; // 5〜13 m/s
      const up = (0.2 + Math.random() * 0.8) * speed;
      shards.push({
        mesh,
        geo,
        mat,
        vx: Math.cos(az) * speed,
        vy: up,
        vz: Math.sin(az) * speed,
      });
    }

    this.frags.push({ fireball, core, light, shards, geos, mats, t: 0, dur: 0.5 });
  }

  // 指定位置にフラッシュの閃光を生成する（寿命0.3秒）。
  spawnFlash(x: number, y: number, z: number): void {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);

    const light = new THREE.PointLight(0xffffff, 14, 40);
    light.position.set(x, y, z);
    this.scene.add(light);

    this.flashes.push({ mesh, light, geo, mat, t: 0, dur: 0.3 });
  }

  update(dt: number): void {
    // フラグ爆発
    for (let i = this.frags.length - 1; i >= 0; i--) {
      const fx = this.frags[i];
      fx.t += dt;
      const k = Math.max(0, 1 - fx.t / fx.dur); // 1→0
      if (fx.t >= fx.dur) {
        this.disposeFrag(fx);
        this.frags.splice(i, 1);
        continue;
      }
      fx.fireball.scale.setScalar(0.5 + (1 - k) * 4.5);
      (fx.fireball.material as THREE.MeshBasicMaterial).opacity = 0.95 * k;
      fx.core.scale.setScalar(0.3 + (1 - k) * 2.2);
      (fx.core.material as THREE.MeshBasicMaterial).opacity = k;
      fx.light.intensity = 9 * k;

      for (const s of fx.shards) {
        s.vy -= 26 * 0.6 * dt; // 破片の落下
        s.mesh.position.x += s.vx * dt;
        s.mesh.position.y += s.vy * dt;
        s.mesh.position.z += s.vz * dt;
        s.mesh.quaternion.copy(this.camera.quaternion); // カメラ正対
        s.mat.opacity = 0.9 * k;
      }
    }

    // フラッシュ閃光
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fx = this.flashes[i];
      fx.t += dt;
      const k = Math.max(0, 1 - fx.t / fx.dur);
      if (fx.t >= fx.dur) {
        this.scene.remove(fx.mesh);
        this.scene.remove(fx.light);
        fx.geo.dispose();
        fx.mat.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      fx.mesh.scale.setScalar(0.4 + (1 - k) * 7);
      fx.mat.opacity = k;
      fx.light.intensity = 14 * k;
    }
  }

  private disposeFrag(fx: FragEffect): void {
    this.scene.remove(fx.fireball);
    this.scene.remove(fx.core);
    this.scene.remove(fx.light);
    for (const s of fx.shards) {
      this.scene.remove(s.mesh);
      s.geo.dispose();
      s.mat.dispose();
    }
    for (const g of fx.geos) g.dispose();
    for (const m of fx.mats) m.dispose();
  }

  // 全エフェクトを即時破棄する（リセット用）。
  clear(): void {
    for (const fx of this.frags) this.disposeFrag(fx);
    this.frags = [];
    for (const fx of this.flashes) {
      this.scene.remove(fx.mesh);
      this.scene.remove(fx.light);
      fx.geo.dispose();
      fx.mat.dispose();
    }
    this.flashes = [];
  }
}
