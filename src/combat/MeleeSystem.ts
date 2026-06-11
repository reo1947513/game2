import * as THREE from "three";
import { InputState } from "../types";
import { PlayerController } from "../PlayerController";
import { WeaponSystem } from "../WeaponSystem";
import { HUD } from "../HUD";
import { SoundSystem } from "../SoundSystem";
import { KnifeViewmodel } from "./KnifeViewmodel";
import { KickViewmodel } from "./KickViewmodel";
import { SlashTrail } from "./SlashTrail";
import { MeleeTargetProvider } from "./MeleeTarget";

type MeleeType = "knife" | "kick";

// 近接戦闘（横薙ぎナイフ・前蹴り）の発動・索敵・ランジ・命中判定・演出を一括で司る中枢です。
// ゲームループから handleInput→（プレイヤー更新）→update の順で駆動されます。
// 対象は MeleeTargetProvider 経由で受け取るため、敵のいないモードでもモーションと音だけ出ます。
export class MeleeSystem {
  // ----- 確定値（検証済みデモ v5）-----
  private readonly KNIFE_TIME = 0.5;
  private readonly KICK_TIME = 0.58;
  private readonly KNIFE_RANGE = 2.5;
  private readonly KICK_RANGE = 2.7;
  private readonly KNIFE_LUNGE_RANGE = 4.6;
  private readonly KICK_LUNGE_RANGE = 3.8;
  private readonly KNIFE_LUNGE_SPEED = 13;
  private readonly KICK_LUNGE_SPEED = 9;
  private readonly KNIFE_DAMAGE = 100;
  private readonly KICK_DAMAGE = 45;
  private readonly KICK_KNOCKBACK = 11;
  private readonly KNIFE_HIT_AT = 0.32;
  private readonly KICK_HIT_AT = 0.42;
  private readonly KNIFE_SHAKE = 0.018;
  private readonly KICK_SHAKE = 0.03;

  // ----- 状態 -----
  private meleeTimer = 0; // 残り時間（秒）。0より大きい間は発動中。
  private meleeType: MeleeType | null = null;
  private meleeHitDone = false; // 命中判定を済ませたか（1回だけ）
  private lungeVx = 0;
  private lungeVz = 0;
  private lungeTimer = 0; // 自動踏み込みの残り時間（秒）
  private shakeAmt = 0; // 画面シェイクの強さ
  private kickLean = 0; // キックの体重移動（カメラリーン）量。適用は applyCameraShake。

  // 現在のモードが公開する近接対象。敵のいないモードでは null。
  private provider: MeleeTargetProvider | null = null;

  // 作業用ベクトル（毎フレームの生成を避ける）
  private readonly fwd = new THREE.Vector3();
  private readonly eyeTmp = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly tipTmp = new THREE.Vector3();

  constructor(
    private camera: THREE.PerspectiveCamera,
    private player: PlayerController,
    private weapons: WeaponSystem,
    private hud: HUD,
    private sound: SoundSystem,
    private knifeVm: KnifeViewmodel,
    private kickVm: KickViewmodel,
    private trail: SlashTrail
  ) {}

  // 現在モードの近接対象提供者を毎フレーム差し込む（無ければ null）。
  setProvider(provider: MeleeTargetProvider | null): void {
    this.provider = provider;
  }

  // 外部（グレネード爆風など）から画面シェイクを足す。現在値より大きいときだけ更新する。
  addShake(amt: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amt);
  }

  // ランジ中か（プレイヤーの速度上書き・FOV加算の判定に使う）。
  lungeActive(): boolean {
    return this.lungeTimer > 0;
  }
  lungeVelX(): number {
    return this.lungeVx;
  }
  lungeVelZ(): number {
    return this.lungeVz;
  }

  // 入力処理。プレイヤー更新の前に呼び、発動とランジ速度を確定させる。
  handleInput(input: InputState, now: number, dt: number): void {
    void now;
    // 前フレーム分のランジ時間をここで消化する。プレイヤーが setLungeOverride で
    // 読む前に減算することで、ランジが1フレーム余分に適用されるずれを防ぐ。
    if (this.lungeTimer > 0) {
      this.lungeTimer -= dt;
      if (this.lungeTimer < 0) this.lungeTimer = 0;
    }
    if (this.meleeTimer > 0) return; // 発動中の再発動・射撃は不可
    if (input.knifePressed) {
      this.startMelee("knife", input);
    } else if (input.kickPressed) {
      this.startMelee("kick", input);
    }
  }

  // 近接の状態を完全に初期化する（ポーズ・モード切替・戦闘中の死亡で呼ぶ）。
  // 進行中のスイング・ランジ・ビューモデル・トレイル・シェイクをすべて畳む。
  cancel(): void {
    if (this.meleeType === "knife") {
      this.knifeVm.end();
    } else if (this.meleeType === "kick") {
      this.kickVm.end();
    }
    this.trail.clear();
    this.meleeType = null;
    this.meleeTimer = 0;
    this.meleeHitDone = false;
    this.lungeTimer = 0;
    this.lungeVx = 0;
    this.lungeVz = 0;
    this.shakeAmt = 0;
    this.kickLean = 0;
    this.weapons.setMeleeActive(false);
  }

  private startMelee(type: MeleeType, input: InputState): void {
    this.meleeType = type;
    this.meleeTimer = type === "knife" ? this.KNIFE_TIME : this.KICK_TIME;
    this.meleeHitDone = false;

    // 視線の前方ベクトル（yaw/pitch から直接）
    const cp = Math.cos(input.pitch);
    const sp = Math.sin(input.pitch);
    this.fwd.set(-cp * Math.sin(input.yaw), sp, -cp * Math.cos(input.yaw));
    const fhLen = Math.hypot(this.fwd.x, this.fwd.z) || 1;
    const fhx = this.fwd.x / fhLen;
    const fhz = this.fwd.z / fhLen;

    this.player.getEyePosition(this.eyeTmp);
    const lungeRange =
      type === "knife" ? this.KNIFE_LUNGE_RANGE : this.KICK_LUNGE_RANGE;
    const lungeSpeed =
      type === "knife" ? this.KNIFE_LUNGE_SPEED : this.KICK_LUNGE_SPEED;

    // 索敵：前方内積が最大かつ LUNGE_RANGE 以内の敵を選ぶ。
    let bestDot = 0.5;
    let bestDx = 0;
    let bestDz = 0;
    let bestHoriz = 0;
    let found = false;
    if (this.provider) {
      for (const t of this.provider.getMeleeTargets()) {
        if (!t.isAlive()) continue;
        const dx = t.position.x - this.eyeTmp.x;
        const dy = t.position.y + 1.0 - this.eyeTmp.y;
        const dz = t.position.z - this.eyeTmp.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.0001) continue;
        // 踏み込みの可否は命中判定と基準を合わせ、水平距離でゲートする。
        const horiz = Math.hypot(dx, dz);
        if (horiz > lungeRange) continue;
        const dot = (dx / dist) * this.fwd.x + (dy / dist) * this.fwd.y + (dz / dist) * this.fwd.z;
        if (dot > bestDot) {
          bestDot = dot;
          bestDx = dx;
          bestDz = dz;
          bestHoriz = horiz;
          found = true;
        }
      }
    }

    if (found && bestHoriz > 1.2) {
      const hx = bestDx / bestHoriz;
      const hz = bestDz / bestHoriz;
      this.lungeVx = hx * lungeSpeed;
      this.lungeVz = hz * lungeSpeed;
      this.lungeTimer = Math.min(0.22, bestHoriz / lungeSpeed);
    } else if (type === "kick") {
      // キックは対象不在でも前方へ軽く踏み込む（4.5 m/s × 0.12秒）。
      this.lungeVx = fhx * 4.5;
      this.lungeVz = fhz * 4.5;
      this.lungeTimer = 0.12;
    } else {
      this.lungeTimer = 0;
    }

    // 発動演出：銃を消し、近接ビューモデルを出し、風切り音を鳴らす。
    this.sound.whoosh();
    if (type === "knife") {
      this.knifeVm.trigger();
      this.trail.resetPrev();
    } else {
      this.kickVm.trigger();
    }
    this.weapons.setMeleeActive(true);
  }

  // 毎フレーム呼ぶ（カメラ確定後）。アニメ進行・命中・トレイル・シェイク・カメラリーンを処理する。
  update(dt: number, now: number): void {
    if (this.meleeType) {
      this.meleeTimer -= dt;
      const dur = this.meleeType === "knife" ? this.KNIFE_TIME : this.KICK_TIME;
      let t = 1 - this.meleeTimer / dur;
      if (t < 0) t = 0;
      if (t > 1) t = 1;

      if (this.meleeType === "knife") {
        this.knifeVm.setT(t);
        // 一閃フェーズ中だけトレイルを刃先に発生させる。
        if (t >= 0.2 && t < 0.5) {
          this.knifeVm.getTipWorld(this.tipTmp);
          this.trail.emit(this.tipTmp, this.camera);
        } else {
          this.trail.resetPrev();
        }
      } else {
        this.kickVm.setT(t);
        this.trail.resetPrev();
      }

      // 命中判定（1回だけ）
      if (!this.meleeHitDone) {
        const thr = this.meleeType === "knife" ? this.KNIFE_HIT_AT : this.KICK_HIT_AT;
        if (t > thr) {
          this.meleeHitDone = true;
          this.applyMeleeHit();
        }
      }

      // キックの体重移動（リーン）量を記録する。カメラへの適用は applyCameraShake。
      this.kickLean = this.meleeType === "kick" ? this.kickVm.getExtend(t) : 0;

      // 終了処理
      if (this.meleeTimer <= 0) {
        this.meleeTimer = 0;
        if (this.meleeType === "knife") {
          this.knifeVm.end();
          this.trail.resetPrev();
        } else {
          this.kickVm.end();
        }
        this.meleeType = null;
        this.kickLean = 0;
        this.weapons.setMeleeActive(false);
      }
    } else {
      this.kickLean = 0;
    }

    // トレイルの寿命を進める（発生していなくても呼ぶ）。
    this.trail.update(dt);

    // 画面シェイクを時間で減衰させる（カメラへの適用は applyCameraShake）。
    if (this.shakeAmt > 0.0001) {
      this.shakeAmt *= Math.max(0, 1 - 10 * dt);
    } else {
      this.shakeAmt = 0;
    }

    // ランジの残り時間は handleInput の冒頭で消化するため、ここでは触れない。
    void now;
  }

  // カメラ確定後・描画直前に Game から呼ぶ。キックのリーンと画面シェイクをカメラへ
  // 加算する。カメラを書き換える最後の処理であることを明確にするため update から分離する。
  applyCameraShake(): void {
    if (this.kickLean !== 0) {
      this.camera.rotation.x += this.kickLean * 0.05;
      this.camera.rotation.z += this.kickLean * -0.025;
    }
    if (this.shakeAmt > 0.0001) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shakeAmt;
      this.camera.rotation.z += (Math.random() - 0.5) * this.shakeAmt;
    }
  }

  // 命中処理。前方内積0.5超かつ RANGE 以内の全生存敵に作用する。
  private applyMeleeHit(): void {
    if (!this.meleeType) return;
    const knife = this.meleeType === "knife";
    const range = knife ? this.KNIFE_RANGE : this.KICK_RANGE;

    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldDirection(this.camDir); // 正規化済み
    const fhLen = Math.hypot(this.camDir.x, this.camDir.z) || 1;
    const fhx = this.camDir.x / fhLen;
    const fhz = this.camDir.z / fhLen;

    let anyHit = false;
    let anyKill = false;

    if (this.provider) {
      for (const target of this.provider.getMeleeTargets()) {
        if (!target.isAlive()) continue;
        const dx = target.position.x - this.camPos.x;
        const dy = target.position.y + 1.0 - this.camPos.y;
        const dz = target.position.z - this.camPos.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < 0.0001) continue;
        const dot = (dx / dist) * this.camDir.x + (dy / dist) * this.camDir.y + (dz / dist) * this.camDir.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz >= range || dot <= 0.5) continue;

        anyHit = true;
        if (knife) {
          if (target.applyDamage(this.KNIFE_DAMAGE)) anyKill = true;
        } else {
          const killed = target.applyDamage(this.KICK_DAMAGE);
          if (killed) {
            anyKill = true;
          } else {
            // 撃破に至らなければ外向きへ吹き飛ばす。
            const hx = horiz > 0.0001 ? dx / horiz : fhx;
            const hz = horiz > 0.0001 ? dz / horiz : fhz;
            target.applyKnockback(hx * this.KICK_KNOCKBACK, hz * this.KICK_KNOCKBACK);
          }
        }
      }
    }

    if (knife) {
      if (anyHit) {
        this.sound.thud(280);
        this.shakeAmt = this.KNIFE_SHAKE;
        this.hud.flashCenter("FINISHER");
        if (anyKill) this.hud.addKillFeed("🔪 KNIFE FINISHER");
      }
    } else {
      if (anyHit) {
        this.sound.impact();
        this.shakeAmt = this.KICK_SHAKE;
        this.hud.flashCenter(anyKill ? "KICK FINISHER" : "KNOCKBACK");
        if (anyKill) this.hud.addKillFeed("🦵 KICK ELIMINATION");
        // 蹴った反動として自分を後退させる。
        this.player.velocity.x -= fhx * 1.5;
        this.player.velocity.z -= fhz * 1.5;
      } else {
        this.sound.thud(160);
      }
    }
  }
}
