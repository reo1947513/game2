import { Game } from "./Game";

// エントリポイント。
// 通常時：開始オーバーレイをタップ／クリックするとモード選択へ進みます。
// DEV RANGE：VITE_DEV_RANGE が "true" のビルドでのみ、メニューの隠し入口
//   （フッターの v0.0.1 を3クリック → パスワード）から開発者テストレンジを起動します。
const app = document.getElementById("app") as HTMLElement;
const overlay = document.getElementById("overlay") as HTMLElement;

const game = new Game(app);

// 通常起動（開始オーバーレイのクリックでモード選択へ）。
const begin = (): void => {
  overlay.classList.add("hidden");
  game.start();
};
overlay.addEventListener("click", begin);

// VITE_DEV_RANGE は Vite がビルド時に静的置換する。本番（未設定）ではこの分岐ごと
// 除去され、配下の dev 動的 import（DevRange / DevAuthDialog）はバンドルに一切含まれない。
// 必ずこの形のまま直接参照する（中間変数では静的置換されないため）。
if ((import.meta as unknown as { env: { VITE_DEV_RANGE?: string } }).env.VITE_DEV_RANGE === "true") {
  const AUTH_KEY = "arena_dev_auth";

  // DEV RANGE を起動する：メニューを隠してメインループを止め、DevRange に切り替える。
  const launchDevRange = async (): Promise<void> => {
    overlay.classList.add("hidden");
    game.enterDevRange();
    const { DevRange } = await import("./dev/DevRange");
    const dev = new DevRange(game);
    dev.start(() => {
      // 「終了して戻る」：メニューへ復帰（session 認証は保持し、再入場はパスワード不要）。
      game.resumeToMenu();
    });
  };

  // 隠しジェスチャ発火時の処理：認証済みなら直接起動、未認証ならパスワードダイアログ。
  const openGate = async (): Promise<void> => {
    if (sessionStorage.getItem(AUTH_KEY) === "1") {
      await launchDevRange();
      return;
    }
    const { DevAuthDialog } = await import("./dev/DevAuthDialog");
    new DevAuthDialog().open((ok) => {
      if (!ok) return; // 不正解は静かに閉じる（DevAuthDialog 側で処理）
      sessionStorage.setItem(AUTH_KEY, "1");
      void launchDevRange();
    });
  };

  // メニューのフッター v0.0.1 を3クリックで openGate を呼ぶよう Game 経由で配線。
  game.setDevGesture(() => {
    void openGate();
  });

  // 同一セッションで認証済みなら、開始オーバーレイを出さず直接 DEV RANGE へ。
  if (sessionStorage.getItem(AUTH_KEY) === "1") {
    void launchDevRange();
  }
}
