import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

// DEV RANGE 用：拡張子からローダーを選んで任意の3Dモデルを読み込む汎用関数。
// gltf/glb=GLTFLoader、fbx=FBXLoader、obj=OBJLoader。すべて dev 層のため本番には含まれない。
export async function loadModel(url: string, ext: string): Promise<THREE.Object3D | null> {
  try {
    const e = ext.toLowerCase();
    if (e === "gltf" || e === "glb") return (await new GLTFLoader().loadAsync(url)).scene;
    if (e === "fbx") return await new FBXLoader().loadAsync(url);
    if (e === "obj") return await new OBJLoader().loadAsync(url);
  } catch {
    return null;
  }
  return null;
}
