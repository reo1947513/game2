import * as THREE from "three";
import { InputState, Stance } from "./types";

// 操作キャラクターの移動・物理・当たり判定をすべて担当するクラスです。
// 物理エンジンは使わず、自作の運動学（キネマティック）方式にしています。
// FPSの「キレ」を細かく調整できるようにするためです。
export class PlayerController {
  // 位置は「足元の中心」。x,zが水平、yが床からの高さ（足の位置）。
  readonly position = new THREE.Vector3(0, 0, 8);
  readonly velocity = new THREE.Vector3(0, 0, 0);

  // 状態
  stance: Stance = Stance.Stand;
  grounded = false;
  private jumpsUsed = 0; // 連続で使ったジャンプ回数（地上で0に戻る）
  private wallContact = false; // この付近で壁に触れているか
  private readonly wallNormal = new THREE.Vector3(); // 触れている壁の向き
  private proneToggled = false; // 伏せのトグル状態
  private prevCrouch = false; // スライド開始判定用に前フレームのしゃがみ入力を保持

  // スライディング
  private sliding = false;
  private slideTimer = 0;
  private slideSpeed = 0;
  private readonly slideDir = new THREE.Vector3();

  // 近接ランジ（自動踏み込み）による水平速度の上書き
  private lungeOverride = false;
  private lungeVx = 0;
  private lungeVz = 0;

  // 見た目の目線高さ（滑らかに上下させる）
  private currentEye = 1.65;

  // 半径（横の太さ）
  private readonly radius = 0.35;

  // ----- 物理定数（Pythonで算出した値をそのまま使用） -----
  private readonly GRAVITY = 28.0;
  private readonly JUMP_VELOCITY = 9.17; // 高さ1.5m相当
  private readonly DOUBLE_JUMP_VELOCITY = 7.85; // 高さ1.1m相当
  private readonly WALL_JUMP_UP = 8.53; // 高さ1.3m相当
  private readonly WALL_JUMP_PUSH = 7.0; // 壁から離れる横方向の勢い

  // 移動速度の上限（コープのダウン中=1.5、死亡=0 など）。nullで無制限。
  private speedCap: number | null = null;

  // 飛行モード（DEV RANGE 用）。既定 false で通常挙動。
  // true の間は重力・当たり判定を無視し、視線方向へ自由移動する。
  private flyMode = false;
  private readonly FLY_SPEED = 9.0;
  private readonly FLY_SPRINT = 22.0;

  // ----- 速度定数（m/s） -----
  private readonly SPEED_WALK = 5.0;
  private readonly SPEED_SPRINT = 8.5;
  private readonly SPEED_CROUCH = 2.8;
  private readonly SPEED_PRONE = 1.2;
  private readonly SLIDE_SPEED = 11.0;
  private readonly SLIDE_DURATION = 0.8;

  // ----- 姿勢ごとの高さと目線 -----
  private readonly STAND_H = 1.8;
  private readonly CROUCH_H = 1.0;
  private readonly PRONE_H = 0.5;
  private readonly SLIDE_H = 0.7;
  private readonly EYE_STAND = 1.65;
  private readonly EYE_CROUCH = 0.85;
  private readonly EYE_PRONE = 0.35;
  private readonly EYE_SLIDE = 0.6;

  constructor(private colliders: THREE.Box3[]) {}

  // 現在の姿勢に応じた体の高さ
  private get height(): number {
    switch (this.stance) {
      case Stance.Crouch:
        return this.CROUCH_H;
      case Stance.Prone:
        return this.PRONE_H;
      case Stance.Slide:
        return this.SLIDE_H;
      default:
        return this.STAND_H;
    }
  }

  // 現在の姿勢に応じた目線の高さ
  private get targetEye(): number {
    switch (this.stance) {
      case Stance.Crouch:
        return this.EYE_CROUCH;
      case Stance.Prone:
        return this.EYE_PRONE;
      case Stance.Slide:
        return this.EYE_SLIDE;
      default:
        return this.EYE_STAND;
    }
  }

  // 水平方向の速さ（HUD表示用）
  get horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  // 体の当たり判定半径（敵との押し出しに使う）
  get bodyRadius(): number {
    return this.radius;
  }

  // 敵（円柱）の外へプレイヤーを押し出す。敵を壁のように固くするための処理。
  // cx,cz は敵の中心、minDist は両者の半径の和。
  pushOutOfBody(cx: number, cz: number, minDist: number): void {
    const dx = this.position.x - cx;
    const dz = this.position.z - cz;
    const d = Math.hypot(dx, dz);
    if (d >= minDist) return;
    if (d < 0.0001) {
      // ほぼ真上に重なったときは適当な向きへ逃がす
      this.position.x += minDist;
      return;
    }
    const push = minDist - d;
    this.position.x += (dx / d) * push;
    this.position.z += (dz / d) * push;
  }

  // 指定位置へ戻し、速度を0にする（リスポーン用）。既定は初期スポーン地点。
  respawn(x = 0, y = 0, z = 8): void {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
  }

  // 近接の踏み込み中、外部から水平速度を上書きする。active=false で通常移動へ戻す。
  setLungeOverride(active: boolean, vx: number, vz: number): void {
    this.lungeOverride = active;
    this.lungeVx = vx;
    this.lungeVz = vz;
  }

  // 爆風による吹き飛ばし。速度に直接加算し、接地とスライドを解除する。
  // これによりグレネードジャンプ（足元起爆＋ジャンプで高く飛ぶ）が成立する。
  applyExplosionImpulse(vx: number, vy: number, vz: number): void {
    this.velocity.x += vx;
    this.velocity.y += vy;
    this.velocity.z += vz;
    this.grounded = false;
    this.endSlide();
  }

  // カメラに渡す目線のワールド座標
  getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(
      this.position.x,
      this.position.y + this.currentEye,
      this.position.z
    );
  }

  // 指定の高さで現在位置のAABB（軸に沿った直方体）を作る
  private makeAABB(h: number): THREE.Box3 {
    return new THREE.Box3(
      new THREE.Vector3(
        this.position.x - this.radius,
        this.position.y,
        this.position.z - this.radius
      ),
      new THREE.Vector3(
        this.position.x + this.radius,
        this.position.y + h,
        this.position.z + this.radius
      )
    );
  }

  // 立ち上がれるか（頭上に障害物がないか）を確認する
  private canStand(): boolean {
    const box = new THREE.Box3(
      new THREE.Vector3(
        this.position.x - this.radius,
        this.position.y,
        this.position.z - this.radius
      ),
      new THREE.Vector3(
        this.position.x + this.radius,
        this.position.y + this.STAND_H,
        this.position.z + this.radius
      )
    );
    for (const c of this.colliders) {
      // 床そのもの（足元のすぐ下）は無視するため、上面が足より上の箱だけ見る
      if (c.max.y <= this.position.y + 0.05) continue;
      if (box.intersectsBox(c)) return false;
    }
    return true;
  }

  // メイン更新。dt=前フレームからの経過秒、input=入力
  update(dt: number, input: InputState): void {
    // 飛行モード（DEV RANGE 用）：重力・当たり判定・姿勢処理をすべて飛ばす。
    // 既定 false のため通常プレイでは一切通らない。
    if (this.flyMode) {
      this.updateFly(dt, input);
      return;
    }
    this.decideStance(input, dt);
    this.applyHorizontal(dt, input);
    this.applyVerticalAndJump(input, dt);
    this.integrate(dt);
    // 目線の高さを滑らかに追従させる
    this.currentEye += (this.targetEye - this.currentEye) * Math.min(1, dt * 12);
    this.prevCrouch = input.crouch;
  }

  // 飛行モードの切替（DEV RANGE 用）。ON時は落下速度を打ち消す。
  setFlyMode(on: boolean): void {
    this.flyMode = on;
    if (on) this.velocity.set(0, 0, 0);
  }

  // 飛行モードの移動。視線方向（pitch込み）へ自由に飛び、しゃがみで真下へ降りる。
  // 重力・当たり判定は無視する（ステージ全体の確認用）。
  private updateFly(dt: number, input: InputState): void {
    this.stance = Stance.Stand;
    this.grounded = false;
    const speed = input.sprint ? this.FLY_SPRINT : this.FLY_SPEED;
    const yaw = input.yaw;
    const pitch = input.pitch;
    const cp = Math.cos(pitch);
    // 前方ベクトルは pitch を含める（見上げて前進すると上昇する）
    const fwd = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    const rgt = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3();
    move.addScaledVector(fwd, input.forward);
    move.addScaledVector(rgt, input.right);
    if (input.crouch) move.y -= 1; // しゃがみで真下へ
    if (move.lengthSq() > 0) move.normalize();
    this.velocity.set(move.x * speed, move.y * speed, move.z * speed);
    this.position.addScaledVector(this.velocity, dt);
    this.currentEye += (this.EYE_STAND - this.currentEye) * Math.min(1, dt * 12);
    this.prevCrouch = input.crouch;
  }

  // 姿勢を決める（優先度：スライド > 伏せ > しゃがみ > 立ち）
  private decideStance(input: InputState, dt: number): void {
    // 伏せトグル（地上のみ受け付け）
    if (input.pronePressed && this.grounded) {
      this.proneToggled = !this.proneToggled;
      // 伏せに入るときはスライドを解除
      if (this.proneToggled) this.endSlide();
    }

    // スライド開始判定：
    // ダッシュ中・地上・十分な速さで、しゃがみを「押した瞬間」に入る
    const crouchPressedNow = input.crouch && !this.prevCrouch;

    // 伏せ中にジャンプ、またはしゃがみを押したら伏せを解除する
    if (this.proneToggled && (input.jumpPressed || crouchPressedNow)) {
      this.proneToggled = false;
    }

    if (
      crouchPressedNow &&
      this.grounded &&
      input.sprint &&
      !this.sliding &&
      !this.proneToggled &&
      this.horizontalSpeed > this.SPEED_WALK * 0.8
    ) {
      this.startSlide();
    }

    // スライド中の管理
    if (this.sliding) {
      this.slideTimer -= dt;
      if (
        this.slideTimer <= 0 ||
        !this.grounded ||
        this.slideSpeed < this.SPEED_CROUCH
      ) {
        this.endSlide();
      } else {
        this.stance = Stance.Slide;
        return;
      }
    }

    // スライドでない場合の姿勢
    if (this.proneToggled) {
      this.stance = Stance.Prone;
    } else if (input.crouch) {
      this.stance = Stance.Crouch;
    } else {
      // 立ち上がろうとして頭がつかえる場合はしゃがみ維持
      if (this.canStand()) {
        this.stance = Stance.Stand;
      } else {
        this.stance = Stance.Crouch;
      }
    }
  }

  private startSlide(): void {
    this.sliding = true;
    this.slideTimer = this.SLIDE_DURATION;
    this.slideSpeed = this.SLIDE_SPEED;
    // 今向いている水平方向を滑る向きにする
    const len = this.horizontalSpeed;
    if (len > 0.01) {
      this.slideDir.set(this.velocity.x, 0, this.velocity.z).normalize();
    } else {
      this.slideDir.set(0, 0, -1);
    }
    this.stance = Stance.Slide;
  }

  private endSlide(): void {
    this.sliding = false;
    this.slideTimer = 0;
    this.slideSpeed = 0;
  }

  // 水平移動の計算
  private applyHorizontal(dt: number, input: InputState): void {
    // 近接ランジ中は移動入力を無視し、踏み込み速度で水平速度を上書きする。
    if (this.lungeOverride) {
      this.velocity.x = this.lungeVx;
      this.velocity.z = this.lungeVz;
      return;
    }
    if (this.sliding) {
      // スライド中は滑る向きに進み、徐々に減速。わずかに方向修正できる。
      this.slideSpeed -= (this.SLIDE_SPEED / this.SLIDE_DURATION) * dt;
      if (this.slideSpeed < 0) this.slideSpeed = 0;

      // 入力でほんの少しだけ向きを変えられる
      const steer = this.moveDirFromInput(input);
      if (steer.lengthSq() > 0) {
        this.slideDir.lerp(steer, 0.04).normalize();
      }
      this.velocity.x = this.slideDir.x * this.slideSpeed;
      this.velocity.z = this.slideDir.z * this.slideSpeed;
      return;
    }

    // 速度の決定
    let speed = this.SPEED_WALK;
    const moving = input.forward !== 0 || input.right !== 0;
    if (this.stance === Stance.Crouch) {
      speed = this.SPEED_CROUCH;
    } else if (this.stance === Stance.Prone) {
      speed = this.SPEED_PRONE;
    } else if (input.sprint && moving) {
      speed = this.SPEED_SPRINT;
    }
    // 覗き込み中は少し遅くする
    if (input.aiming && this.stance !== Stance.Slide) {
      speed *= 0.6;
    }
    // 速度上限（コープのダウン中など）
    if (this.speedCap !== null) speed = Math.min(speed, this.speedCap);

    const dir = this.moveDirFromInput(input);
    const desiredX = dir.x * speed;
    const desiredZ = dir.z * speed;

    // 地上は即応、空中は慣性を残す（操作の手応えと爽快感の両立）。
    // フレームレートに左右されないよう、経過時間から係数を求める。
    const rate = this.grounded ? 20 : 1.5;
    const factor = 1 - Math.exp(-rate * dt);
    this.velocity.x += (desiredX - this.velocity.x) * factor;
    this.velocity.z += (desiredZ - this.velocity.z) * factor;
  }

  // 移動速度の上限を設定する（コープのダウン中=1.5など）。nullで解除。
  setSpeedCap(v: number | null): void {
    this.speedCap = v;
  }

  // 入力と視点から、進みたいワールド方向（水平）を求める
  private moveDirFromInput(input: InputState): THREE.Vector3 {
    const yaw = input.yaw;
    // 前方向と右方向（yawだけで決まる水平ベクトル）
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const rgt = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dir = new THREE.Vector3();
    dir.addScaledVector(fwd, input.forward);
    dir.addScaledVector(rgt, input.right);
    if (dir.lengthSq() > 0) dir.normalize();
    return dir;
  }

  // 重力・ジャンプ・壁ジャンプ・2段ジャンプの処理
  private applyVerticalAndJump(input: InputState, dt: number): void {
    if (input.jumpPressed) {
      if (this.grounded) {
        // 通常ジャンプ
        this.velocity.y = this.JUMP_VELOCITY;
        this.jumpsUsed = 1;
        this.grounded = false;
        this.endSlide();
      } else if (this.wallContact) {
        // 壁ジャンプ：上に飛びつつ壁から離れる
        this.velocity.y = this.WALL_JUMP_UP;
        this.velocity.x += this.wallNormal.x * this.WALL_JUMP_PUSH;
        this.velocity.z += this.wallNormal.z * this.WALL_JUMP_PUSH;
        this.jumpsUsed = 1; // 壁ジャンプ後も2段ジャンプを1回残す
        this.wallContact = false;
      } else if (this.jumpsUsed < 2) {
        // 2段ジャンプ
        this.velocity.y = this.DOUBLE_JUMP_VELOCITY;
        this.jumpsUsed += 1;
      }
    }
    // 重力（地上にいない間ずっと下向きに加速）
    this.velocity.y -= this.GRAVITY * dt;
  }

  // 速度に従って位置を動かし、各軸ごとに当たり判定で押し戻す
  private integrate(dt: number): void {
    // 壁接触は毎フレームリセットしてから再判定
    this.wallContact = false;

    // --- X軸 ---
    this.position.x += this.velocity.x * dt;
    this.resolveHorizontal("x");

    // --- Z軸 ---
    this.position.z += this.velocity.z * dt;
    this.resolveHorizontal("z");

    // --- Y軸 ---
    const wasGrounded = this.grounded;
    this.grounded = false;
    this.position.y += this.velocity.y * dt;
    this.resolveVertical();

    // 着地した瞬間の処理
    if (this.grounded) {
      this.jumpsUsed = 0;
      this.wallNormal.set(0, 0, 0);
    } else if (wasGrounded) {
      // 段差から落ちた直後など。特に処理は不要。
    }
  }

  // 水平方向（x または z）の押し戻し
  private resolveHorizontal(axis: "x" | "z"): void {
    const h = this.height;
    for (const c of this.colliders) {
      const box = this.makeAABB(h);
      if (!box.intersectsBox(c)) continue;
      // 床のように上面が足元より下の箱は水平押し戻しの対象外
      if (c.max.y <= this.position.y + 0.02) continue;

      const playerCenter = this.position[axis];
      const boxCenter = (c.min[axis] + c.max[axis]) / 2;
      if (playerCenter < boxCenter) {
        // プレイヤーは箱の手前側 → 箱の手前面の外へ押し出す
        this.position[axis] = c.min[axis] - this.radius - 0.001;
        this.setWallNormal(axis, -1);
      } else {
        this.position[axis] = c.max[axis] + this.radius + 0.001;
        this.setWallNormal(axis, 1);
      }
      this.velocity[axis] = 0;
      // 空中で横の壁に触れたら壁ジャンプ可能フラグを立てる
      if (!this.grounded) this.wallContact = true;
    }
  }

  private setWallNormal(axis: "x" | "z", sign: number): void {
    this.wallNormal.set(0, 0, 0);
    this.wallNormal[axis] = sign;
  }

  // 縦方向の押し戻し（床に乗る／天井にぶつかる）
  private resolveVertical(): void {
    const h = this.height;
    for (const c of this.colliders) {
      const box = this.makeAABB(h);
      if (!box.intersectsBox(c)) continue;

      if (this.velocity.y <= 0) {
        // 落下中：箱の上面に乗せる
        // 足元が箱の上面付近にあるときだけ「床」として扱う
        if (this.position.y < c.max.y) {
          this.position.y = c.max.y;
          this.velocity.y = 0;
          this.grounded = true;
        }
      } else {
        // 上昇中：箱の下面で頭を止める
        this.position.y = c.min.y - h - 0.001;
        this.velocity.y = 0;
      }
    }
  }
}
