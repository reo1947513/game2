import * as THREE from "three";

// 一人称のナイフ。カメラの子として持ち、左→右への横薙ぎを行います。
// 刃はローカルの -Z 方向を向き、構えではヨー1.15radで刃先が画面左へ水平に伸びる
// CS風のグリップになります。横薙ぎ中もヨーは0.95〜1.35radに収まるため、
// 刃が自分側を向く瞬間は構造的に存在しません。
export class KnifeViewmodel {
  private group: THREE.Group;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  // 構え姿勢（カメラ空間）
  private readonly IDLE_P = new THREE.Vector3(0.3, -0.26, -0.5);
  private readonly IDLE_R = new THREE.Vector3(0.12, 1.15, 0.05);
  // 振りかぶり（左へクロス）
  private readonly LEFT_P = new THREE.Vector3(-0.4, -0.2, -0.42);
  private readonly LEFT_R = new THREE.Vector3(0.2, 1.35, 0.45);
  // 振り抜き終点（右外側）
  private readonly RIGHT_P = new THREE.Vector3(0.52, -0.27, -0.48);
  private readonly RIGHT_R = new THREE.Vector3(0.0, 0.95, -0.5);

  // 刃先のローカル座標（トレイル発生位置の取得に使う）
  private readonly TIP_LOCAL = new THREE.Vector3(0, 0, -0.4);

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();

    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xd8dde6,
      roughness: 0.25,
      metalness: 0.9,
    });
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x2a2118,
      roughness: 0.8,
      metalness: 0.1,
    });
    const armMat = new THREE.MeshStandardMaterial({
      color: 0x36404f,
      roughness: 0.7,
      metalness: 0.2,
    });
    this.mats.push(bladeMat, handleMat, armMat);

    // 刃
    const bladeG = new THREE.BoxGeometry(0.014, 0.05, 0.3);
    this.geos.push(bladeG);
    const blade = new THREE.Mesh(bladeG, bladeMat);
    blade.position.set(0, 0, -0.18);
    this.group.add(blade);

    // 切っ先（四角錐）
    const tipG = new THREE.ConeGeometry(0.027, 0.09, 4);
    this.geos.push(tipG);
    const tip = new THREE.Mesh(tipG, bladeMat);
    tip.rotation.x = -Math.PI / 2;
    tip.position.set(0, 0, -0.37);
    this.group.add(tip);

    // ガード（鍔）
    const guardG = new THREE.BoxGeometry(0.075, 0.02, 0.022);
    this.geos.push(guardG);
    const guard = new THREE.Mesh(guardG, bladeMat);
    guard.position.set(0, 0, -0.03);
    this.group.add(guard);

    // 柄
    const handleG = new THREE.BoxGeometry(0.032, 0.042, 0.13);
    this.geos.push(handleG);
    const handle = new THREE.Mesh(handleG, handleMat);
    handle.position.set(0, 0, 0.04);
    this.group.add(handle);

    // 柄頭
    const pommelG = new THREE.SphereGeometry(0.026, 12, 8);
    this.geos.push(pommelG);
    const pommel = new THREE.Mesh(pommelG, handleMat);
    pommel.position.set(0, 0, 0.11);
    this.group.add(pommel);

    // 前腕（切り口は球で覆う）
    const forearmG = new THREE.CylinderGeometry(0.038, 0.05, 0.32, 16);
    this.geos.push(forearmG);
    const forearm = new THREE.Mesh(forearmG, armMat);
    forearm.rotation.x = Math.PI / 2 - 0.5;
    forearm.position.set(0.015, -0.1, 0.2);
    this.group.add(forearm);

    // 手首
    const wristG = new THREE.SphereGeometry(0.04, 12, 8);
    this.geos.push(wristG);
    const wrist = new THREE.Mesh(wristG, armMat);
    wrist.position.set(0.005, -0.03, 0.08);
    this.group.add(wrist);

    // 肘
    const elbowG = new THREE.SphereGeometry(0.052, 12, 8);
    this.geos.push(elbowG);
    const elbow = new THREE.Mesh(elbowG, armMat);
    elbow.position.set(0.025, -0.17, 0.32);
    this.group.add(elbow);

    this.resetPose();
    this.group.visible = false;
    camera.add(this.group);
  }

  // 構え姿勢へ戻す。
  private resetPose(): void {
    this.group.position.copy(this.IDLE_P);
    this.group.rotation.set(this.IDLE_R.x, this.IDLE_R.y, this.IDLE_R.z);
  }

  // 斬りを開始する（表示して構えへ）。
  trigger(): void {
    this.group.visible = true;
    this.resetPose();
  }

  // 斬りを終える（非表示・初期姿勢へ）。
  end(): void {
    this.group.visible = false;
    this.resetPose();
  }

  // なめらかな補間（smoothstep）。
  private smooth(k: number): number {
    return k * k * (3 - 2 * k);
  }

  // 正規化時刻 t（0→1）でモーションを駆動する。
  setT(t: number): void {
    const p = this.group.position;
    const r = this.group.rotation;

    if (t < 0.2) {
      // 構え：IDLE→LEFT を smoothstep
      const s = this.smooth(t / 0.2);
      p.lerpVectors(this.IDLE_P, this.LEFT_P, s);
      r.x = THREE.MathUtils.lerp(this.IDLE_R.x, this.LEFT_R.x, s);
      r.y = THREE.MathUtils.lerp(this.IDLE_R.y, this.LEFT_R.y, s);
      r.z = THREE.MathUtils.lerp(this.IDLE_R.z, this.LEFT_R.z, s);
    } else if (t < 0.5) {
      // 一閃：LEFT→RIGHT を二乗加速。さらに弧を描くよう前へ膨らみ少し沈む。
      const k = (t - 0.2) / 0.3;
      const ke = k * k;
      p.lerpVectors(this.LEFT_P, this.RIGHT_P, ke);
      const bulge = Math.sin(ke * Math.PI);
      p.z -= bulge * 0.26;
      p.y -= bulge * 0.04;
      r.x = THREE.MathUtils.lerp(this.LEFT_R.x, this.RIGHT_R.x, ke);
      r.y = THREE.MathUtils.lerp(this.LEFT_R.y, this.RIGHT_R.y, ke);
      r.z = THREE.MathUtils.lerp(this.LEFT_R.z, this.RIGHT_R.z, ke);
    } else {
      // 戻し：RIGHT→IDLE を smoothstep
      const s = this.smooth((t - 0.5) / 0.5);
      p.lerpVectors(this.RIGHT_P, this.IDLE_P, s);
      r.x = THREE.MathUtils.lerp(this.RIGHT_R.x, this.IDLE_R.x, s);
      r.y = THREE.MathUtils.lerp(this.RIGHT_R.y, this.IDLE_R.y, s);
      r.z = THREE.MathUtils.lerp(this.RIGHT_R.z, this.IDLE_R.z, s);
    }
  }

  // 刃先の現在のワールド座標を out に書き込んで返す（トレイル生成に使う）。
  getTipWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    out.copy(this.TIP_LOCAL);
    return this.group.localToWorld(out);
  }

  dispose(): void {
    this.group.visible = false;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
