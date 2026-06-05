import * as THREE from "three";

// 敵が落とすアイテムの種類。弾薬は予備弾を、回復は体力を補う。
export type PickupKind = "ammo" | "health";

// 地面に落ちて回転・浮遊し、プレイヤーが近づくと拾えるアイテム。
// 見た目は小さな箱で、弾薬は金色、回復は緑色。回復には白い十字の目印を付ける。
export class Pickup {
  group: THREE.Group;
  kind: PickupKind;

  private spin = Math.random() * Math.PI * 2; // 初期回転をばらけさせる
  private baseY = 0.5; // 浮遊の中心の高さ
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  constructor(kind: PickupKind, x: number, z: number) {
    this.kind = kind;
    this.group = new THREE.Group();

    const color = kind === "ammo" ? 0xffcf3a : 0x44dd66;

    // 本体の箱
    const boxG = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    this.geos.push(boxG);
    const boxM = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.45,
      metalness: 0.3,
      roughness: 0.4,
    });
    this.mats.push(boxM);
    const box = new THREE.Mesh(boxG, boxM);
    this.group.add(box);

    if (kind === "health") {
      // 回復は白い十字を貼って、ひと目で分かるようにする
      const crossM = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 0.6,
      });
      this.mats.push(crossM);
      const barV = new THREE.BoxGeometry(0.1, 0.28, 0.02);
      const barH = new THREE.BoxGeometry(0.28, 0.1, 0.02);
      this.geos.push(barV, barH);
      const v = new THREE.Mesh(barV, crossM);
      const h = new THREE.Mesh(barH, crossM);
      v.position.z = 0.22;
      h.position.z = 0.22;
      this.group.add(v, h);
    } else {
      // 弾薬は上面に細い帯を重ねて、弾倉のような印象にする
      const stripeM = new THREE.MeshStandardMaterial({
        color: 0x4a3a10,
        emissive: 0x4a3a10,
        emissiveIntensity: 0.2,
      });
      this.mats.push(stripeM);
      const stripeG = new THREE.BoxGeometry(0.46, 0.1, 0.46);
      this.geos.push(stripeG);
      const stripe = new THREE.Mesh(stripeG, stripeM);
      stripe.position.y = 0.08;
      this.group.add(stripe);
    }

    this.group.position.set(x, this.baseY, z);
  }

  // 毎フレーム、ゆっくり回しながら上下に浮かせて目立たせる
  update(dt: number): void {
    this.spin += dt * 2;
    this.group.rotation.y = this.spin;
    this.group.position.y = this.baseY + Math.sin(this.spin * 1.5) * 0.12;
  }

  // 取得・モード終了時に、シーンから外して資源を解放する
  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
