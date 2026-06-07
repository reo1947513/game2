import * as THREE from "three";

// 一人称のナイフ斬りモーション。画面の右上で構え、左下へ斜めに薙ぐ。
// 蹴りと同じく、攻撃のあいだだけ手元にナイフを出して振る。
export class KnifeView {
  private group: THREE.Group; // ナイフ全体（カメラの子）
  private pivot: THREE.Group; // 手元。ここを軸に斜めへ振る

  private active = false;
  private t = 0; // アニメ進行（0〜1）
  private readonly DUR = 0.26; // 斬り1回の所要時間（秒）

  // 左端・高さ中央(Y0)で構え、右下端へ斜めに切り下げる姿勢
  private readonly FROM_ROT = -1.0; // 構え：刃を右上へ立てる
  private readonly TO_ROT = 0.5; // 斬り切り：右下へ振り下ろす
  private readonly FROM_POS = new THREE.Vector3(-0.4, 0.0, -0.6); // 左端・Y0
  private readonly TO_POS = new THREE.Vector3(0.4, -0.32, -0.55); // 右下端

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x1a1c20,
      roughness: 0.6,
      metalness: 0.3,
    });
    const guardMat = new THREE.MeshStandardMaterial({
      color: 0x2c2f36,
      roughness: 0.5,
      metalness: 0.4,
    });
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xcfd6e0,
      roughness: 0.25,
      metalness: 0.85,
      emissive: 0x202428,
      emissiveIntensity: 0.2,
    });
    this.mats.push(handleMat, guardMat, bladeMat);

    // 柄（手元。下側に置く）
    const handleG = new THREE.BoxGeometry(0.05, 0.2, 0.05);
    this.geos.push(handleG);
    const handle = new THREE.Mesh(handleG, handleMat);
    handle.position.set(0, -0.1, 0);
    this.pivot.add(handle);

    // 鍔（柄と刃の境）
    const guardG = new THREE.BoxGeometry(0.14, 0.04, 0.07);
    this.geos.push(guardG);
    const guard = new THREE.Mesh(guardG, guardMat);
    guard.position.set(0, 0.01, 0);
    this.pivot.add(guard);

    // 刃（上へ伸ばす。先を少し前へ倒して斬る形にする）
    const bladeG = new THREE.BoxGeometry(0.045, 0.42, 0.11);
    this.geos.push(bladeG);
    const blade = new THREE.Mesh(bladeG, bladeMat);
    blade.position.set(0, 0.24, 0.02);
    blade.rotation.x = -0.18;
    this.pivot.add(blade);

    // 刃先（先細りの代わりに小さく付ける）
    const tipG = new THREE.BoxGeometry(0.045, 0.12, 0.06);
    this.geos.push(tipG);
    const tip = new THREE.Mesh(tipG, bladeMat);
    tip.position.set(0, 0.5, 0.04);
    tip.rotation.x = -0.35;
    this.pivot.add(tip);

    // 初期は構えの姿勢で隠しておく
    this.pivot.position.copy(this.FROM_POS);
    this.pivot.rotation.z = this.FROM_ROT;
    this.group.visible = false;

    camera.add(this.group);
  }

  // 斬りを開始する
  trigger(): void {
    this.active = true;
    this.t = 0;
    this.group.visible = true;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt / this.DUR;
    if (this.t >= 1) {
      this.active = false;
      this.group.visible = false;
      // 次に備えて構えへ戻す
      this.pivot.position.copy(this.FROM_POS);
      this.pivot.rotation.z = this.FROM_ROT;
      return;
    }

    // 薙ぎ（前半）は素早く、戻し（後半）はやや遅く。
    const slashOut = 0.45; // 薙ぎが終わる進行度
    let s: number; // 0=構え（右上）, 1=斬り切り（左下）
    if (this.t < slashOut) {
      const u = this.t / slashOut;
      s = 1 - (1 - u) * (1 - u); // easeOut：素早く薙ぐ
    } else {
      const u = (this.t - slashOut) / (1 - slashOut);
      s = 1 - u * u; // easeIn：構えへ戻す
    }

    this.pivot.rotation.z = this.FROM_ROT + (this.TO_ROT - this.FROM_ROT) * s;
    this.pivot.position.set(
      this.FROM_POS.x + (this.TO_POS.x - this.FROM_POS.x) * s,
      this.FROM_POS.y + (this.TO_POS.y - this.FROM_POS.y) * s,
      this.FROM_POS.z + (this.TO_POS.z - this.FROM_POS.z) * s
    );
  }

  dispose(): void {
    this.group.visible = false;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
