import { Stance } from "./types";

// 1件ぶんのキルフィード表示（右上に積む通知）。
interface KillFeedEntry {
  el: HTMLElement;
  life: number; // 残り表示時間（秒）
}

// HTML側のHUD要素を取得し、ゲームから簡単に更新できるようにまとめたクラスです。
export class HUD {
  private crosshair = document.getElementById("crosshair") as HTMLElement;
  private chTop = this.crosshair.querySelector(".top") as HTMLElement;
  private chBottom = this.crosshair.querySelector(".bottom") as HTMLElement;
  private chLeft = this.crosshair.querySelector(".left") as HTMLElement;
  private chRight = this.crosshair.querySelector(".right") as HTMLElement;

  private reflex = document.getElementById("reflex") as HTMLElement;
  private hitmarker = document.getElementById("hitmarker") as HTMLElement;

  private ammoMag = document.getElementById("ammo-mag") as HTMLElement;
  private ammoReserve = document.getElementById("ammo-reserve") as HTMLElement;
  private weaponName = document.getElementById("weapon-name") as HTMLElement;

  private stanceLabel = document.getElementById("stance-label") as HTMLElement;
  private speedLabel = document.getElementById("speed-label") as HTMLElement;
  private fireMode = document.getElementById("fire-mode") as HTMLElement;

  // 左下ステータスパネルのHPバー（Healthの値を毎フレーム反映する）。
  private statusHpFill = document.getElementById("status-hp-fill") as HTMLElement;
  private statusHpLabel = document.getElementById("status-hp-label") as HTMLElement;

  // 近接の中央フラッシュ（FINISHER / KNOCKBACK など）とキルフィード
  private meleeBanner = document.getElementById("melee-banner") as HTMLElement;
  private killfeed = document.getElementById("killfeed") as HTMLElement;

  private hitTimer = 0;
  private bannerTimer = 0; // 中央フラッシュの残り表示時間（秒）
  private readonly BANNER_DUR = 0.5;
  private killEntries: KillFeedEntry[] = [];
  private readonly KILL_DUR = 3.0; // キルフィード1件の表示時間（秒）
  private readonly KILL_MAX = 5; // 同時表示の上限

  setAmmo(mag: number, reserve: number): void {
    this.ammoMag.textContent = String(mag);
    this.ammoReserve.textContent = String(reserve);
  }

  setWeaponName(name: string): void {
    this.weaponName.textContent = name;
  }

  // 連射モード表示（AUTO / SEMI）。武器切替・初期化時に武器スペックから設定する。
  setFireMode(label: string): void {
    if (this.fireMode) this.fireMode.textContent = label;
  }

  // 左下ステータスパネルのHPバーを現在値に合わせて更新する（緑→黄→赤）。
  setHp(current: number, max: number): void {
    if (!this.statusHpFill) return;
    const ratio = max > 0 ? current / max : 0;
    this.statusHpFill.style.width = `${Math.round(ratio * 100)}%`;
    let color = "#46d36a";
    if (ratio <= 0.3) color = "#e7503a";
    else if (ratio <= 0.6) color = "#e7b53a";
    this.statusHpFill.style.background = color;
    if (this.statusHpLabel) this.statusHpLabel.textContent = `HP ${Math.round(current)}`;
  }

  setStance(stance: Stance): void {
    this.stanceLabel.textContent = stance;
  }

  setSpeed(speed: number): void {
    this.speedLabel.textContent = `SPEED ${speed.toFixed(1)} m/s`;
  }

  // 表示モードの切替（腰だめ十字／ドットサイト）
  // スナイパー専用の円形スコープは廃止し、覗き込み時もドットサイトを表示します。
  showCrosshair(): void {
    this.crosshair.style.display = "block";
    this.reflex.style.display = "none";
  }
  showReflex(): void {
    this.crosshair.style.display = "none";
    this.reflex.style.display = "block";
  }

  // 腰だめ十字の開き具合（移動・射撃で広がる拡散の可視化）
  setCrosshairGap(gapPx: number): void {
    const g = Math.max(4, gapPx);
    this.chTop.style.transform = `translate(-50%, calc(-100% - ${g}px))`;
    this.chBottom.style.transform = `translate(-50%, ${g}px)`;
    this.chLeft.style.transform = `translate(calc(-100% - ${g}px), -50%)`;
    this.chRight.style.transform = `translate(${g}px, -50%)`;
  }

  // 命中マーカーを点滅させる
  flashHitmarker(): void {
    this.hitTimer = 0.12;
    this.hitmarker.style.opacity = "1";
  }

  // 画面中央下に近接の結果テキスト（FINISHER / KNOCKBACK / KICK FINISHER）を一瞬出す。
  flashCenter(text: string): void {
    if (!this.meleeBanner) return;
    this.meleeBanner.textContent = text;
    this.meleeBanner.style.opacity = "1";
    this.bannerTimer = this.BANNER_DUR;
  }

  // 右上のキルフィードに1行追加する（🔪 KNIFE FINISHER など）。
  addKillFeed(text: string): void {
    if (!this.killfeed) return;
    const el = document.createElement("div");
    el.className = "kf";
    el.textContent = text;
    this.killfeed.appendChild(el);
    this.killEntries.push({ el, life: this.KILL_DUR });
    // 上限を超えたら古いものから消す
    while (this.killEntries.length > this.KILL_MAX) {
      const old = this.killEntries.shift();
      if (old) old.el.remove();
    }
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        this.hitmarker.style.opacity = "0";
      }
    }

    // 中央フラッシュのフェードアウト
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      const k = Math.max(0, this.bannerTimer / this.BANNER_DUR);
      if (this.meleeBanner) this.meleeBanner.style.opacity = String(k);
    }

    // キルフィードの寿命管理（終盤でフェードし、尽きたら除去）
    for (let i = this.killEntries.length - 1; i >= 0; i--) {
      const e = this.killEntries[i];
      e.life -= dt;
      if (e.life <= 0) {
        e.el.remove();
        this.killEntries.splice(i, 1);
        continue;
      }
      if (e.life < 0.5) e.el.style.opacity = String(e.life / 0.5);
    }
  }
}
