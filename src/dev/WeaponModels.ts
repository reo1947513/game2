import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { WeaponKind } from "../types";

// DEV RANGE 用：武器種ごとに取り込んだ実モデルを読み込む（テスト環境での「試着」用）。
// ASSAULT=SciFi AR gltf、SNIPER/SHOTGUN/SMG=FPS銃の obj+mtl（色のみ）。
// すべて src/dev 配下のため本番バンドルには含まれない（vite の exclude-dev-assets で除外）。
// glob は遅延（参照コードがツリーシェイクされても本番にアセットを出さないため必須）。
const GLTF = import.meta.glob("./models/weapons/*.gltf", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const OBJ = import.meta.glob("./models/weapons/*.obj", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const MTL = import.meta.glob("./models/weapons/*.mtl", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

function findLoader(
  map: Record<string, () => Promise<string>>,
  fileName: string
): (() => Promise<string>) | null {
  const key = Object.keys(map).find((p) => p.endsWith("/" + fileName));
  return key ? map[key] : null;
}

// 武器種 → モデルファイル名（ASSAULT は gltf、他は obj）。
function fileFor(kind: WeaponKind): { gltf?: string; obj?: string } {
  switch (kind) {
    case WeaponKind.Assault:
      return { gltf: "scifi_ar_1.gltf" };
    case WeaponKind.Sniper:
      return { obj: "sniper" };
    case WeaponKind.Shotgun:
      return { obj: "shotgun" };
    case WeaponKind.Smg:
      return { obj: "smg" };
    default:
      return {};
  }
}

// 中心を原点に寄せ、全長 targetLen 程度へ収まるよう包みグループにスケールを与える。
function fit(obj: THREE.Object3D, targetLen = 0.7): THREE.Group {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center); // 原点中心へ
  const g = new THREE.Group();
  g.add(obj);
  g.scale.setScalar(targetLen / maxDim);
  return g;
}

// 指定武器種の実モデルを読み込んで返す（読めなければ null）。
export async function loadWeaponModel(kind: WeaponKind): Promise<THREE.Group | null> {
  const f = fileFor(kind);
  try {
    if (f.gltf) {
      const ld = findLoader(GLTF, f.gltf);
      if (!ld) return null;
      const gltf = await new GLTFLoader().loadAsync(await ld());
      return fit(gltf.scene);
    }
    if (f.obj) {
      const ol = findLoader(OBJ, f.obj + ".obj");
      if (!ol) return null;
      const objUrl = await ol();
      const ml = findLoader(MTL, f.obj + ".mtl");
      const loader = new OBJLoader();
      if (ml) {
        const mats = await new MTLLoader().loadAsync(await ml());
        mats.preload();
        loader.setMaterials(mats);
      }
      const obj = await loader.loadAsync(objUrl);
      return fit(obj);
    }
  } catch {
    return null;
  }
  return null;
}
