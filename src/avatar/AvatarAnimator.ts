import * as THREE from "three";
import { AvatarAnimParams } from "./IAvatar";

// プリミティブ人型の関節（Group）を回転させてポーズを作る（スケルタルアニメは使わない）。
export interface AvatarRig {
  body: THREE.Group; // 胴体（pitch で傾く）
  head: THREE.Group; // 頭（pitch で大きく傾く）
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
}

export class AvatarAnimator {
  // t は累積時間（秒）。
  static apply(rig: AvatarRig, params: AvatarAnimParams, t: number): void {
    const { speed, isGrounded, verticalVel, pitch, isAiming, isCrouching, isProne, melee } = params;

    // 上半身・頭の上下向き（pitch）
    rig.body.rotation.x = pitch * 0.25;
    rig.head.rotation.x = pitch * 0.5;
    // 肩の横ひねりは近接スイング用。毎フレーム既定へ戻して残留を防ぐ。
    rig.shoulderL.rotation.y = 0;
    rig.shoulderR.rotation.y = 0;

    if (isProne) {
      // 伏せ：胴ごと水平に倒すのは PrimitiveAvatar 側（object3d の回転）。ここでは手足を伸ばして
      // 寝そべり＋前方へ構える形にする（脚はまっすぐ、腕は前方）。
      rig.body.rotation.x = 0;
      rig.head.rotation.x = -0.5; // 寝た姿勢から前方を見るため頭を起こす
      rig.hipL.rotation.x = 0.1;
      rig.hipR.rotation.x = 0.1;
      rig.kneeL.rotation.x = 0.05;
      rig.kneeR.rotation.x = 0.05;
      rig.shoulderL.rotation.x = -1.5;
      rig.shoulderR.rotation.x = -1.5;
      rig.elbowL.rotation.x = -0.4;
      rig.elbowR.rotation.x = -0.4;
      return;
    }

    if (!isGrounded) {
      // 空中：上昇は抱え込み、下降は伸ばす
      const tuck = verticalVel > 0 ? 1 : 0;
      rig.hipL.rotation.x = -0.6 * (tuck ? 1 : -0.2);
      rig.hipR.rotation.x = -0.6 * (tuck ? 1 : -0.2);
      rig.kneeL.rotation.x = 0.9 * tuck;
      rig.kneeR.rotation.x = 0.9 * tuck;
      rig.shoulderL.rotation.x = -0.4;
      rig.shoulderR.rotation.x = -0.4;
      rig.elbowL.rotation.x = -0.3;
      rig.elbowR.rotation.x = -0.3;
      return;
    }

    const moving = speed > 0.5;
    if (!moving) {
      const b = Math.sin(t * 2) * 0.03; // 呼吸
      rig.hipL.rotation.x = 0;
      rig.hipR.rotation.x = 0;
      rig.kneeL.rotation.x = 0;
      rig.kneeR.rotation.x = 0;
      rig.shoulderL.rotation.x = -0.08 + b;
      rig.shoulderR.rotation.x = -0.08 - b;
      rig.elbowL.rotation.x = -0.2;
      rig.elbowR.rotation.x = -0.2;
    } else {
      const run = speed >= 7;
      const amp = run ? 0.8 : 0.5;
      const cadence = Math.min(14, Math.max(5, speed * 1.3));
      const ph = t * cadence;
      rig.hipL.rotation.x = Math.sin(ph) * amp;
      rig.hipR.rotation.x = Math.sin(ph + Math.PI) * amp;
      rig.kneeL.rotation.x = Math.max(0, Math.sin(ph + Math.PI / 2)) * amp * 1.2;
      rig.kneeR.rotation.x = Math.max(0, Math.sin(ph + Math.PI / 2 + Math.PI)) * amp * 1.2;
      rig.shoulderL.rotation.x = Math.sin(ph + Math.PI) * amp * 0.8; // 脚と逆位相
      rig.shoulderR.rotation.x = Math.sin(ph) * amp * 0.8;
      rig.elbowL.rotation.x = -0.4;
      rig.elbowR.rotation.x = -0.4;
      if (run) rig.body.rotation.x += 0.2; // 前傾
    }

    if (isCrouching) {
      rig.hipL.rotation.x = -0.9;
      rig.hipR.rotation.x = -0.9;
      rig.kneeL.rotation.x = 1.4;
      rig.kneeR.rotation.x = 1.4;
      rig.body.rotation.x += 0.2;
    }

    if (isAiming) {
      // 両腕を前方へ上げて構える
      rig.shoulderL.rotation.x = -1.4;
      rig.shoulderR.rotation.x = -1.4;
      rig.elbowL.rotation.x = -0.6;
      rig.elbowR.rotation.x = -0.6;
    }

    // 近接スイング（短時間フラグ。代表ポーズで上書きし、棒立ちに見えないようにする）
    if (melee === "knife") {
      rig.shoulderR.rotation.x = -1.2;
      rig.shoulderR.rotation.y = 0.7; // 体の前を横切る振り
      rig.elbowR.rotation.x = -1.0;
      rig.shoulderL.rotation.x = -0.5;
    } else if (melee === "kick") {
      rig.hipR.rotation.x = -1.5; // 右脚を前方へ蹴り上げ
      rig.kneeR.rotation.x = 0.2;
      rig.body.rotation.x -= 0.2; // やや後傾
      rig.shoulderL.rotation.x = -0.5;
      rig.shoulderR.rotation.x = -0.5;
    }
  }
}
