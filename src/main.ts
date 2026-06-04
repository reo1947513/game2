import { Game } from "./Game";

// エントリポイント。開始オーバーレイをタップ／クリックするとモード選択へ進みます。
const app = document.getElementById("app") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

const game = new Game(app);

function begin(): void {
  overlay.classList.add("hidden");
  // モード選択画面を表示する（実際の開始はモードを選んでから）
  game.start();
}

overlay.addEventListener("click", begin);
