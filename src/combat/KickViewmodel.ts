import * as THREE from "three";

// 1つのキーフレーム（蹴りの各瞬間の姿勢）。
// [時刻, 腰Y, 腰Z, 股関節X, 膝X, 足首X]
type KickKey = [number, number, number, number, number, number];

// 一人称の前蹴り。腰→股関節→膝→足首の3関節リグをカメラの子として持ち、
// 画面下から膝を抱え込んだ脚をせり上げ、伸び切った瞬間に足裏（アクセント色のソール）が
// 正面へ向くよう、キーフレームで駆動します。全円柱の端は関節球で覆い断面を見せません。
export class KickViewmodel {
  private legGroup: THREE.Group; // 腰（カメラの子）
  private hipPivot: THREE.Group; // 股関節
  private kneePivot: THREE.Group; // 膝
  private anklePivot: THREE.Group; // 足首

  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  // 腰のX回転と左右位置は固定（前後・上下とほかの関節だけ動かす）。
  private readonly HIP_ROT_X = 0.16;
  private readonly HIP_POS_X = 0.18;

  // キーフレーム表（検証済みの確定値）。
  private readonly KEYS: KickKey[] = [
    [0.0, -1.15, -0.2, -0.9, -1.4, 0.2], // 画面外：脚は下に畳まれている
    [0.22, -0.55, -0.28, 0.5, -1.9, 0.3], // チャンバー：膝を高く抱え込む
    [0.46, -0.4, -0.55, -0.1, -0.05, 1.25], // 蹴り出し：脚が伸び切り足裏が正対
    [0.6, -0.4, -0.55, -0.1, -0.05, 1.25], // インパクト維持
    [0.82, -0.7, -0.3, 0.3, -1.6, 0.3], // 引き戻し：再び膝を畳む
    [1.0, -1.15, -0.2, -0.9, -1.4, 0.2], // 画面外へ収納
  ];

  constructor(camera: THREE.PerspectiveCamera) {
    const pantsMat = new THREE.MeshStandardMaterial({
      color: 0x2c3240,
      roughness: 0.85,
      metalness: 0.1,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x191510,
      roughness: 0.6,
      metalness: 0.2,
    });
    // アクセント（ARENA STRIKE のオレンジ系ブランドカラーと整合）。
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xff7b1c,
      emissive: 0xff7b1c,
      emissiveIntensity: 0.35,
      roughness: 0.5,
      metalness: 0.2,
    });
    this.mats.push(pantsMat, bootMat, accentMat);

    this.legGroup = new THREE.Group();
    this.hipPivot = new THREE.Group();
    this.kneePivot = new THREE.Group();
    this.anklePivot = new THREE.Group();

    // 腰 → 股関節
    this.legGroup.position.set(this.HIP_POS_X, this.KEYS[0][1], this.KEYS[0][2]);
    this.legGroup.rotation.x = this.HIP_ROT_X;
    this.legGroup.add(this.hipPivot);

    // 股関節の球と太もも
    const hipBallG = new THREE.SphereGeometry(0.1, 16, 12);
    this.geos.push(hipBallG);
    this.hipPivot.add(new THREE.Mesh(hipBallG, pantsMat));

    const thighG = new THREE.CylinderGeometry(0.088, 0.078, 0.42, 16);
    this.geos.push(thighG);
    const thigh = new THREE.Mesh(thighG, pantsMat);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(0, 0, -0.21);
    this.hipPivot.add(thigh);

    // 股関節 → 膝
    this.kneePivot.position.set(0, 0, -0.42);
    this.hipPivot.add(this.kneePivot);

    const kneeBallG = new THREE.SphereGeometry(0.082, 16, 12);
    this.geos.push(kneeBallG);
    this.kneePivot.add(new THREE.Mesh(kneeBallG, pantsMat));

    const shinG = new THREE.CylinderGeometry(0.074, 0.06, 0.4, 16);
    this.geos.push(shinG);
    const shin = new THREE.Mesh(shinG, pantsMat);
    shin.rotation.x = Math.PI / 2;
    shin.position.set(0, 0, -0.2);
    this.kneePivot.add(shin);

    // 膝 → 足首
    this.anklePivot.position.set(0, 0, -0.4);
    this.kneePivot.add(this.anklePivot);

    const ankleBallG = new THREE.SphereGeometry(0.062, 16, 12);
    this.geos.push(ankleBallG);
    this.anklePivot.add(new THREE.Mesh(ankleBallG, bootMat));

    const bootG = new THREE.BoxGeometry(0.12, 0.09, 0.26);
    this.geos.push(bootG);
    const boot = new THREE.Mesh(bootG, bootMat);
    boot.position.set(0, -0.025, -0.1);
    this.anklePivot.add(boot);

    const toeG = new THREE.SphereGeometry(0.065, 16, 12);
    this.geos.push(toeG);
    const toe = new THREE.Mesh(toeG, bootMat);
    toe.scale.set(0.95, 0.7, 1.0);
    toe.position.set(0, -0.03, -0.23);
    this.anklePivot.add(toe);

    const heelG = new THREE.BoxGeometry(0.11, 0.08, 0.07);
    this.geos.push(heelG);
    const heel = new THREE.Mesh(heelG, bootMat);
    heel.position.set(0, -0.03, 0.04);
    this.anklePivot.add(heel);

    // ソール（足裏・アクセント色）
    const soleG = new THREE.BoxGeometry(0.125, 0.03, 0.32);
    this.geos.push(soleG);
    const sole = new THREE.Mesh(soleG, accentMat);
    sole.position.set(0, -0.078, -0.09);
    this.anklePivot.add(sole);

    // ストラップ（甲・アクセント色）
    const strapG = new THREE.BoxGeometry(0.126, 0.022, 0.045);
    this.geos.push(strapG);
    const strap = new THREE.Mesh(strapG, accentMat);
    strap.position.set(0, 0.03, -0.07);
    this.anklePivot.add(strap);

    this.applyKey(this.KEYS[0]);
    this.legGroup.visible = false;
    camera.add(this.legGroup);
  }

  // 6要素のキーをそのまま姿勢へ反映する。
  private applyKey(k: KickKey): void {
    this.legGroup.position.y = k[1];
    this.legGroup.position.z = k[2];
    this.hipPivot.rotation.x = k[3];
    this.kneePivot.rotation.x = k[4];
    this.anklePivot.rotation.x = k[5];
  }

  // 蹴りを開始する（表示して初期姿勢へ）。
  trigger(): void {
    this.legGroup.visible = true;
    this.applyKey(this.KEYS[0]);
  }

  // 蹴りを終える（非表示・初期姿勢へ）。
  end(): void {
    this.legGroup.visible = false;
    this.applyKey(this.KEYS[0]);
  }

  private smooth(k: number): number {
    return k * k * (3 - 2 * k);
  }

  // 正規化時刻 t（0→1）で姿勢を補間する。
  // セグメント1（チャンバー→蹴り出し）だけ二乗加速、それ以外は smoothstep。
  setT(t: number): void {
    const keys = this.KEYS;
    // t を挟む2キーを探す
    let i = 0;
    for (let j = 0; j < keys.length - 1; j++) {
      if (t >= keys[j][0] && t <= keys[j + 1][0]) {
        i = j;
        break;
      }
      if (t > keys[keys.length - 1][0]) i = keys.length - 2;
    }
    const a = keys[i];
    const b = keys[i + 1];
    const span = b[0] - a[0];
    const local = span > 0 ? (t - a[0]) / span : 0;
    const ke = i === 1 ? local * local : this.smooth(local);

    this.legGroup.position.y = THREE.MathUtils.lerp(a[1], b[1], ke);
    this.legGroup.position.z = THREE.MathUtils.lerp(a[2], b[2], ke);
    this.hipPivot.rotation.x = THREE.MathUtils.lerp(a[3], b[3], ke);
    this.kneePivot.rotation.x = THREE.MathUtils.lerp(a[4], b[4], ke);
    this.anklePivot.rotation.x = THREE.MathUtils.lerp(a[5], b[5], ke);
  }

  // カメラの体重移動（リーン）に使う extend 量（0〜1）を返す。
  getExtend(t: number): number {
    if (t < 0.22) return 0;
    if (t < 0.46) {
      const u = (t - 0.22) / 0.24;
      return u * u;
    }
    if (t < 0.6) return 1;
    if (t < 0.82) return 1 - (t - 0.6) / 0.22;
    return 0;
  }

  dispose(): void {
    this.legGroup.visible = false;
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
