import { Game } from "./Game";

// エントリポイント。
// 通常時：開始オーバーレイをタップ／クリックするとモード選択へ進みます。
// DEV RANGE：VITE_DEV_RANGE が設定されたときだけ、開発者テストレンジを起動します。
const app = document.getElementById("app") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

const game = new Game(app);

// VITE_DEV_RANGE は Vite がビルド時に静的置換する。
// 本番（Railway）では未設定 → undefined となり、この分岐ごと除去されるため、
// DevRange は本番バンドルに一切含まれない。必ずこの形のまま直接参照する
// （中間変数へ入れると静的置換されないため。wsUrl() と同じ方針）。
if ((import.meta as unknown as { env: { VITE_DEV_RANGE?: string } }).env.VITE_DEV_RANGE === "true") {
  // テストレンジ起動：開始オーバーレイは出さず、内部だけ動的 import する。
  overlay.classList.add("hidden");
  import("./dev/DevRange").then(({ DevRange }) => {
    new DevRange(game).start();
  });
} else {
  // 通常起動
  const begin = (): void => {
    overlay.classList.add("hidden");
    // モード選択画面を表示する（実際の開始はモードを選んでから）
    game.start();
  };
  overlay.addEventListener("click", begin);
}
