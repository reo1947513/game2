import * as THREE from "three";
import { Grenade, GrenadeType } from "./Grenade";
import { ExplosionFx } from "./ExplosionFx";
import { FlashbangOverlay } from "./FlashbangOverlay";
import { MeleeTargetProvider } from "./MeleeTarget";
import { PlayerController } from "../PlayerController";
import { WeaponSystem } from "../WeaponSystem";
import { MeleeSystem } from "./MeleeSystem";
import { Health } from "../Health";
import { HUD } from "../HUD";
import { SoundSystem } from "../SoundSystem";
import { InputState } from "../types";

// フラググレネードとフラッシュバンの投擲・弾道・起爆・所持/補充をまとめて司ります。
// 敵への効果は近接と同じ MeleeTargetProvider を再利用し、プレイヤーへの自爆・閃光は
// PlayerController / Health / MeleeSystem(シェイク) / FlashbangOverlay 経由で適用します。
export class GrenadeSystem {
  // ----- 確定値 -----
  private readonly FRAG_MAX = 3;
  private readonly FLASH_MAX = 2;
  private readonly NADE_REGEN_TIME = 6.0;
  private readonly NADE_THROW_CD = 0.5;
  private readonly FRAG_FUSE = 1.8;
  private readonly FLASH_FUSE = 1.4;
  private readonly FRAG_RADIUS = 6.0;
  private readonly FLASH_RADIUS = 18.0;
  private readonly THROW_RIGHT = 0.35; // 投擲スポーンを右へずらす量（m）
  private readonly AIM_DIST = 14.0; // 照準線上のこの距離の点へ向けて投げる（右→正面へ収束）

  // ----- 状態 -----
  private fragAmmo = this.FRAG_MAX;
  private flashAmmo = this.FLASH_MAX;
  private fragRegen = 0; // フラグ補充タイマー（秒）
  private flashRegen = 0; // フラッシュ補充タイマー（秒）
  private throwCd = 0; // 投擲の共通クールダウン（秒）
  private enabled = false;

  private grenades: Grenade[] = [];
  private provider: MeleeTargetProvider | null = null;

  private explosionFx: ExplosionFx;
  private overlay: FlashbangOverlay;
  private hudEl: HTMLElement | null;

  // フラグの軌道プレビュー（長押し中に表示する弧と着弾リング）
  private previewLine: THREE.Mesh;
  private previewLineMat: THREE.MeshBasicMaterial;
  private previewRing: THREE.Mesh;
  private previewRingMat: THREE.MeshBasicMaterial;

  // 作業用ベクトル
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private player: PlayerController,
    private health: Health,
    private weapons: WeaponSystem,
    private melee: MeleeSystem,
    private hud: HUD,
    private sound: SoundSystem
  ) {
    this.explosionFx = new ExplosionFx(scene, camera);
    this.overlay = new FlashbangOverlay();
    this.hudEl = document.getElementById("grenade-count");

    // 軌道プレビュー（弧の管）
    this.previewLineMat = new THREE.MeshBasicMaterial({
      color: 0xffd23a,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.previewLine = new THREE.Mesh(new THREE.BufferGeometry(), this.previewLineMat);
    this.previewLine.visible = false;
    scene.add(this.previewLine);

    // 着弾リング（最初に床へ落ちる位置の目安）
    this.previewRingMat = new THREE.MeshBasicMaterial({
      color: 0xffd23a,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ringGeo = new THREE.RingGeometry(0.28, 0.42, 24);
    this.previewRing = new THREE.Mesh(ringGeo, this.previewRingMat);
    this.previewRing.rotation.x = -Math.PI / 2;
    this.previewRing.visible = false;
    scene.add(this.previewRing);

    this.updateHud();
  }

  // グレネードを使えるモードかどうかを切り替える。
  setEnabled(b: boolean): void {
    this.enabled = b;
    if (this.hudEl) this.hudEl.style.display = b ? "block" : "none";
    if (!b) this.hidePreview();
  }

  // 現在モードの近接対象提供者を毎フレーム差し込む（敵への爆風効果に使う）。
  setProvider(provider: MeleeTargetProvider | null): void {
    this.provider = provider;
  }

  // アイテム取得などでフラグを補充する。
  addFrag(n: number): void {
    this.fragAmmo = Math.min(this.FRAG_MAX, this.fragAmmo + n);
    this.updateHud();
  }

  // 投擲入力の処理。プレイヤー更新の後（カメラ確定後）に呼ぶ。生存中のみ投擲可。
  // フラグは長押し中に軌道をプレビューし、離した瞬間に投擲。フラッシュは押下で即投擲。
  handleInput(input: InputState, alive: boolean): void {
    if (!this.enabled || !alive) {
      this.hidePreview();
      return;
    }
    // フラグ：長押し中は軌道プレビュー、離したら投擲
    if (input.fragHeld && this.fragAmmo > 0) {
      this.showFragPreview();
    } else {
      this.hidePreview();
    }
    if (input.fragReleased) {
      this.tryThrow("frag");
      this.hidePreview();
    }
    // フラッシュ：押した瞬間に投擲
    if (input.flashThrow) {
      this.tryThrow("flash");
    }
  }

  // フラグの放物線を、最初に床へ落ちる地点まで描く（バウンド前まで）。
  // 実際の投擲と同じ aimThrow を使うので、弧と着弾は投げた結果と一致する。
  private showFragPreview(): void {
    const origin = new THREE.Vector3();
    const vel = new THREE.Vector3();
    this.aimThrow(origin, vel);

    let px = origin.x;
    let py = origin.y;
    let pz = origin.z;
    let vx = vel.x;
    let vy = vel.y;
    let vz = vel.z;

    const G = 26;
    const step = 0.04;
    const pts: THREE.Vector3[] = [new THREE.Vector3(px, py, pz)];
    let landing: THREE.Vector3 | null = null;
    for (let i = 0; i < 80; i++) {
      vy -= G * step;
      px += vx * step;
      py += vy * step;
      pz += vz * step;
      if (py <= 0.12) {
        landing = new THREE.Vector3(px, 0.12, pz);
        pts.push(landing);
        break;
      }
      pts.push(new THREE.Vector3(px, py, pz));
    }
    if (pts.length < 2) {
      this.hidePreview();
      return;
    }

    const curve = new THREE.CatmullRomCurve3(pts);
    const seg = Math.max(12, pts.length * 2);
    const geo = new THREE.TubeGeometry(curve, seg, 0.04, 6, false);
    this.previewLine.geometry.dispose();
    this.previewLine.geometry = geo;
    this.previewLine.visible = true;

    if (landing) {
      this.previewRing.position.set(landing.x, 0.06, landing.z);
      this.previewRing.visible = true;
    } else {
      this.previewRing.visible = false;
    }
  }

  private hidePreview(): void {
    this.previewLine.visible = false;
    this.previewRing.visible = false;
  }

  // ===== オンライン（フェーズ2）：弾道・命中はサーバー権威。ここは送信用の値計算と演出のみ。 =====

  // 投擲のスポーン位置と初速を求めて返す（サーバーへ送る用）。ローカル弾は生成しない。
  computeThrow(): { origin: THREE.Vector3; velocity: THREE.Vector3 } {
    const origin = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    this.aimThrow(origin, velocity);
    return { origin, velocity };
  }

  // サーバーの GRENADE_EXPLODE を受けて、フラグの爆発演出を再生する。
  // 自機の吹き飛ばし（グレネードジャンプ）はローカル移動なのでここで適用。HPはサーバー権威。
  explodeFragAt(x: number, y: number, z: number): void {
    this.sound.playExplosion();
    this.explosionFx.spawnFrag(x, y, z);
    const pcx = this.player.position.x;
    const pcy = this.player.position.y + 1.0;
    const pcz = this.player.position.z;
    const pd = Math.hypot(pcx - x, pcy - y, pcz - z);
    if (pd <= this.FRAG_RADIUS) {
      const falloff = 1 - pd / this.FRAG_RADIUS;
      let dx = pcx - x;
      let dz = pcz - z;
      let hl = Math.hypot(dx, dz);
      if (hl < 0.0001) {
        dx = 0;
        dz = 1;
        hl = 1;
      }
      const nx = dx / hl;
      const nz = dz / hl;
      this.player.applyExplosionImpulse(nx * (16 * falloff + 4), 9 * falloff + 3, nz * (16 * falloff + 4));
      this.melee.addShake(0.05 * falloff + 0.02);
    }
    if (pd <= this.FRAG_RADIUS * 2.2) this.melee.addShake(0.015);
  }

  // サーバーの FLASHBANG_EXPLODE を受けて、視線方向と距離からホワイトアウト量を独立計算する。
  explodeFlashAt(x: number, y: number, z: number): void {
    this.sound.playFlashbang();
    this.explosionFx.spawnFlash(x, y, z);
    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldDirection(this.camDir);
    const d = Math.hypot(this.camPos.x - x, this.camPos.y - y, this.camPos.z - z);
    if (d <= this.FLASH_RADIUS) {
      const base = 1 - d / this.FLASH_RADIUS;
      const tx = x - this.camPos.x;
      const ty = y - this.camPos.y;
      const tz = z - this.camPos.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const dot = (tx / tl) * this.camDir.x + (ty / tl) * this.camDir.y + (tz / tl) * this.camDir.z;
      const facing = THREE.MathUtils.clamp((dot + 0.2) / 1.2, 0.15, 1);
      const amt = Math.min(1, base * (0.4 + 0.9 * facing) * 1.7);
      this.overlay.trigger(amt);
    }
  }

  private tryThrow(type: GrenadeType): void {
    if (this.throwCd > 0) return;
    const ammo = type === "frag" ? this.fragAmmo : this.flashAmmo;
    if (ammo <= 0) return;

    if (type === "frag") this.fragAmmo--;
    else this.flashAmmo--;
    this.throwCd = this.NADE_THROW_CD;

    this.spawn(type);
    this.sound.whoosh();
    this.weapons.triggerThrowDip();
    this.updateHud();
  }

  // 投擲のスポーン位置と初速を求める。右手から投げるように、発射点をカメラの右へ
  // ずらし、照準線上の前方の点へ向けて投げる（右斜め前→正面へ収束する軌道）。
  // 実際の投擲とプレビューで同じ計算を使い、見た目と着弾を一致させる。
  private aimThrow(origin: THREE.Vector3, vel: THREE.Vector3): void {
    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldDirection(this.camDir); // 正規化済み・matrixWorldも更新される
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize(); // カメラの右方向

    // スポーン位置：前方0.5m＋右へ THROW_RIGHT、さらに少し下げる
    origin
      .copy(this.camPos)
      .addScaledVector(this.camDir, 0.5)
      .addScaledVector(this.right, this.THROW_RIGHT);
    origin.y -= 0.1;

    // 照準線上の前方の点（収束先）へ向けて投げる
    const aim = this.tmp.copy(this.camPos).addScaledVector(this.camDir, this.AIM_DIST);
    vel.copy(aim).sub(origin).normalize().multiplyScalar(15);
    vel.y += 3.5;

    // 走り投げの慣性を乗せる
    const pv = this.player.velocity;
    vel.x += pv.x * 0.6;
    vel.z += pv.z * 0.6;
  }

  private spawn(type: GrenadeType): void {
    const origin = new THREE.Vector3();
    const vel = new THREE.Vector3();
    this.aimThrow(origin, vel);

    // スピン（各軸 −3〜+3 rad/s）
    const spin = new THREE.Vector3(
      (Math.random() * 2 - 1) * 3,
      (Math.random() * 2 - 1) * 3,
      (Math.random() * 2 - 1) * 3
    );

    const fuse = type === "frag" ? this.FRAG_FUSE : this.FLASH_FUSE;
    const g = new Grenade(type, origin, vel, spin, fuse);
    this.scene.add(g.group);
    this.grenades.push(g);
  }

  // 毎フレームの更新（弾道・信管・補充・エフェクト・ホワイトアウト回復）。
  update(dt: number, colliders: THREE.Box3[]): void {
    // 補充（種別ごとに独立。上限到達中はタイマー0を維持）
    if (this.fragAmmo < this.FRAG_MAX) {
      this.fragRegen += dt;
      if (this.fragRegen >= this.NADE_REGEN_TIME) {
        this.fragAmmo++;
        this.fragRegen = 0;
        this.updateHud();
      }
    } else {
      this.fragRegen = 0;
    }
    if (this.flashAmmo < this.FLASH_MAX) {
      this.flashRegen += dt;
      if (this.flashRegen >= this.NADE_REGEN_TIME) {
        this.flashAmmo++;
        this.flashRegen = 0;
        this.updateHud();
      }
    } else {
      this.flashRegen = 0;
    }

    if (this.throwCd > 0) this.throwCd = Math.max(0, this.throwCd - dt);

    // 飛行中のグレネードを進め、信管が尽きたら起爆する
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (g.update(dt, colliders)) {
        const p = g.getPosition();
        if (g.type === "frag") this.detonateFrag(p.x, p.y, p.z);
        else this.detonateFlash(p.x, p.y, p.z);
        g.dispose(this.scene);
        this.grenades.splice(i, 1);
      }
    }

    this.explosionFx.update(dt);
    this.overlay.update(dt);
  }

  // フラグ起爆：敵もプレイヤーも爆風で吹き飛ぶ。
  private detonateFrag(x: number, y: number, z: number): void {
    this.sound.playExplosion();
    this.explosionFx.spawnFrag(x, y, z);

    // 敵への爆風（全生存敵）
    if (this.provider) {
      for (const t of this.provider.getMeleeTargets()) {
        if (!t.isAlive()) continue;
        const cx = t.position.x;
        const cy = t.position.y + 1.0;
        const cz = t.position.z;
        const d = Math.hypot(cx - x, cy - y, cz - z);
        if (d > this.FRAG_RADIUS) continue;
        const falloff = 1 - d / this.FRAG_RADIUS;
        // 水平方向の吹き飛ばし向き（ゼロ時はランダム水平）
        let dx = cx - x;
        let dz = cz - z;
        let hl = Math.hypot(dx, dz);
        if (hl < 0.0001) {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a);
          dz = Math.sin(a);
          hl = 1;
        }
        const nx = dx / hl;
        const nz = dz / hl;
        const kb = 14 * falloff + 5;
        t.applyKnockback(nx * kb, nz * kb, 0.8, 0.5);
        const dmg = Math.max(15, 120 * falloff);
        if (t.applyDamage(dmg)) this.hud.addKillFeed("💥 GRENADE KILL");
      }
    }

    // プレイヤーへの爆風（自爆あり。グレネードジャンプが成立する）
    const pcx = this.player.position.x;
    const pcy = this.player.position.y + 1.0;
    const pcz = this.player.position.z;
    const pd = Math.hypot(pcx - x, pcy - y, pcz - z);
    if (pd <= this.FRAG_RADIUS) {
      const falloff = 1 - pd / this.FRAG_RADIUS;
      let dx = pcx - x;
      let dz = pcz - z;
      let hl = Math.hypot(dx, dz);
      if (hl < 0.0001) {
        dx = 0;
        dz = 1;
        hl = 1;
      }
      const nx = dx / hl;
      const nz = dz / hl;
      const horiz = 16 * falloff + 4;
      const up = 9 * falloff + 3;
      this.player.applyExplosionImpulse(nx * horiz, up, nz * horiz);
      this.melee.addShake(0.05 * falloff + 0.02);
      // 自爆ダメージは戦闘モード（provider あり）でのみ適用する
      if (this.provider) this.health.damage(Math.round(55 * falloff));
    }
    if (pd <= this.FRAG_RADIUS * 2.2) {
      this.melee.addShake(0.015); // 圏外でも軽い揺れ
    }
  }

  // フラッシュ起爆：視界が真っ白になり、近くの敵はよろける。
  private detonateFlash(x: number, y: number, z: number): void {
    this.sound.playFlashbang();
    this.explosionFx.spawnFlash(x, y, z);

    // プレイヤーのホワイトアウト量
    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldDirection(this.camDir);
    const d = Math.hypot(this.camPos.x - x, this.camPos.y - y, this.camPos.z - z);
    if (d <= this.FLASH_RADIUS) {
      const base = 1 - d / this.FLASH_RADIUS;
      // 爆心への向きと視線の内積（1=直視 / −1=真後ろ）
      const tx = x - this.camPos.x;
      const ty = y - this.camPos.y;
      const tz = z - this.camPos.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      const dot =
        (tx / tl) * this.camDir.x + (ty / tl) * this.camDir.y + (tz / tl) * this.camDir.z;
      const facing = THREE.MathUtils.clamp((dot + 0.2) / 1.2, 0.15, 1);
      const amt = Math.min(1, base * (0.4 + 0.9 * facing) * 1.7);
      this.overlay.trigger(amt);
    }

    // 敵への閃光（12m以内をよろけさせる）
    if (this.provider) {
      for (const t of this.provider.getMeleeTargets()) {
        if (!t.isAlive()) continue;
        const ed = Math.hypot(t.position.x - x, t.position.y - y, t.position.z - z);
        if (ed <= 12) {
          t.applyStagger(1.8 * (1 - ed / 12) + 0.4);
        }
      }
    }
  }

  // リスポーン・モード切替で完全初期化する。
  reset(): void {
    this.fragAmmo = this.FRAG_MAX;
    this.flashAmmo = this.FLASH_MAX;
    this.fragRegen = 0;
    this.flashRegen = 0;
    this.throwCd = 0;
    for (const g of this.grenades) g.dispose(this.scene);
    this.grenades = [];
    this.explosionFx.clear();
    this.overlay.reset();
    this.hidePreview();
    this.updateHud();
  }

  // モード終了時の片付け（飛行中・エフェクト・ホワイトアウトを消す）。
  clear(): void {
    for (const g of this.grenades) g.dispose(this.scene);
    this.grenades = [];
    this.explosionFx.clear();
    this.overlay.reset();
    this.hidePreview();
  }

  private updateHud(): void {
    if (this.hudEl) {
      this.hudEl.textContent = `G 💣 ${this.fragAmmo} / F ✨ ${this.flashAmmo}`;
    }
  }
}
