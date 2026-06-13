import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

// DEV RANGE 用（テスト環境）：実キャラモデル（kenney サバイバー FBX）を読み込み、
// UV が一致する skin テクスチャ（サバイバー／ゾンビ）を適用して返す。
// すべて src/dev 配下のため本番バンドルには含まれない（vite の exclude-dev-assets で除外）。
const CHAR_FBX = import.meta.glob("./models/characters/*.fbx", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
const CHAR_TEX = import.meta.glob("./textures/characters/*.png", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

function find(
  map: Record<string, () => Promise<string>>,
  suffix: string
): (() => Promise<string>) | null {
  const key = Object.keys(map).find((p) => p.endsWith("/" + suffix));
  return key ? map[key] : null;
}

// サバイバーモデルに合う skin（UV一致）のみを返す。
export function survivorSkins(): Array<{ path: string; name: string }> {
  return Object.keys(CHAR_TEX)
    .filter((p) => {
      const n = p.split("/").pop() ?? "";
      return n.startsWith("サバイバー") || n.includes("ゾンビ");
    })
    .map((p) => ({ path: p, name: (p.split("/").pop() ?? p).replace(/\.png$/i, "") }));
}

// 足元を y=0 に、身長 targetH 程度へ正規化する（FBX は cm 単位で巨大なことが多い）。
function placeOnGround(grp: THREE.Object3D, targetH = 1.8): void {
  let box = new THREE.Box3().setFromObject(grp);
  const size = box.getSize(new THREE.Vector3());
  grp.scale.setScalar(targetH / (size.y || 1));
  box = new THREE.Box3().setFromObject(grp);
  const c = box.getCenter(new THREE.Vector3());
  grp.position.x -= c.x;
  grp.position.z -= c.z;
  grp.position.y -= box.min.y; // 足元を接地
}

// サバイバーモデルを読み込み、指定 skin を適用して返す（読めなければ null）。
export async function loadSurvivor(skinPath?: string): Promise<THREE.Group | null> {
  const ld = find(CHAR_FBX, "survivor.fbx");
  if (!ld) return null;
  try {
    const grp = await new FBXLoader().loadAsync(await ld());
    if (skinPath && CHAR_TEX[skinPath]) {
      const tex = await new THREE.TextureLoader().loadAsync(await CHAR_TEX[skinPath]());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // FBX の UV は flipY=false が一致しやすい
      grp.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.0 });
          m.castShadow = true;
        }
      });
    }
    placeOnGround(grp);
    return grp;
  } catch {
    return null;
  }
}
