import { IAvatar } from "./IAvatar";
import { PrimitiveAvatar } from "./PrimitiveAvatar";

// アバター生成の唯一の切替点。将来 .glb を用意したら、ここを GLTFAvatar に変えるだけで全置換できる。
export class AvatarFactory {
  static create(): IAvatar {
    return new PrimitiveAvatar();
    // 将来: return new GLTFAvatar();
  }
}
