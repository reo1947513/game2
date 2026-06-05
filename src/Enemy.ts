import * as THREE from "three";

// 敵の動作状態。歩く・攻撃する・止まる。
export type EnemyMode = "walk" | "attack" | "idle";

// 敵の見た目の設定（種類ごとに変える）
export interface EnemyOptions {
  scale?: number;
  bodyColor?: number;
  accentColor?: number;
}

// コードだけで組んだ人型の敵です。歩行と攻撃のモーションを持ち、
// 射撃を受けるための見えない当たり判定（hitbox）を内部に1枚だけ持ちます。
// ウェーブ・サバイバルとボット・デスマッチで共通して使います。
export class EnemyUnit {
  // シーンに追加し、位置と向きを動かすための入れ物
  group: THREE.Group;
  // 射撃の当たり判定に使う見えない箱（武器システムへ登録する対象）
  hitbox: THREE.Mesh;
  // 頭の当たり判定（ヘッドショット用）
  headHitbox: THREE.Mesh;

  private legL: THREE.Group;
  private legR: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private phase = 0; // 歩行の位相
  private attackPhase = 0; // 攻撃の位相

  private bodyMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshStandardMaterial;
  private hitMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[] = [];

  // 衝突判定用のおおよその寸法（半径と高さ）
  private readonly radius = 0.4;
  private readonly bodyHeight = 2.0;
  private scaleFactor = 1;

  constructor(opts: EnemyOptions = {}) {
    this.group = new THREE.Group();
    this.scaleFactor = opts.scale ?? 1;
    const bodyColor = opts.bodyColor ?? 0x23262e;
    const accentColor = opts.accentColor ?? 0xff6a00;

    // 本体色と差し色（種類ごとに変わる）
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.55,
      metalness: 0.35,
    });
    this.eyeMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 1.4,
    });

    // 胴
    const torsoG = new THREE.BoxGeometry(0.6, 0.9, 0.32);
    this.geos.push(torsoG);
    const torso = new THREE.Mesh(torsoG, this.bodyMat);
    torso.position.y = 1.25;
    torso.castShadow = true;
    this.group.add(torso);

    // 頭
    const headG = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    this.geos.push(headG);
    const head = new THREE.Mesh(headG, this.bodyMat);
    head.position.y = 1.9;
    head.castShadow = true;
    this.group.add(head);

    // 目（発光）
    const eyeG = new THREE.BoxGeometry(0.26, 0.06, 0.02);
    this.geos.push(eyeG);
    const eye = new THREE.Mesh(eyeG, this.eyeMat);
    eye.position.set(0, 1.92, 0.21);
    this.group.add(eye);

    // 胸の発光部
    const coreG = new THREE.BoxGeometry(0.18, 0.18, 0.02);
    this.geos.push(coreG);
    const core = new THREE.Mesh(coreG, this.eyeMat);
    core.position.set(0, 1.3, 0.17);
    this.group.add(core);

    // 脚と腕（それぞれ支点で前後に振れるようにする）
    this.legL = this.makeLimb(0.22, 0.8, -0.13, 0.8);
    this.legR = this.makeLimb(0.22, 0.8, 0.13, 0.8);
    this.armL = this.makeLimb(0.18, 0.7, -0.39, 1.6);
    this.armR = this.makeLimb(0.18, 0.7, 0.39, 1.6);

    // 当たり判定（見えない一枚の箱）。武器システムのレイ判定はこれに当たる。
    // 頭と重ならないよう、胴は高さ1.6・中心0.8にする。
    const hbG = new THREE.BoxGeometry(0.8, 1.6, 0.8);
    this.geos.push(hbG);
    this.hitMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.hitbox = new THREE.Mesh(hbG, this.hitMat);
    this.hitbox.position.y = 0.8;
    this.group.add(this.hitbox);

    // 頭の当たり判定（ヘッドショット用）。userData.isHead で頭と判別する。
    const headHbG = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    this.geos.push(headHbG);
    this.headHitbox = new THREE.Mesh(headHbG, this.hitMat);
    this.headHitbox.position.y = 1.9;
    this.headHitbox.userData.isHead = true;
    this.group.add(this.headHitbox);

    // 種類ごとの大きさを反映する（当たり判定も hitsCollider 側で連動）
    this.group.scale.setScalar(this.scaleFactor);
  }

  // 肩・股関節を支点にした手足を作る。支点で回すと前後に振れる。
  private makeLimb(w: number, h: number, x: number, y: number): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const g = new THREE.BoxGeometry(w, h, w);
    this.geos.push(g);
    const mesh = new THREE.Mesh(g, this.bodyMat);
    mesh.position.y = -h / 2; // 支点から下へ伸ばす
    mesh.castShadow = true;
    pivot.add(mesh);
    this.group.add(pivot);
    return pivot;
  }

  // 足元を地面に合わせて位置を置く
  setGround(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  // 目標へ向かって、壁やブロックを避けながら水平移動する。
  // 横と奥行きを別々に動かし、ぶつかった方向だけ取り消すので、壁沿いに滑れる。
  moveToward(
    tx: number,
    tz: number,
    speed: number,
    dt: number,
    colliders: THREE.Box3[]
  ): void {
    const dx = tx - this.group.position.x;
    const dz = tz - this.group.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return;
    const stepX = (dx / d) * speed * dt;
    const stepZ = (dz / d) * speed * dt;

    // 横方向に動かし、ぶつかったら戻す
    this.group.position.x += stepX;
    if (this.hitsCollider(colliders)) this.group.position.x -= stepX;

    // 奥行き方向に動かし、ぶつかったら戻す
    this.group.position.z += stepZ;
    if (this.hitsCollider(colliders)) this.group.position.z -= stepZ;
  }

  // 今の位置で、いずれかのブロックと重なっているか
  private hitsCollider(colliders: THREE.Box3[]): boolean {
    const r = this.radius * this.scaleFactor;
    const h = this.bodyHeight * this.scaleFactor;
    const minX = this.group.position.x - r;
    const maxX = this.group.position.x + r;
    const minZ = this.group.position.z - r;
    const maxZ = this.group.position.z + r;
    const minY = this.group.position.y;
    const maxY = this.group.position.y + h;
    for (const c of colliders) {
      if (
        maxX > c.min.x &&
        minX < c.max.x &&
        maxZ > c.min.z &&
        minZ < c.max.z &&
        maxY > c.min.y &&
        minY < c.max.y
      ) {
        return true;
      }
    }
    return false;
  }

  // 進む方向（水平）へ体を向ける
  faceTo(dx: number, dz: number): void {
    if (Math.abs(dx) + Math.abs(dz) > 0.0001) {
      this.group.rotation.y = Math.atan2(dx, dz);
    }
  }

  // 状態に応じてモーションを進める
  update(dt: number, mode: EnemyMode): void {
    if (mode === "walk") {
      this.phase += dt * 8;
      const s = Math.sin(this.phase) * 0.6;
      this.legL.rotation.x = s;
      this.legR.rotation.x = -s;
      this.armL.rotation.x = -s * 0.5;
      this.armR.rotation.x = s * 0.5;
    } else if (mode === "attack") {
      this.attackPhase += dt * 10;
      const swing = -1.2 - Math.sin(this.attackPhase) * 0.6;
      this.armR.rotation.x = swing; // 右腕を振り下ろす
      this.armL.rotation.x = -0.3;
      this.legL.rotation.x *= 0.8;
      this.legR.rotation.x *= 0.8;
    } else {
      // 止まっているときは少しずつ基準姿勢へ戻す
      this.legL.rotation.x *= 0.85;
      this.legR.rotation.x *= 0.85;
      this.armL.rotation.x *= 0.85;
      this.armR.rotation.x *= 0.85;
    }
  }

  // メッシュ類を破棄する
  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.bodyMat.dispose();
    this.eyeMat.dispose();
    this.hitMat.dispose();
  }
}
