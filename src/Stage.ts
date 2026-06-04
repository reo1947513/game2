import * as THREE from "three";

// 撃てる的（ターゲット）1体分の情報
export interface Target {
  mesh: THREE.Mesh;
  box: THREE.Box3;
  alive: boolean;
  respawnAt: number; // 復活する時刻（秒）。aliveがfalseのとき有効
  baseColor: THREE.Color;
  userHits?: number; // 累積ダメージ（アサルトなど複数発で倒す武器用）
}

// ステージの中身（見た目のメッシュ群と、当たり判定用の箱の一覧）
export class Stage {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  readonly targets: Target[] = [];

  constructor(scene: THREE.Scene) {
    this.buildLights(scene);
    this.buildEnvironment(scene);
    this.buildGround();
    this.buildBoundary();
    this.buildObstacles();
    this.buildWallJumpWalls();
    this.buildTargets();
    scene.add(this.group);
  }

  // ----- ライティング -----
  private buildLights(scene: THREE.Scene): void {
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

  private buildEnvironment(scene: THREE.Scene): void {
    // 暗すぎないよう背景をやや持ち上げ、霧も遠くからに緩めてステージを見やすくする
    scene.background = new THREE.Color(0x161a22);
    scene.fog = new THREE.Fog(0x161a22, 70, 220);
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

  // ----- 地面 -----
  private buildGround(): void {
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
  private buildBoundary(): void {
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
  private buildObstacles(): void {
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
  private buildWallJumpWalls(): void {
    // 向かい合う2枚の壁。間を壁ジャンプで上へ登れる
    this.addBox(1, 7, 6, 22, 3.5, -10, 0x4a3a2a);
    this.addBox(1, 7, 6, 26, 3.5, -10, 0x4a3a2a);
    // 単独の高い壁（横移動の壁ジャンプ練習）
    this.addBox(1, 8, 10, -24, 4, 18, 0x4a3a2a);
  }

  // ----- 撃てる的 -----
  private buildTargets(): void {
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

  // 的の復活処理（毎フレーム呼ぶ）
  updateTargets(now: number): void {
    for (const t of this.targets) {
      if (!t.alive && now >= t.respawnAt) {
        t.alive = true;
        t.mesh.visible = true;
        (t.mesh.material as THREE.MeshStandardMaterial).color.copy(t.baseColor);
        (t.mesh.material as THREE.MeshStandardMaterial).emissive.set(0x551a10);
      }
    }
  }

  // 的に当たった時の処理。2秒後に復活させる。
  onTargetHit(t: Target, now: number): void {
    t.alive = false;
    t.mesh.visible = false;
    t.respawnAt = now + 2.0;
  }
}
