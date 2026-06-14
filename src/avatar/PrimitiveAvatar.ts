import * as THREE from "three";
import { AvatarAnimParams, AvatarState, IAvatar } from "./IAvatar";
import { AvatarAnimator, AvatarRig } from "./AvatarAnimator";
import { NameLabel } from "./NameLabel";

// プリミティブ（箱・球）で組んだ人型アバター。ボーン階層を Group のネストで表現し、
// AvatarAnimator が関節 Group を回してポーズを作る。全高約1.75m。
export class PrimitiveAvatar implements IAvatar {
  readonly object3d: THREE.Group;

  private rig: AvatarRig;
  private label: NameLabel;
  private time = 0;
  private currentWeapon = "";
  private weaponSlot: THREE.Group; // 右手の武器取付先
  private weaponMesh: THREE.Object3D | null = null;

  // 解放対象
  private geos: THREE.BufferGeometry[] = [];
  private baseMat: THREE.MeshStandardMaterial;
  private suitMat: THREE.MeshStandardMaterial;
  private jointMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private visorMat: THREE.MeshStandardMaterial;
  private weaponMat: THREE.MeshStandardMaterial;

  constructor() {
    this.object3d = new THREE.Group();

    this.baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.7, metalness: 0.1 });
    this.suitMat = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.8, metalness: 0.05 });
    this.jointMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.2 });
    this.accentMat = new THREE.MeshStandardMaterial({ color: 0x36c0ff, roughness: 0.5, metalness: 0.2 });
    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x36c0ff,
      emissive: 0x36c0ff,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.1,
    });
    this.weaponMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.4 });

    // 胴体（pitch で傾く） — 腰 y=0.95 を支点に上半身が前後する
    const body = new THREE.Group();
    body.position.y = 0.95;
    this.object3d.add(body);

    this.addMesh(body, this.box(0.42, 0.58, 0.26), this.baseMat, 0, 0.3, 0); // 胴
    this.addMesh(body, this.box(0.3, 0.26, 0.12), this.accentMat, 0, 0.36, -0.12); // 胸アーマー（前面アクセント）
    this.addMesh(body, this.box(0.46, 0.16, 0.28), this.suitMat, 0, 0.02, 0); // 腰回り

    // 頭
    const head = new THREE.Group();
    head.position.y = 0.72;
    body.add(head);
    this.addMesh(head, this.sphere(0.14), this.baseMat, 0, 0.04, 0); // 頭蓋
    this.addMesh(head, this.box(0.2, 0.07, 0.04), this.visorMat, 0, 0.04, -0.12); // バイザー（アクセント発光）
    this.addMesh(head, this.box(0.26, 0.12, 0.26), this.suitMat, 0, 0.14, 0); // ヘルメット上部

    // 肩→腕（body の子。pitch で一緒に傾く）
    const armL = this.buildArm(-1, body);
    const armR = this.buildArm(1, body);

    // 股→脚（root の子。pitch では傾かない）
    const legL = this.buildLeg(-1, this.object3d);
    const legR = this.buildLeg(1, this.object3d);

    this.weaponSlot = armR.hand;

    this.rig = {
      body,
      head,
      shoulderL: armL.shoulder,
      shoulderR: armR.shoulder,
      elbowL: armL.elbow,
      elbowR: armR.elbow,
      hipL: legL.hip,
      hipR: legR.hip,
      kneeL: legL.knee,
      kneeR: legR.knee,
    };

    // 名前ラベル＋HPバー
    this.label = new NameLabel();
    this.object3d.add(this.label.object3d);

    // 既定の武器
    this.setWeapon("ar");

    this.object3d.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  // --- 形状ヘルパ -------------------------------------------------------------
  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    const g = new THREE.BoxGeometry(w, h, d);
    this.geos.push(g);
    return g;
  }
  private sphere(r: number): THREE.SphereGeometry {
    const g = new THREE.SphereGeometry(r, 12, 10);
    this.geos.push(g);
    return g;
  }
  private addMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // 上端を支点に下へ伸びる骨。end は次の関節の取付先。
  private bone(length: number, w: number, d: number, mat: THREE.Material): { pivot: THREE.Group; end: THREE.Group } {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(this.box(w, length, d), mat);
    mesh.position.y = -length / 2;
    pivot.add(mesh);
    const joint = new THREE.Mesh(this.sphere(w * 0.6), this.jointMat);
    pivot.add(joint);
    const end = new THREE.Group();
    end.position.y = -length;
    pivot.add(end);
    return { pivot, end };
  }

  private buildArm(side: number, body: THREE.Group): { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group } {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 0.5, 0);
    body.add(shoulder);
    // 肩アクセント
    this.addMesh(shoulder, this.sphere(0.09), this.accentMat, 0, 0, 0);
    const upper = this.bone(0.3, 0.11, 0.11, this.suitMat);
    shoulder.add(upper.pivot);
    const lower = this.bone(0.28, 0.09, 0.09, this.baseMat);
    upper.end.add(lower.pivot);
    // 手
    this.addMesh(lower.end, this.box(0.1, 0.1, 0.12), this.jointMat, 0, -0.04, 0.02);
    return { shoulder, elbow: upper.end, hand: lower.end };
  }

  private buildLeg(side: number, root: THREE.Group): { hip: THREE.Group; knee: THREE.Group } {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, 0.92, 0);
    root.add(hip);
    const thigh = this.bone(0.46, 0.16, 0.16, this.suitMat);
    hip.add(thigh.pivot);
    // 膝アクセント
    this.addMesh(thigh.end, this.sphere(0.08), this.accentMat, 0, 0, 0);
    const shin = this.bone(0.44, 0.13, 0.13, this.baseMat);
    thigh.end.add(shin.pivot);
    // 足
    this.addMesh(shin.end, this.box(0.15, 0.08, 0.26), this.jointMat, 0, -0.04, 0.05);
    return { hip, knee: thigh.end };
  }

  // --- 武器（右手） ----------------------------------------------------------
  private setWeapon(type: string): void {
    if (type === this.currentWeapon) return;
    this.currentWeapon = type;
    if (this.weaponMesh) {
      this.weaponSlot.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    if (type === "none") return;
    const w = new THREE.Group();
    if (type === "knife") {
      this.addMesh(w, this.box(0.04, 0.28, 0.02), this.weaponMat, 0, -0.12, 0.06);
      this.addMesh(w, this.box(0.05, 0.06, 0.04), this.jointMat, 0, 0.0, 0.06);
    } else if (type === "sniper") {
      this.addMesh(w, this.box(0.07, 0.07, 0.9), this.weaponMat, 0, -0.04, 0.3);
      this.addMesh(w, this.box(0.04, 0.06, 0.16), this.jointMat, 0, 0.04, 0.18); // スコープ
      this.addMesh(w, this.box(0.05, 0.16, 0.07), this.weaponMat, 0, -0.12, -0.02); // グリップ
    } else {
      // ar / 既定
      this.addMesh(w, this.box(0.07, 0.08, 0.5), this.weaponMat, 0, -0.04, 0.2);
      this.addMesh(w, this.box(0.05, 0.14, 0.06), this.weaponMat, 0, -0.14, 0.04); // マガジン
      this.addMesh(w, this.box(0.04, 0.04, 0.18), this.jointMat, 0, -0.02, 0.42); // バレル
    }
    w.position.set(0, -0.06, 0.04);
    this.weaponSlot.add(w);
    this.weaponMesh = w;
  }

  // --- IAvatar ---------------------------------------------------------------
  update(dt: number, params: AvatarAnimParams): void {
    this.time += dt;
    if (params.weaponType && params.weaponType !== this.currentWeapon) {
      this.setWeapon(params.weaponType);
    }
    AvatarAnimator.apply(this.rig, params, this.time);
  }

  setTeamColor(color: number): void {
    this.accentMat.color.setHex(color);
    this.visorMat.color.setHex(color);
    this.visorMat.emissive.setHex(color);
    this.label.setColor(color);
  }

  setState(state: AvatarState): void {
    this.label.setState(state);
    if (state === "dead") {
      this.object3d.visible = false;
      return;
    }
    this.object3d.visible = true;
    // ダウンは沈ませて屈ませる（簡易表現）
    this.object3d.scale.set(1, state === "down" ? 0.55 : 1, 1);
    this.visorMat.emissiveIntensity = state === "down" ? 0.1 : 0.6;
  }

  setNameLabel(name: string): void {
    this.label.setName(name);
  }

  setHp(frac: number): void {
    this.label.setHp(frac);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.baseMat.dispose();
    this.suitMat.dispose();
    this.jointMat.dispose();
    this.accentMat.dispose();
    this.visorMat.dispose();
    this.weaponMat.dispose();
    this.label.dispose();
  }
}
