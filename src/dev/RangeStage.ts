import * as THREE from "three";
import { StageContext } from "../Stage";

// DEV RANGE 専用の射撃場ステージ。平らな床・距離マーカー・背面/側面の壁・明るい照明・
// 正面に整列した静止ターゲットを構築し、プレイヤーのスポーン地点を返す。
// dev 層のファイルなので本番バンドルには含まれない。Stage.loadCustom() から呼ばれる。
export function buildRange(ctx: StageContext): THREE.Vector3 {
  // 環境（明るめのスタジオ風）
  ctx.scene.background = new THREE.Color(0x10131a);
  ctx.scene.fog = new THREE.Fog(0x10131a, 80, 220);

  ctx.addLight(new THREE.AmbientLight(0xffffff, 1.1));
  const hemi = new THREE.HemisphereLight(0x9fb4d0, 0x202428, 1.0);
  ctx.addLight(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(10, 30, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  const d = 50;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  ctx.addLight(sun);

  // 床（見た目）＋グリッド
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 120),
    new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -40);
  floor.receiveShadow = true;
  ctx.group.add(floor);
  const grid = new THREE.GridHelper(120, 60, 0x3a4250, 0x232a33);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.set(0, 0.01, -40);
  ctx.group.add(grid);

  // 床の当たり判定（上面 y=0）
  ctx.colliders.push(new THREE.Box3(new THREE.Vector3(-40, -2, -100), new THREE.Vector3(40, 0, 20)));

  // 距離マーカー（プレイヤーは +z から -z を向く。10/20/30m に色違いのラインと小ポスト）
  const marks: Array<{ z: number; color: number }> = [
    { z: -10, color: 0x4ad6a0 },
    { z: -20, color: 0xffce5a },
    { z: -30, color: 0xff7b5a },
  ];
  for (const m of marks) {
    const line = ctx.addBox(24, 0.04, 0.18, 0, 0.03, m.z, m.color, false);
    (line.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(m.color);
    (line.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6;
    // 両端の小ポスト
    ctx.addBox(0.3, 1.2, 0.3, -12, 0.6, m.z, m.color, false);
    ctx.addBox(0.3, 1.2, 0.3, 12, 0.6, m.z, m.color, false);
  }

  // 背面・側面の壁（弾の背後止め・見切り）
  ctx.addBox(40, 6, 1, 0, 3, -42, 0x262b34); // 奥
  ctx.addBox(1, 6, 80, -20, 3, -20, 0x262b34); // 左
  ctx.addBox(1, 6, 80, 20, 3, -20, 0x262b34); // 右

  // 正面に整列した静止ターゲット（撃つと2秒後に復活する既存ターゲット挙動）
  const positions: Array<[number, number, number]> = [
    [-8, 1.2, -15],
    [-4, 1.2, -15],
    [0, 1.2, -15],
    [4, 1.2, -15],
    [8, 1.2, -15],
  ];
  for (const [x, y, z] of positions) {
    const baseColor = new THREE.Color(0xff5a3c);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 2.0, 0.6),
      new THREE.MeshStandardMaterial({
        color: baseColor.clone(),
        emissive: new THREE.Color(0x551a10),
        roughness: 0.5,
        metalness: 0.2,
      })
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    ctx.group.add(mesh);
    ctx.targets.push({
      mesh,
      box: new THREE.Box3().setFromObject(mesh),
      alive: true,
      respawnAt: 0,
      baseColor,
    });
  }

  // スポーン地点（南側、-z を向いて構える）
  return new THREE.Vector3(0, 0, 8);
}
