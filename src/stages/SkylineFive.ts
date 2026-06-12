import * as THREE from "three";
import { StageContext } from "../Stage";
import {
  BUILDINGS,
  PROPS,
  buildZiplines,
  PARAPET_HEIGHT,
  PARAPET_THICK,
  type BuildingDef,
  type PropDef,
  type ZiplineState,
} from "../shared/rooftop";

// ===== STAGE — SKYLINE FIVE（ROOFTOP DUEL 専用・夜景の摩天楼）=====
// 5棟の高層ビル屋上だけを舞台にする。幾何（座標・サイズ・ジップライン・コライダー）の正本は
// 共有 rooftop.ts。ここはそれを Three.js の見た目へ起こす。addBox は見た目と当たり判定を同時に
// 登録するため、当たり判定はサーバー権威の SKYLINE_COLLIDERS（同じ数値由来）と一致する。

const C_SKY = 0x04060f; // 深夜の空
const C_WALL = 0x1a2535; // ガラスカーテンウォールの外壁
const C_PARAPET = 0x222d3a; // パラペット
const C_PROP = 0x303a47; // 屋上小物
const C_ROOF_DECK = 0x12161d; // 屋上床
const C_WIRE = 0x888899; // ジップラインのワイヤ
const C_ANCHOR = 0xffcc00; // ジップラインのアンカー（黄）
const WIN_WARM = 0xfff4dc; // 窓明かり（温白色）
const WIN_BLUE = 0x7fd6ff; // 窓明かり（蛍光ブルー）

export function buildSkylineFive(ctx: StageContext): THREE.Vector3 {
  // 環境（夜空＋遠景を霞ませるフォグ）
  ctx.scene.background = new THREE.Color(C_SKY);
  ctx.scene.fog = new THREE.Fog(C_SKY, 80, 280);

  buildLights(ctx);
  buildGround(ctx);

  for (const b of BUILDINGS) buildTower(ctx, b);
  for (const p of PROPS) buildProp(ctx, p);
  for (const z of buildZiplines()) buildZipline(ctx, z);

  buildDistantSkyline(ctx);

  // スポーンは中央棟Cの屋上（足元 y = 屋上面）。実際のモード開始時のリスポーンは
  // サーバー権威（RooftopDuelLogic）が棟をランダム選択する（Phase 3）。
  const c = BUILDINGS.find((x) => x.id === "C")!;
  return new THREE.Vector3(c.cx, c.roofY, c.cz);
}

// ----- ライティング -----
function buildLights(ctx: StageContext): void {
  const hemi = new THREE.HemisphereLight(0x1a2840, 0x0a0a12, 0.3);
  ctx.addLight(hemi);

  const moon = new THREE.DirectionalLight(0x7090cc, 0.25);
  moon.position.set(20, 80, -40);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 300;
  const d = 150;
  moon.shadow.camera.left = -d;
  moon.shadow.camera.right = d;
  moon.shadow.camera.top = d;
  moon.shadow.camera.bottom = -d;
  ctx.addLight(moon);
}

// ----- 地上（プレイヤーは行けないが見た目として敷く）-----
function buildGround(ctx: StageContext): void {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x070a12, roughness: 0.95, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  ctx.group.add(floor);

  // 道路グリッド（都市感）。フォグで遠方は霞む。
  const grid = new THREE.GridHelper(320, 64, 0x16324a, 0x0b1622);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  grid.position.y = 0.02;
  ctx.group.add(grid);

  // 地面の当たり判定（上面が y=0）。落下時の着地点。
  ctx.colliders.push(
    new THREE.Box3(new THREE.Vector3(-160, -2, -160), new THREE.Vector3(160, 0, 160))
  );
}

// ----- 1棟ぶんのビル本体・窓・パラペット・屋上床・作業灯 -----
function buildTower(ctx: StageContext, b: BuildingDef): void {
  // ビル本体（地上〜屋上面）。addBox で見た目＋当たり判定を同時登録。
  ctx.addBox(b.sizeX, b.roofY, b.sizeZ, b.cx, b.roofY / 2, b.cz, C_WALL, true);

  // 屋上床（視覚のみ。歩行面は本体上面 y=roofY）。
  ctx.addBox(b.sizeX - 0.2, 0.1, b.sizeZ - 0.2, b.cx, b.roofY + 0.05, b.cz, C_ROOF_DECK, false);

  // 窓（4面の格子。点灯率70%、温白色／蛍光ブルー混在。インスタンシングで軽量）。
  buildWindows(ctx, b);

  // 屋上を照らす作業灯。
  const flood = new THREE.PointLight(0xffb870, 0.9, 25, 1.8);
  flood.position.set(b.cx, b.roofY + 3, b.cz);
  ctx.addLight(flood);

  // パラペット4枚（屋上四周。伏せ遮蔽）。共有の高さ・厚みに合わせる。
  const hx = b.sizeX / 2;
  const hz = b.sizeZ / 2;
  const py = b.roofY + PARAPET_HEIGHT / 2;
  const t = PARAPET_THICK * 2;
  // 北（-Z）／南（+Z）
  ctx.addBox(b.sizeX, PARAPET_HEIGHT, t, b.cx, py, b.cz - hz, C_PARAPET, true);
  ctx.addBox(b.sizeX, PARAPET_HEIGHT, t, b.cx, py, b.cz + hz, C_PARAPET, true);
  // 西（-X）／東（+X）
  ctx.addBox(t, PARAPET_HEIGHT, b.sizeZ, b.cx - hx, py, b.cz, C_PARAPET, true);
  ctx.addBox(t, PARAPET_HEIGHT, b.sizeZ, b.cx + hx, py, b.cz, C_PARAPET, true);
}

// 1棟の4面に窓明かりを InstancedMesh で敷く（視覚のみ）。
function buildWindows(ctx: StageContext, b: BuildingDef): void {
  const winW = 0.7;
  const winH = 1.1;
  const stepX = 2.2; // 水平間隔
  const stepY = 3.0; // 階の間隔
  const yTop = b.roofY - 2;
  const yBottom = 4;
  const hx = b.sizeX / 2;
  const hz = b.sizeZ / 2;

  // 各面の窓位置を集める。face: 0=+Z,1=-Z,2=+X,3=-X
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const tmp = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const qSide = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const scale = new THREE.Vector3(winW, winH, 1);

  const addFace = (axis: "z" | "x", sign: number) => {
    const spanHalf = axis === "z" ? hx : hz;
    const cols2 = Math.max(1, Math.floor((spanHalf * 2 - 1) / stepX));
    const x0 = -((cols2 - 1) * stepX) / 2;
    for (let yi = yBottom; yi <= yTop; yi += stepY) {
      for (let ci = 0; ci < cols2; ci++) {
        if (Math.random() > 0.7) continue; // 点灯率70%（消灯は壁が見える）
        const off = x0 + ci * stepX;
        const pos = new THREE.Vector3();
        if (axis === "z") {
          pos.set(b.cx + off, yi, b.cz + sign * (hz + 0.06));
        } else {
          pos.set(b.cx + sign * (hx + 0.06), yi, b.cz + off);
        }
        const quat = axis === "z" ? q0 : qSide;
        mats.push(tmp.clone().compose(pos, quat, scale));
        cols.push(new THREE.Color(Math.random() < 0.6 ? WIN_WARM : WIN_BLUE));
      }
    }
  };
  addFace("z", 1);
  addFace("z", -1);
  addFace("x", 1);
  addFace("x", -1);

  if (mats.length === 0) return;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(geo, mat, mats.length);
  for (let i = 0; i < mats.length; i++) {
    inst.setMatrixAt(i, mats[i]);
    inst.setColorAt(i, cols[i]);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  ctx.group.add(inst);
}

// ----- 屋上の遮蔽小物（箱／円柱）-----
function buildProp(ctx: StageContext, p: PropDef): void {
  const b = BUILDINGS.find((x) => x.id === p.building)!;
  const cx = b.cx + p.dx;
  const cz = b.cz + p.dz;
  const baseY = b.roofY;

  if (p.kind === "box") {
    ctx.addBox(p.sizeX, p.sizeY, p.sizeZ, cx, baseY + p.sizeY / 2, cz, C_PROP, true);
    return;
  }
  // cylinder：見た目は円柱、当たり判定はAABB近似（共有 buildColliders と同じ扱い）。
  const r = p.sizeX / 2;
  const isAntenna = p.label === "antenna";
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, p.sizeY, isAntenna ? 8 : 16),
    new THREE.MeshStandardMaterial({
      color: isAntenna ? 0x556070 : C_PROP,
      roughness: 0.6,
      metalness: 0.5,
      emissive: new THREE.Color(isAntenna ? 0x101820 : 0x000000),
    })
  );
  mesh.position.set(cx, baseY + p.sizeY / 2, cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  ctx.group.add(mesh);
  ctx.colliders.push(new THREE.Box3().setFromObject(mesh));
}

// ----- ジップライン（ワイヤ＋アンカー＋アンカー灯）-----
function buildZipline(ctx: StageContext, z: ZiplineState): void {
  const from = new THREE.Vector3(z.from.x, z.from.y, z.from.z);
  const to = new THREE.Vector3(z.to.x, z.to.y, z.to.z);
  // 軽いたるみを付けた中間点。
  const mid = from.clone().add(to).multiplyScalar(0.5);
  mid.y -= Math.max(1.2, z.length * 0.04);
  const curve = new THREE.CatmullRomCurve3([from, mid, to]);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 24, 0.04, 6, false),
    new THREE.MeshStandardMaterial({ color: C_WIRE, roughness: 0.4, metalness: 0.8 })
  );
  ctx.group.add(tube);

  // 出発・到着のアンカー（光る短い支柱）。
  for (const a of [from, to]) {
    const anchor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.4, 12),
      new THREE.MeshStandardMaterial({
        color: C_ANCHOR,
        emissive: new THREE.Color(C_ANCHOR),
        emissiveIntensity: 0.8,
        roughness: 0.5,
      })
    );
    anchor.position.set(a.x, a.y - 0.2, a.z);
    ctx.group.add(anchor);
    const pl = new THREE.PointLight(0xffcc00, 0.6, 8, 2.0);
    pl.position.set(a.x, a.y, a.z);
    ctx.addLight(pl);
  }
}

// ----- 遠景の夜景（外周のシルエットビル＋窓明かり。フォグで霞む）-----
function buildDistantSkyline(ctx: StageContext): void {
  const count = 56;
  const winMats: THREE.Matrix4[] = [];
  const tmp = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.05;
    const radius = 220 + Math.random() * 60;
    const x = Math.cos(ang) * radius;
    const zc = Math.sin(ang) * radius;
    const h = 20 + Math.random() * 60;
    const w = 12 + Math.random() * 16;
    const dep = 12 + Math.random() * 16;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, dep),
      new THREE.MeshStandardMaterial({
        color: 0x0a121e,
        emissive: new THREE.Color(0x0a1422),
        emissiveIntensity: 0.4,
        roughness: 0.9,
      })
    );
    tower.position.set(x, h / 2, zc);
    ctx.group.add(tower);

    // 内向きの面に窓明かりを数枚ばらまく。
    const faceSign = -Math.sign(Math.cos(ang)) || 1;
    const rows = Math.floor(h / 5);
    for (let r = 0; r < rows; r++) {
      if (Math.random() > 0.6) continue;
      const wy = 4 + r * 5;
      const wx = x + faceSign * (w / 2 + 0.1);
      const off = (Math.random() * 2 - 1) * (dep / 2 - 1);
      const pos = new THREE.Vector3(wx, wy, zc + off);
      winMats.push(
        tmp.clone().compose(pos, quat, new THREE.Vector3(1.0, 1.6, 1))
      );
    }
  }
  if (winMats.length > 0) {
    const inst = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x9fb8d6, side: THREE.DoubleSide }),
      winMats.length
    );
    for (let i = 0; i < winMats.length; i++) inst.setMatrixAt(i, winMats[i]);
    inst.instanceMatrix.needsUpdate = true;
    ctx.group.add(inst);
  }
}
