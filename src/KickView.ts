import * as THREE from "three";

// 一人称の蹴りモーション。画面の下から脚（すね・膝・ブーツ）を前方へ
// 勢いよく振り上げて蹴る。平面の軌跡は使わず、立体の脚そのものを見せる。
export class KickView {
  private group: THREE.Group; // 脚全体（カメラの子）
  private pivot: THREE.Group; // 付け根。ここを軸に脚を振る

  private active = false;
  private t = 0; // アニメ進行（0〜1）
  private readonly DUR = 0.32; // 蹴り1回の所要時間（秒）
  private readonly FROM = -Math.PI * 0.5; // 始め：脚を後ろへ畳んで画面外に隠す
  private readonly TO = Math.PI * 0.55; // 蹴り切り：前方やや上へ振り上げる

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();

    // 付け根は画面のやや右・下・手前。ここを軸に脚を前へ振り出す。
    this.pivot.position.set(0.2, -0.5, -0.35);
    this.group.add(this.pivot);

    const legMat = new THREE.MeshStandardMaterial({
      color: 0x2a2e36,
      roughness: 0.6,
      metalness: 0.2,
    });
    const kneeMat = new THREE.MeshStandardMaterial({
      color: 0x343943,
      roughness: 0.55,
      metalness: 0.25,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x0e1014,
      roughness: 0.45,
      metalness: 0.35,
    });
    this.mats.push(legMat, kneeMat, bootMat);

    // すね（付け根から下へ伸ばす）
    const shinG = new THREE.BoxGeometry(0.18, 0.55, 0.18);
    this.geos.push(shinG);
    const shin = new THREE.Mesh(shinG, legMat);
    shin.position.set(0, -0.28, 0);
    this.pivot.add(shin);

    // 膝あて
    const kneeG = new THREE.BoxGeometry(0.2, 0.16, 0.2);
    this.geos.push(kneeG);
    const knee = new THREE.Mesh(kneeG, kneeMat);
    knee.position.set(0, -0.02, 0.01);
    this.pivot.add(knee);

    // ブーツ（前方へ突き出す）
    const bootG = new THREE.BoxGeometry(0.22, 0.18, 0.4);
    this.geos.push(bootG);
    const boot = new THREE.Mesh(bootG, bootMat);
    boot.position.set(0, -0.56, 0.1);
    this.pivot.add(boot);

    // つま先（蹴る先端）
    const toeG = new THREE.BoxGeometry(0.2, 0.13, 0.14);
    this.geos.push(toeG);
    const toe = new THREE.Mesh(toeG, bootMat);
    toe.position.set(0, -0.59, 0.32);
    this.pivot.add(toe);

    // 初期は脚を後ろへ畳んで隠す
    this.pivot.rotation.x = this.FROM;
    this.group.visible = false;

    camera.add(this.group);
  }

  // 蹴りを開始する
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
      return;
    }

    // 振り出し（前半）は素早く勢いよく、戻り（後半）はやや遅く。
    const kickOut = 0.4; // 振り出しが終わる進行度
    let swing: number; // 0=畳み（隠れ）, 1=蹴り切り（前方）
    if (this.t < kickOut) {
      const u = this.t / kickOut;
      swing = 1 - (1 - u) * (1 - u); // easeOut：勢いよく出る
    } else {
      const u = (this.t - kickOut) / (1 - kickOut);
      swing = 1 - u * u; // easeIn：戻る
    }

    // 脚の振り角度
    this.pivot.rotation.x = this.FROM + (this.TO - this.FROM) * swing;
    // 蹴り切りに向けて少し前へ踏み込む見せ方
    this.pivot.position.z = -0.35 - swing * 0.12;
  }

  dispose(): void {
    this.group.visible = false;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
