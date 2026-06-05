import * as THREE from "three";

// 一人称の蹴りモーション。画面の下から勢いよく脚を前方へ振り上げ、
// 振りの軌跡（半透明の帯）を残して迫力を出す。カメラの子として表示する。
export class KickView {
  private group: THREE.Group; // 脚全体（カメラの子）
  private pivot: THREE.Group; // 付け根。ここを軸に脚を振る
  private trail: THREE.Mesh; // 蹴りの軌跡
  private trailMat: THREE.MeshBasicMaterial;

  private active = false;
  private t = 0; // アニメ進行（0〜1）
  private readonly DUR = 0.34; // 蹴り1回の所要時間（秒）
  private readonly FROM = Math.PI * 0.62; // 畳んで画面外に隠した角度
  private readonly TO = -Math.PI * 0.16; // 蹴り切った角度（やや上向き）

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();

    // 付け根は画面の手前・下。ここを軸に脚を前へ振り出す。
    this.pivot.position.set(-0.12, -0.62, -0.18);
    this.group.add(this.pivot);

    const legMat = new THREE.MeshStandardMaterial({
      color: 0x20242b,
      roughness: 0.6,
      metalness: 0.2,
    });
    const kneeMat = new THREE.MeshStandardMaterial({
      color: 0x2b2f37,
      roughness: 0.55,
      metalness: 0.25,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x101216,
      roughness: 0.45,
      metalness: 0.35,
    });
    this.mats.push(legMat, kneeMat, bootMat);

    // すね（太め・長めにして存在感を出す）
    const shinG = new THREE.BoxGeometry(0.2, 0.62, 0.2);
    this.geos.push(shinG);
    const shin = new THREE.Mesh(shinG, legMat);
    shin.position.set(0, -0.31, 0); // ピボットから下へ伸ばす
    this.pivot.add(shin);

    // 膝あて
    const kneeG = new THREE.BoxGeometry(0.22, 0.16, 0.22);
    this.geos.push(kneeG);
    const knee = new THREE.Mesh(kneeG, kneeMat);
    knee.position.set(0, -0.05, 0.02);
    this.pivot.add(knee);

    // ブーツ（前方へ突き出す）
    const bootG = new THREE.BoxGeometry(0.24, 0.18, 0.4);
    this.geos.push(bootG);
    const boot = new THREE.Mesh(bootG, bootMat);
    boot.position.set(0, -0.62, 0.12);
    this.pivot.add(boot);

    // つま先
    const toeG = new THREE.BoxGeometry(0.22, 0.12, 0.12);
    this.geos.push(toeG);
    const toe = new THREE.Mesh(toeG, bootMat);
    toe.position.set(0, -0.66, 0.32);
    this.pivot.add(toe);

    // 蹴りの軌跡（半透明の帯）。最初は透明にしておく。
    const trailG = new THREE.PlaneGeometry(0.55, 1.0);
    this.geos.push(trailG);
    this.trailMat = new THREE.MeshBasicMaterial({
      color: 0xfff0bf,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mats.push(this.trailMat);
    this.trail = new THREE.Mesh(trailG, this.trailMat);
    this.trail.position.set(0.05, -0.42, -0.55);
    this.group.add(this.trail);

    // 初期は脚を畳んで画面外に隠す
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
      this.trailMat.opacity = 0;
      return;
    }

    // 振り出し（前半）は素早く勢いよく、戻り（後半）はやや遅く。
    const kickOut = 0.38; // 振り出しが終わる進行度
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
    this.pivot.position.z = -0.18 - swing * 0.14;

    // 軌跡は振りのピーク付近で濃く出す
    this.trailMat.opacity = Math.sin(Math.min(1, swing) * Math.PI) * 0.55;
    this.trail.rotation.x = -0.6 + swing * 0.7;
    this.trail.position.z = -0.55 - swing * 0.12;
  }

  dispose(): void {
    this.group.visible = false;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
