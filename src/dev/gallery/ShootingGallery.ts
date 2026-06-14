import * as THREE from "three";
import { StageContext } from "../../Stage";

// DEV RANGE 専用の本格射撃場「SHOOTING GALLERY」。
// 120m(奥行) × 60m(横) × 12m(高さ) の屋内射撃場。床に10m刻みの距離ライン＋数字パネル、
// 3レーン（左=精度/中=追従/右=実戦）の腰高仕切り（視覚用・射線は遮らない=非collidable）。
// プレイヤーは手前端中央 (0,0,55) で -z 方向（奥）を向いて構える。dev 層のため本番に含まれない。
//
// レーンの x 範囲：左 [-28,-10] / 中 [-9,9] / 右 [10,28]
// 距離 d の z 座標 = 55 - d（スポーン z=55 から奥へ）

export const GALLERY = {
  spawnZ: 55,
  halfW: 30,
  laneX: { left: -19, center: 0, right: 19 },
  distances: [10, 20, 30, 50, 75, 100],
  zForDist: (d: number): number => 55 - d,
};

// 距離数字のパネル（CanvasTexture）。
function numberPanel(text: string): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0c0e12";
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#ffce5a";
  g.font = "bold 40px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), mat);
}

export function buildShootingGallery(ctx: StageContext): THREE.Vector3 {
  // 環境
  ctx.scene.background = new THREE.Color(0x0e1117);
  ctx.scene.fog = new THREE.Fog(0x0e1117, 60, 170); // 奥をわずかに沈ませて距離感

  ctx.addLight(new THREE.AmbientLight(0xffffff, 1.0));
  ctx.addLight(new THREE.HemisphereLight(0xaebfd6, 0x20242a, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(8, 30, 50);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  const d = 70;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  ctx.addLight(sun);

  // 床（見た目）＋当たり判定
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 130),
    new THREE.MeshStandardMaterial({ color: 0x1a1e25, roughness: 0.96, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -5);
  floor.receiveShadow = true;
  ctx.group.add(floor);
  ctx.colliders.push(new THREE.Box3(new THREE.Vector3(-30, -2, -70), new THREE.Vector3(30, 0, 60)));

  // 外周の壁（左右・奥・手前）。弾はここに当たる＝外し。
  ctx.addBox(60, 12, 1, 0, 6, -70, 0x262b34); // 奥
  ctx.addBox(60, 12, 1, 0, 6, 60, 0x262b34); // 手前
  ctx.addBox(1, 12, 130, -30, 6, -5, 0x222831); // 左
  ctx.addBox(1, 12, 130, 30, 6, -5, 0x222831); // 右

  // 距離ライン＋数字パネル
  for (const dist of GALLERY.distances) {
    const z = GALLERY.zForDist(dist);
    const line = ctx.addBox(58, 0.05, 0.16, 0, 0.04, z, 0x3ad6a0, false);
    (line.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x1f6a52);
    // 床に寝かせた数字（右側）と、右壁の数字
    const floorNum = numberPanel(`${dist}m`);
    floorNum.rotation.x = -Math.PI / 2;
    floorNum.position.set(24, 0.06, z);
    ctx.group.add(floorNum);
    const wallNum = numberPanel(`${dist}m`);
    wallNum.position.set(29.4, 2.4, z);
    wallNum.rotation.y = -Math.PI / 2;
    ctx.group.add(wallNum);
  }

  // 3レーンの腰高仕切り（視覚用・非collidable＝射線を遮らない）
  for (const x of [-9.5, 9.5]) {
    ctx.addBox(0.2, 1.0, 110, x, 0.5, 0, 0x33414e, false);
  }

  // レーン見出し（手前側の床）
  const labels: Array<{ x: number; t: string; col: number }> = [
    { x: GALLERY.laneX.left, t: "ACCURACY", col: 0x4ad6a0 },
    { x: GALLERY.laneX.center, t: "TRACK", col: 0xffce5a },
    { x: GALLERY.laneX.right, t: "COMBAT", col: 0xff7b5a },
  ];
  for (const l of labels) {
    const post = ctx.addBox(0.3, 1.4, 0.3, l.x, 0.7, 50, l.col, false);
    (post.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(l.col);
    (post.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
  }

  return new THREE.Vector3(0, 0, GALLERY.spawnZ);
}
