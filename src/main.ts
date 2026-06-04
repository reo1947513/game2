import { Game } from "./Game";

// エントリポイント。開始オーバーレイをクリックするとゲームが始まります。
const app = document.getElementById("app") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

const game = new Game(app);

function begin(): void {
  overlay.classList.add("hidden");
  game.start();
}

overlay.addEventListener("click", begin);

// ポインタロックが外れたら（Escなど）オーバーレイを再表示
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === null) {
    overlay.classList.remove("hidden");
  }
});
