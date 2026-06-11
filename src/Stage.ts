import * as THREE from "three";
import { buildSkyframe } from "./stages/Skyframe";

// 撃てる的（ターゲット）1体分の情報
export interface Target {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  alive: boolean;
  respawnAt: number; // 復活する時刻（秒）。aliveがfalseのとき有効
  baseColor: THREE.Color;
  userHits?: number; // 累積ダメージ（アサルトなど複数発で倒す武器用）
}

// 各ステージのbuild関数へ渡す道具一式。box追加・的追加・毎フレーム更新の登録ができる。
export interface StageContext {
  scene: THREE.Scene;
  group: THREE.Group;
  colliders: THREE.Box3[];
  targets: Target[];
  // 見た目と当たり判定を同時に登録する箱。collidable=false で視覚専用。
  addBox: (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    color: number,
    collidable?: boolean
  ) => THREE.Mesh;
  // 毎フレーム呼ばれる更新関数を登録する（障害灯の明滅・溶接火花など）。
  addUpdater: (fn: (now: number) => void) => void;
}

// 登録されているステージのID
export type StageId = "dusk" | "skyframe";

// ステージの中身（見た目のメッシュ群と、当たり判定用の箱の一覧）。
// ステージ登録制：構築時にIDで選んだステージのbuild関数を実行する。
export class Stage {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  readonly targets: Target[] = [];
  // プレイヤーの開始・復活位置（ステージごとに異なる）
  readonly playerSpawn = new THREE.Vector3(0, 0, 8);

  // 毎フレーム動かす要素（障害灯の明滅・溶接火花など）
  private dynamicUpdaters: Array<(now: number) => void> = [];

  constructor(scene: THREE.Scene, stageId: StageId = "skyframe") {
    if (stageId === "dusk") {
      this.buildDusk(scene);
      this.playerSpawn.set(0, 0, 8);
    } else {
      const ctx: StageContext = {
        scene,
        group: this.group,
        colliders: this.colliders,
        targets: this.targets,
        addBox: (sx, sy, sz, x, y, z, color, collidable = true) =>
          this.addBox(sx, sy, sz, x, y, z, color, collidable),
        addUpdater: (fn) => this.dynamicUpdaters.push(fn),
      };
      const spawn = buildSkyframe(ctx);
      this.playerSpawn.copy(spawn);
    }
    scene.add(this.group);
  }

  // 箱を作って「見た目」と「当たり判定」を同時に登録する補助関数
  private addBox(
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    color: number,
    collidable = true
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // yはこの箱の「中心」のY座標として扱う
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (collidable) {
      const box = new THREE.Box3().setFromObject(mesh);
      this.colliders.push(box);
    }
    return mesh;
  }

  // ===== STAGE 01 — DUSK DISTRICT（既存ステージ。数値・配置とも温存） =====
  private buildDusk(scene: THREE.Scene): void {
    this.buildDuskLights(scene);
    this.buildDuskEnvironment(scene);
    this.buildDuskGround();
    this.buildDuskBoundary();
    this.buildDuskObstacles();
    this.buildDuskWallJumpWalls();
    this.buildDuskTargets();
  }

  // ----- ライティング -----
  private buildDuskLights(scene: THREE.Scene): void {
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff1d0, 2.0);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    const d = 60;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    scene.add(sun);

    // 黒〜濃紺の背景に金色系のフォグで、指定の雰囲気に寄せています
    const fill = new THREE.HemisphereLight(0x6a7a99, 0x1a140a, 0.9);
    scene.add(fill);
  }

  private buildDuskEnvironment(scene: THREE.Scene): void {
    // 暗すぎないよう背景をやや持ち上げ、霧も遠くからに緩めてステージを見やすくする
    scene.background = new THREE.Color(0x161a22);
    scene.fog = new THREE.Fog(0x161a22, 70, 220);
  }

  // ----- 地面 -----
  private buildDuskGround(): void {
    // 見た目用の床
    const floorGeo = new THREE.PlaneGeometry(120, 120, 1, 1);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x14181e,
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.group.add(floor);

    // グリッド（位置把握用）
    const grid = new THREE.GridHelper(120, 60, 0x3a4250, 0x232a33);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    grid.position.y = 0.01;
    this.group.add(grid);

    // 床の当たり判定（上面がy=0になる薄い箱）
    const groundBox = new THREE.Box3(
      new THREE.Vector3(-60, -2, -60),
      new THREE.Vector3(60, 0, 60)
    );
    this.colliders.push(groundBox);
  }

  // ----- 外周の壁 -----
  private buildDuskBoundary(): void {
    const h = 8;
    const t = 1;
    const half = 30;
    const color = 0x222831;
    // 北
    this.addBox(half * 2, h, t, 0, h / 2, -half, color);
    // 南
    this.addBox(half * 2, h, t, 0, h / 2, half, color);
    // 東
    this.addBox(t, h, half * 2, half, h / 2, 0, color);
    // 西
    this.addBox(t, h, half * 2, -half, h / 2, 0, color);
  }

  // ----- 段差・足場（パルクール用） -----
  private buildDuskObstacles(): void {
    // 中央の階段状ブロック（飛び乗り＆2段ジャンプの練習）
    this.addBox(4, 1, 4, 0, 0.5, 0, 0x2c3742);
    this.addBox(4, 2, 4, 6, 1, 0, 0x33414e);
    this.addBox(4, 3, 4, 12, 1.5, 0, 0x3a4a59);
    this.addBox(4, 4, 4, 18, 2, 0, 0x415263);

    // 散らした低い箱（カバー）
    this.addBox(3, 1.2, 3, -10, 0.6, -8, 0x2c3742);
    this.addBox(3, 1.2, 3, -16, 0.6, 6, 0x2c3742);
    this.addBox(2.5, 1.5, 2.5, 9, 0.75, -12, 0x2c3742);

    // 黄色いドラム缶風の円柱（指定写真の雰囲気合わせ。当たり判定はおおまかな箱）
    const drumGeo = new THREE.CylinderGeometry(0.8, 0.8, 1.8, 16);
    const drumMat = new THREE.MeshStandardMaterial({
      color: 0xd9a017,
      roughness: 0.6,
      metalness: 0.3,
    });
    const drum = new THREE.Mesh(drumGeo, drumMat);
    drum.position.set(-6, 0.9, 10);
    drum.castShadow = true;
    drum.receiveShadow = true;
    this.group.add(drum);
    this.colliders.push(new THREE.Box3().setFromObject(drum));

    // 高い足場（スライディングで滑り込む先）
    this.addBox(8, 1, 3, -18, 0.5, -16, 0x394755);
  }

  // ----- 壁ジャンプ用の縦壁 -----
  private buildDuskWallJumpWalls(): void {
    // 向かい合う2枚の壁。間を壁ジャンプで上へ登れる
    this.addBox(1, 7, 6, 22, 3.5, -10, 0x4a3a2a);
    this.addBox(1, 7, 6, 26, 3.5, -10, 0x4a3a2a);
    // 単独の高い壁（横移動の壁ジャンプ練習）
    this.addBox(1, 8, 10, -24, 4, 18, 0x4a3a2a);
  }

  // ----- 撃てる的 -----
  private buildDuskTargets(): void {
    const positions: Array<[number, number, number]> = [
      [0, 1.2, -20],
      [10, 1.2, -22],
      [-12, 1.2, -18],
      [20, 4.5, -2],
      [-20, 1.2, 12],
      [6, 1.2, 18],
    ];
    for (const [x, y, z] of positions) {
      const geo = new THREE.BoxGeometry(1.2, 2.0, 0.6);
      const baseColor = new THREE.Color(0xff5a3c);
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor.clone(),
        emissive: new THREE.Color(0x551a10),
        roughness: 0.5,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.group.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      this.targets.push({
        mesh,
        box,
        alive: true,
        respawnAt: 0,
        baseColor,
      });
    }
  }

  // 的の復活処理＋ステージの動的要素の更新（毎フレーム呼ぶ）
  updateTargets(now: number): void {
    for (const t of this.targets) {
      if (!t.alive && now >= t.respawnAt) {
        t.alive = true;
        t.mesh.visible = true;
        (t.mesh.material as THREE.MeshStandardMaterial).color.copy(t.baseColor);
        (t.mesh.material as THREE.MeshStandardMaterial).emissive.set(0x551a10);
      }
    }
    for (const u of this.dynamicUpdaters) u(now);
  }

  // 的に当たった時の処理。2秒後に復活させる。
  onTargetHit(t: Target, now: number): void {
    t.alive = false;
    t.mesh.visible = false;
    t.respawnAt = now + 2.0;
  }
}
