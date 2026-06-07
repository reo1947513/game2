import * as THREE from "three";

// 一人称の蹴りモーション。画面の下から脚（すね・膝・ブーツ）の足裏を
// 前方へ押し出す踏み込み。振り上げず、前へ踏み込んで止めてから戻す。
export class KickView {
  private group: THREE.Group; // 脚全体（カメラの子）
  private pivot: THREE.Group; // 付け根。ここを軸に脚を振る

  private active = false;
  private t = 0; // アニメ進行（0〜1）
  private readonly DUR = 0.32; // 蹴り1回の所要時間（秒）
  private readonly PUSH_OUT = 0.35; // 押し出しが終わる進行度（鋭く出す）
  private readonly ROT_REST = 1.3; // 構え：足裏をすでに前へ向けておく
  private readonly ROT_PUSH = 1.55; // 押し出し：足裏を前方へ向けたまま（回転は控えめ）
  // 付け根の位置（構え→押し出し）。高さはほぼ変えず、奥行きだけ前(z-)へ水平に突き出す。
  private readonly POS_REST = new THREE.Vector3(0.2, -0.6, -0.15);
  private readonly POS_PUSH = new THREE.Vector3(0.2, -0.52, -0.95);

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(camera: THREE.PerspectiveCamera) {
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();

    // 付け根は画面のやや右・下・手前。ここから前方へ押し出す。
    this.pivot.position.copy(this.POS_REST);
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

    // 初期は構えの姿勢で隠す
    this.pivot.rotation.x = this.ROT_REST;
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

    // 押し出し（前半）は素早く鋭く、戻り（後半）はやや遅く。
    const kickOut = this.PUSH_OUT; // 押し出しが終わる進行度
    let swing: number; // 0=構え（下・手前）, 1=押し出し（前方）
    if (this.t < kickOut) {
      const u = this.t / kickOut;
      swing = 1 - (1 - u) * (1 - u); // easeOut：勢いよく前へ
    } else {
      const u = (this.t - kickOut) / (1 - kickOut);
      swing = 1 - u * u; // easeIn：構えへ戻る
    }

    // 振り上げではなく、足裏を前方へ押し出す踏み込み。
    this.pivot.rotation.x =
      this.ROT_REST + (this.ROT_PUSH - this.ROT_REST) * swing;
    this.pivot.position.set(
      this.POS_REST.x + (this.POS_PUSH.x - this.POS_REST.x) * swing,
      this.POS_REST.y + (this.POS_PUSH.y - this.POS_REST.y) * swing,
      this.POS_REST.z + (this.POS_PUSH.z - this.POS_REST.z) * swing
    );
  }

  dispose(): void {
    this.group.visible = false;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
