import { Stance } from "./types";

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

  private hitTimer = 0;

  setAmmo(mag: number, reserve: number): void {
    this.ammoMag.textContent = String(mag);
    this.ammoReserve.textContent = String(reserve);
  }

  setWeaponName(name: string): void {
    this.weaponName.textContent = name;
  }

  setStance(stance: Stance): void {
    this.stanceLabel.textContent = stance;
  }

  setSpeed(speed: number): void {
    this.speedLabel.textContent = `SPEED ${speed.toFixed(1)}`;
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

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) {
        this.hitmarker.style.opacity = "0";
      }
    }
  }
}
