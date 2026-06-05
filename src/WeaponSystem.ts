import * as THREE from "three";
import { InputState, WeaponKind, WeaponSpec } from "./types";
import { HUD } from "./HUD";
import { Stage, Target } from "./Stage";
import { Input } from "./Input";
import { Scope } from "./Scope";
import { Hitmarker } from "./Hitmarker";

// 1丁分の見た目と状態
interface WeaponInstance {
  spec: WeaponSpec;
  model: THREE.Group;
  muzzle: THREE.Mesh; // マズルフラッシュ（発砲炎）
  hipPos: THREE.Vector3; // 腰だめ位置（カメラ基準・右手側）
  adsPos: THREE.Vector3; // 覗き込み位置
  mag: number; // 現在のマガジン弾数
  reserve: number; // 予備弾
}

// 武器の生成・表示・射撃をすべて担当します。
export class WeaponSystem {
  private weapons = new Map<WeaponKind, WeaponInstance>();
  private current: WeaponKind = WeaponKind.Assault;

  private adsProgress = 0; // 0=腰だめ, 1=覗き込み完了
  private readonly baseFov = 75;

  private lastShotTime = -999;
  private prevFiring = false;
  private reloading = false;
  private reloadEndTime = 0;

  // 発砲による一時的な拡散（撃つたびに増え、時間で戻る）
  private fireBloom = 0;
  private recoilOffset = 0; // 武器モデルの後退量（見た目の反動）
  private muzzleTimer = 0;

  private bobTime = 0;

  // 覗き込み時の円形スコープ枠（スナイパー用）
  private scope = new Scope();

  // ヘッドショットなどの通知
  private hitmarker = new Hitmarker();

  // リロード動作の進み具合（0=通常、1=最も大きく動いた瞬間）。見た目だけに使います。
  private reloadAnim = 0;

  private raycaster = new THREE.Raycaster();
  private shootables: THREE.Object3D[] = [];

  // モード側が射撃結果を受け取るためのフック（未設定なら通常動作）。
  // targetHitHook が true を返したら、的の通常処理（倒す・累積ダメージ）は行わない。
  targetHitHook: ((t: Target, now: number) => boolean) | null = null;
  // 発砲のたびに1回呼ばれる（命中率の計算などに使う）。
  shotFiredHook: (() => void) | null = null;

  // モードが登録する「動く敵」のメッシュ。射撃の対象に加わる。
  enemyTargets: THREE.Object3D[] = [];
  // 動く敵に当たったとき呼ばれる。obj は当たった敵、damage は武器の威力。
  enemyHitHook: ((obj: THREE.Object3D, damage: number) => void) | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    private input: Input,
    private stage: Stage,
    private hud: HUD
  ) {
    // カメラをシーンに入れておかないと、カメラの子（武器モデル）が描画されません
    scene.add(this.camera);

    this.weapons.set(WeaponKind.Assault, this.buildAssault());
    this.weapons.set(WeaponKind.Sniper, this.buildSniper());
    this.weapons.set(WeaponKind.Shotgun, this.buildShotgun());
    this.weapons.set(WeaponKind.Smg, this.buildSmg());

    // 最初はアサルトを表示、それ以外は隠す
    this.weapons.get(WeaponKind.Sniper)!.model.visible = false;
    this.weapons.get(WeaponKind.Shotgun)!.model.visible = false;
    this.weapons.get(WeaponKind.Smg)!.model.visible = false;

    // 初期の武器名を表示する
    this.hud.setWeaponName(this.weapons.get(this.current)!.spec.displayName);

    // 射撃対象となるメッシュを集めておく（壁・床・的など）
    this.stage.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.shootables.push(o);
    });
  }

  // 現在の武器仕様
  private get spec(): WeaponSpec {
    return this.weapons.get(this.current)!.spec;
  }

  // 弾薬アイテムを拾ったとき：全武器の予備弾を上限まで補充する
  addAmmo(amount: number): void {
    for (const w of this.weapons.values()) {
      w.reserve = Math.min(w.spec.reserveMax, w.reserve + amount);
    }
    const w = this.weapons.get(this.current)!;
    this.hud.setAmmo(w.mag, w.reserve);
  }

  // 蹴りが敵に当たったとき命中マーカーを点滅させる（脚の演出は KickView 側が担当）。
  kick(hit: boolean): void {
    if (hit) this.hud.flashHitmarker();
  }

  // ---- 武器モデルの生成（仮の簡易モデル。用意済みテクスチャは後述の差し替え方法で適用） ----
  private metal(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.45,
      metalness: 0.7,
    });
  }

  private buildAssault(): WeaponInstance {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.7), this.metal(0x2b2f36));
    body.position.set(0, 0, -0.35);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.4), this.metal(0x1c1f24));
    barrel.position.set(0, 0.02, -0.82);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12), this.metal(0x23262c));
    mag.position.set(0, -0.18, -0.25);
    mag.rotation.x = 0.15;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), this.metal(0x23262c));
    grip.position.set(0, -0.15, -0.02);
    grip.rotation.x = 0.25;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.25), this.metal(0x2b2f36));
    stock.position.set(0, -0.01, 0.08);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.06), this.metal(0x111316));
    sight.position.set(0, 0.12, -0.4);
    g.add(body, barrel, mag, grip, stock, sight);

    const muzzle = this.makeMuzzle();
    muzzle.position.set(0, 0.02, -1.04);
    g.add(muzzle);

    g.position.set(0.34, -0.3, -0.62);
    g.rotation.y = 0.06;
    this.camera.add(g);

    return {
      spec: {
        kind: WeaponKind.Assault,
        displayName: "ASSAULT",
        magSize: 30,
        reserveMax: 240,
        fireInterval: 0.1,
        automatic: true,
        damage: 25,
        reloadTime: 2.0,
        hipSpread: 0.045,
        adsSpread: 0.006,
        recoilKick: 0.012,
        adsFov: 55,
        scope: false,
      },
      model: g,
      muzzle,
      hipPos: new THREE.Vector3(0.34, -0.3, -0.62),
      adsPos: new THREE.Vector3(0.0, -0.14, -0.4), // 画面中央下
      mag: 30,
      reserve: 240,
    };
  }

  private buildSniper(): WeaponInstance {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.95), this.metal(0x2a2620));
    body.position.set(0, 0, -0.45);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.75), this.metal(0x16140f));
    barrel.position.set(0, 0.0, -1.15);
    const scopeTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.42, 16),
      this.metal(0x0d0c0a)
    );
    scopeTube.rotation.x = Math.PI / 2;
    scopeTube.position.set(0, 0.14, -0.4);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.1), this.metal(0x201d18));
    mag.position.set(0, -0.13, -0.3);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.1), this.metal(0x201d18));
    grip.position.set(0, -0.15, -0.05);
    grip.rotation.x = 0.25;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.32), this.metal(0x2a2620));
    stock.position.set(0, -0.02, 0.18);
    g.add(body, barrel, scopeTube, mag, grip, stock);

    const muzzle = this.makeMuzzle();
    muzzle.position.set(0, 0.0, -1.5);
    g.add(muzzle);

    g.position.set(0.34, -0.32, -0.62);
    g.rotation.y = 0.05;
    this.camera.add(g);

    return {
      spec: {
        kind: WeaponKind.Sniper,
        displayName: "SNIPER",
        magSize: 5,
        reserveMax: 30,
        fireInterval: 0.9,
        automatic: false,
        damage: 100,
        reloadTime: 2.8,
        hipSpread: 0.09,
        adsSpread: 0.0008,
        recoilKick: 0.05,
        adsFov: 22,
        scope: true,
      },
      model: g,
      muzzle,
      hipPos: new THREE.Vector3(0.34, -0.32, -0.62),
      adsPos: new THREE.Vector3(0.0, -0.16, -0.3),
      mag: 5,
      reserve: 30,
    };
  }

  private buildShotgun(): WeaponInstance {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.6), this.metal(0x33291c));
    body.position.set(0, 0, -0.3);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.5), this.metal(0x1a1611));
    barrel.position.set(0, 0.02, -0.78);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.22), this.metal(0x241d14));
    pump.position.set(0, -0.08, -0.6);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), this.metal(0x241d14));
    grip.position.set(0, -0.15, -0.02);
    grip.rotation.x = 0.25;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.28), this.metal(0x33291c));
    stock.position.set(0, -0.01, 0.12);
    g.add(body, barrel, pump, grip, stock);

    const muzzle = this.makeMuzzle();
    muzzle.position.set(0, 0.02, -1.02);
    g.add(muzzle);

    g.position.set(0.34, -0.3, -0.62);
    g.rotation.y = 0.06;
    this.camera.add(g);

    return {
      spec: {
        kind: WeaponKind.Shotgun,
        displayName: "SHOTGUN",
        magSize: 6,
        reserveMax: 48,
        fireInterval: 0.85,
        automatic: false,
        damage: 12,
        reloadTime: 1.0,
        hipSpread: 0.07,
        adsSpread: 0.045,
        recoilKick: 0.045,
        adsFov: 50,
        scope: false,
        pellets: 8,
      },
      model: g,
      muzzle,
      hipPos: new THREE.Vector3(0.34, -0.3, -0.62),
      adsPos: new THREE.Vector3(0.0, -0.14, -0.4),
      mag: 6,
      reserve: 48,
    };
  }

  private buildSmg(): WeaponInstance {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.45), this.metal(0x26292f));
    body.position.set(0, 0, -0.25);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.28), this.metal(0x17191d));
    barrel.position.set(0, 0.02, -0.6);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.1), this.metal(0x1f2227));
    mag.position.set(0, -0.2, -0.18);
    mag.rotation.x = 0.1;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), this.metal(0x1f2227));
    grip.position.set(0, -0.14, 0.0);
    grip.rotation.x = 0.25;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.18), this.metal(0x26292f));
    stock.position.set(0, -0.01, 0.12);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.05), this.metal(0x111316));
    sight.position.set(0, 0.11, -0.3);
    g.add(body, barrel, mag, grip, stock, sight);

    const muzzle = this.makeMuzzle();
    muzzle.position.set(0, 0.02, -0.78);
    g.add(muzzle);

    g.position.set(0.34, -0.3, -0.62);
    g.rotation.y = 0.06;
    this.camera.add(g);

    return {
      spec: {
        kind: WeaponKind.Smg,
        displayName: "SMG",
        magSize: 30,
        reserveMax: 270,
        fireInterval: 0.065,
        automatic: true,
        damage: 14,
        reloadTime: 1.4,
        hipSpread: 0.05,
        adsSpread: 0.018,
        recoilKick: 0.01,
        adsFov: 58,
        scope: false,
      },
      model: g,
      muzzle,
      hipPos: new THREE.Vector3(0.34, -0.3, -0.62),
      adsPos: new THREE.Vector3(0.0, -0.14, -0.4),
      mag: 30,
      reserve: 270,
    };
  }

  // マズルフラッシュ（発砲炎）の見た目
  private makeMuzzle(): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.12, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    m.visible = false;
    return m;
  }

  // ---- 毎フレーム更新 ----
  update(dt: number, input: InputState, playerSpeed: number, now: number): void {
    this.handleSwitch(input);
    this.handleReload(input, now);

    // リロード中は銃を下げて戻す動きの「強さ」を 0→1→0 で作ります。
    // 残り時間から進み具合(0〜1)を求め、その正弦で山なりのカーブにします。
    let reloadEnv = 0;
    if (this.reloading) {
      const w = this.weapons.get(this.current)!;
      const p = THREE.MathUtils.clamp(
        1 - (this.reloadEndTime - now) / w.spec.reloadTime,
        0,
        1
      );
      reloadEnv = Math.sin(p * Math.PI);
    }
    // 急に動かず滑らかに追従させる
    this.reloadAnim += (reloadEnv - this.reloadAnim) * Math.min(1, dt * 10);

    // ADSの進行（右クリック保持で1へ、離すと0へ）
    const adsTarget = input.aiming && !this.reloading ? 1 : 0;
    this.adsProgress += (adsTarget - this.adsProgress) * Math.min(1, dt * 12);

    this.handleFire(input, playerSpeed, now);

    this.updateTransforms(dt, input, playerSpeed);
    this.updateFov();
    this.updateMuzzle(dt);
    this.updateHud(playerSpeed);

    // 発砲拡散と見た目反動を時間で戻す
    this.fireBloom = Math.max(0, this.fireBloom - dt * 0.6);
    this.recoilOffset = Math.max(0, this.recoilOffset - dt * 1.2);
    this.prevFiring = input.firing;
  }

  // 武器の並び順。モバイルのトグルボタンが次の武器へ循環するのに使う。
  private readonly order: WeaponKind[] = [
    WeaponKind.Assault,
    WeaponKind.Sniper,
    WeaponKind.Shotgun,
    WeaponKind.Smg,
  ];

  private handleSwitch(input: InputState): void {
    if (input.switchTo) this.switchToKind(input.switchTo);
  }

  // 指定した武器へ切り替える。数字キーとモバイルのトグルで共通して使う。
  private switchToKind(kind: WeaponKind): void {
    if (kind === this.current) return;
    if (!this.weapons.has(kind)) return;
    this.weapons.get(this.current)!.model.visible = false;
    this.current = kind;
    const w = this.weapons.get(this.current)!;
    w.model.visible = true;
    this.reloading = false;
    this.adsProgress = 0;
    this.hud.setWeaponName(w.spec.displayName);
    this.hud.setAmmo(w.mag, w.reserve);
  }

  // 次の武器へ循環で切り替える（モバイルの武器ボタン用）
  cycleWeapon(): void {
    const i = this.order.indexOf(this.current);
    const next = this.order[(i + 1) % this.order.length];
    this.switchToKind(next);
  }

  private handleReload(input: InputState, now: number): void {
    const w = this.weapons.get(this.current)!;
    // 手動リロード、または弾が0になったときの自動リロード
    if (
      (input.reloadPressed || w.mag <= 0) &&
      !this.reloading &&
      w.mag < w.spec.magSize &&
      w.reserve > 0
    ) {
      this.reloading = true;
      this.reloadEndTime = now + w.spec.reloadTime;
    }
    if (this.reloading && now >= this.reloadEndTime) {
      const need = w.spec.magSize - w.mag;
      const take = Math.min(need, w.reserve);
      w.mag += take;
      w.reserve -= take;
      this.reloading = false;
    }
  }

  private handleFire(input: InputState, playerSpeed: number, now: number): void {
    const w = this.weapons.get(this.current)!;
    if (this.reloading) return;

    // フルオートは保持で連射、単発はトリガーを引き直す必要がある
    const triggerOk = w.spec.automatic ? input.firing : input.firing && !this.prevFiring;
    if (!triggerOk) return;
    if (now - this.lastShotTime < w.spec.fireInterval) return;
    if (w.mag <= 0) return;

    this.lastShotTime = now;
    w.mag -= 1;
    this.fire(w, input, playerSpeed);
  }

  private fire(w: WeaponInstance, input: InputState, playerSpeed: number): void {
    // モードへ「発砲した」ことを伝える（命中率の計算用）
    if (this.shotFiredHook) this.shotFiredHook();

    // 基準となる向き（カメラ正面）と起点（カメラ位置）
    const baseDir = new THREE.Vector3();
    this.camera.getWorldDirection(baseDir);
    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);

    const moveFactor = Math.min(1, playerSpeed / this.SPEED_REF);
    const baseSpread = input.aiming ? w.spec.adsSpread : w.spec.hipSpread;
    const spread = baseSpread * (1 + moveFactor * 1.5) + this.fireBloom * 0.02;

    // 向きを左右・上下へずらすための基準軸
    const up = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(baseDir, up).normalize();
    const bitangent = new THREE.Vector3().crossVectors(baseDir, tangent).normalize();

    const objs =
      this.enemyTargets.length > 0
        ? this.shootables.concat(this.enemyTargets)
        : this.shootables;

    // ショットガンは1回の射撃で複数の弾が散らばる。通常の銃は1発。
    const pellets = w.spec.pellets ?? 1;
    for (let p = 0; p < pellets; p++) {
      const dir = baseDir.clone();
      const a = (Math.random() * 2 - 1) * spread;
      const b = (Math.random() * 2 - 1) * spread;
      dir.addScaledVector(tangent, a).addScaledVector(bitangent, b).normalize();
      this.raycaster.set(origin, dir);
      const hits = this.raycaster.intersectObjects(objs, false);
      if (hits.length > 0) this.handleHit(hits[0].object, w);
    }

    // 反動：視点を少し上へ。発砲拡散と見た目反動も加算。
    this.input.addPitch(w.spec.recoilKick);
    this.fireBloom = Math.min(8, this.fireBloom + 1);
    this.recoilOffset = Math.min(0.12, this.recoilOffset + 0.05);

    // マズルフラッシュ表示
    w.muzzle.visible = true;
    w.muzzle.scale.setScalar(0.8 + Math.random() * 0.6);
    w.muzzle.rotation.z = Math.random() * Math.PI;
    this.muzzleTimer = 0.04;
  }

  // 1本のレイが当たった対象を処理する。敵ならモードへ、的なら的の処理へ。
  private handleHit(obj: THREE.Object3D, w: WeaponInstance): void {
    // まず「動く敵」かどうかを見る。敵ならモードに処理を任せる。
    if (this.enemyTargets.indexOf(obj) >= 0) {
      const isHead = obj.userData && obj.userData.isHead === true;
      this.hud.flashHitmarker();
      if (isHead) this.hitmarker.headshot();
      const dmg = isHead ? w.spec.damage * 2 : w.spec.damage;
      if (this.enemyHitHook) this.enemyHitHook(obj, dmg);
      return;
    }
    const target = this.stage.targets.find((t) => t.mesh === obj && t.alive);
    if (!target) return;
    this.hud.flashHitmarker();
    // モードのフックがあればそちらに任せる。処理されなければ通常動作。
    let handled = false;
    if (this.targetHitHook) {
      handled = this.targetHitHook(target, performance.now() / 1000);
    }
    if (!handled) {
      // 一撃で倒れる的なら倒す。そうでなければダメージ表現（色を明るく）。
      if (w.spec.damage >= 50) {
        this.stage.onTargetHit(target, performance.now() / 1000);
      } else {
        const mat = target.mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.set(0xff6644);
        // 連続ヒットで倒す簡易処理
        target.userHits = (target.userHits ?? 0) + w.spec.damage;
        if (target.userHits >= 100) {
          target.userHits = 0;
          this.stage.onTargetHit(target, performance.now() / 1000);
        }
      }
    }
  }

  private readonly SPEED_REF = 8.5; // 拡散計算の基準速度（ダッシュ速度）

  // 武器モデルの位置（腰だめ⇔ADS）と、揺れ・反動を反映
  private updateTransforms(dt: number, input: InputState, playerSpeed: number): void {
    const w = this.weapons.get(this.current)!;
    const pos = new THREE.Vector3().lerpVectors(w.hipPos, w.adsPos, this.adsProgress);

    // 移動に合わせた小さな上下左右の揺れ（地上で移動中のみ）
    this.bobTime += dt * (playerSpeed * 1.2);
    const bobAmount = Math.min(1, playerSpeed / this.SPEED_REF) * (1 - this.adsProgress);
    const bobX = Math.cos(this.bobTime) * 0.012 * bobAmount;
    const bobY = Math.abs(Math.sin(this.bobTime)) * 0.018 * bobAmount;

    pos.x += bobX;
    pos.y += bobY;
    // 反動で奥（カメラ側、z+）へ少し引く
    pos.z += this.recoilOffset;

    // リロード動作：銃を下へ下げ、手前へ少し引き、右へ少しずらす
    const r = this.reloadAnim;
    pos.y -= r * 0.14;
    pos.z += r * 0.06;
    pos.x += r * 0.02;

    w.model.position.copy(pos);

    // ADS中は武器の傾きを正面に寄せる。反動とリロードの傾きも合算する。
    w.model.rotation.y = THREE.MathUtils.lerp(0.06, 0, this.adsProgress) + r * 0.2;
    w.model.rotation.x = -this.recoilOffset * 1.5 + r * 0.6;
    w.model.rotation.z = r * 0.35;
    // input.aiming自体は使わないが、将来の傾き調整用に参照しておく
    void input.aiming;

    // 覗き込み時、スナイパーは銃モデルがカメラ至近で視界を塞ぐため隠す（実質スコープ視点）。
    // アサルトなど scope=false の武器は通常どおり表示する。
    w.model.visible = !(w.spec.scope && this.adsProgress > 0.5);
  }

  // 視野角の更新（ADSで拡大）
  private updateFov(): void {
    const target = this.baseFov + (this.spec.adsFov - this.baseFov) * this.adsProgress;
    if (Math.abs(this.camera.fov - target) > 0.01) {
      this.camera.fov = target;
      this.camera.updateProjectionMatrix();
    }
  }

  private updateMuzzle(dt: number): void {
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) {
        for (const w of this.weapons.values()) w.muzzle.visible = false;
      }
    }
  }

  // HUDの更新（弾数・武器名・レティクル表示の切替・十字の開き）
  private updateHud(playerSpeed: number): void {
    const w = this.weapons.get(this.current)!;
    this.hud.setAmmo(w.mag, w.reserve);
    this.hud.setWeaponName(w.spec.displayName);

    const adsDone = this.adsProgress > 0.6;
    if (adsDone && this.spec.scope) {
      // スナイパー：周りを円形に囲むスコープ枠を出す。中央のドットは残す。
      this.scope.show();
      this.hud.showReflex();
    } else if (adsDone) {
      // アサルトなど：ドットサイト
      this.scope.hide();
      this.hud.showReflex();
    } else {
      this.scope.hide();
      this.hud.showCrosshair();
      const moveFactor = Math.min(1, playerSpeed / this.SPEED_REF);
      const gap = 6 + moveFactor * 18 + this.fireBloom * 1.5;
      this.hud.setCrosshairGap(gap);
    }
  }

  resetFov(): void {
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }
}
