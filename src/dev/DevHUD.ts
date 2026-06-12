import type { PlayerController } from "../PlayerController";

// 左上の「🔧 DEV RANGE」バッジ＋「終了して戻る ×」ボタンと、任意表示のプレイヤー座標。
// DEV RANGE 専用の常時HUD。本番バンドルには含まれない。
export class DevHUD {
  private root: HTMLDivElement;
  private coords: HTMLDivElement;
  private coordsVisible = false;

  constructor(onExit: () => void) {
    const root = document.createElement("div");
    root.id = "dev-hud";
    root.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:9998;pointer-events:none;" +
      "font-family:system-ui,-apple-system,sans-serif;display:flex;flex-direction:column;gap:6px;";

    const badgeRow = document.createElement("div");
    badgeRow.style.cssText = "display:flex;align-items:center;gap:8px;";

    const badge = document.createElement("div");
    badge.textContent = "🔧 DEV RANGE";
    badge.style.cssText =
      "font-weight:900;letter-spacing:0.14em;font-size:13px;color:#1a1a1a;" +
      "background:#ffb83c;padding:4px 10px;border-radius:5px;box-shadow:0 2px 8px rgba(0,0,0,0.5);";

    const exit = document.createElement("button");
    exit.textContent = "終了して戻る ×";
    exit.style.cssText =
      "pointer-events:auto;font-weight:700;font-size:12px;color:#eee;cursor:pointer;" +
      "background:rgba(20,24,30,0.85);border:1px solid rgba(255,255,255,0.25);" +
      "padding:4px 10px;border-radius:5px;";
    exit.onclick = () => onExit();

    badgeRow.appendChild(badge);
    badgeRow.appendChild(exit);

    const coords = document.createElement("div");
    coords.style.cssText =
      "align-self:flex-start;font-size:12px;color:#bfe6ff;background:rgba(8,10,14,0.6);padding:3px 8px;border-radius:4px;" +
      "text-shadow:0 1px 2px rgba(0,0,0,0.9);display:none;";

    root.appendChild(badgeRow);
    root.appendChild(coords);
    document.body.appendChild(root);

    this.root = root;
    this.coords = coords;
  }

  setCoordsVisible(on: boolean): void {
    this.coordsVisible = on;
    this.coords.style.display = on ? "block" : "none";
  }

  // 毎フレーム：座標表示が有効ならプレイヤー位置を更新する。
  update(player: PlayerController): void {
    if (!this.coordsVisible) return;
    const p = player.position;
    this.coords.textContent = `XYZ ( ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)} )`;
  }

  dispose(): void {
    this.root.remove();
  }
}
