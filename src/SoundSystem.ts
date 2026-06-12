// WebAudio で効果音をその場で合成するクラスです。音声ファイルは使わず、
// 発振器とノイズだけで手応え（銃声・風切り・衝撃・鈍い打撃）を作ります。
// すべての音はマスターゲインを通し、設定画面から音量・オン/オフを変更できます。

const VOL_STORE = "arena_volume";
const SFX_STORE = "arena_sfx_enabled";

export class SoundSystem {
  // ブラウザの音声処理の入口。ユーザー操作がないと作れないため遅延生成します。
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7; // 0..1
  private enabled = true;

  constructor() {
    const v = parseFloat(localStorage.getItem(VOL_STORE) || "");
    if (isFinite(v) && v >= 0 && v <= 1) this.volume = v;
    this.enabled = localStorage.getItem(SFX_STORE) !== "0";
  }

  // ===== 設定 =====
  getVolume(): number {
    return this.volume;
  }
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
    try {
      localStorage.setItem(VOL_STORE, String(this.volume));
    } catch {
      // 無視
    }
  }
  isEnabled(): boolean {
    return this.enabled;
  }
  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(SFX_STORE, on ? "1" : "0");
    } catch {
      // 無視
    }
  }

  // 必要になった瞬間に AudioContext とマスターゲインを用意します。
  // SFXが無効なら null を返すため、すべての効果音が一括でミュートされます。
  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (this.ctx === null) {
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.master === null) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  // 指定した長さ（サンプル数）のホワイトノイズを鳴らすための音源を作ります。
  // decayPow が大きいほど、頭が大きく尾が短い「パチッ」とした減衰になります。
  private makeNoise(ctx: AudioContext, samples: number, decayPow: number): AudioBufferSourceNode {
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      const env = Math.pow(1 - i / samples, decayPow);
      data[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  // 発砲音。鋭いノイズのクラックに、低音の芯（バチッという胴）を重ねた短い銃声。
  gunshot(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    // クラック（高域寄りのノイズ）
    const noise = this.makeNoise(ctx, Math.floor(ctx.sampleRate * 0.09), 4);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.5, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    noise.connect(hp).connect(nGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.1);

    // 胴（低音の素早い沈み込み）
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.08);
    const oGain = ctx.createGain();
    oGain.gain.setValueAtTime(0.5, now);
    oGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(oGain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  // 着弾／ヒットマーカー。短く高い「チッ」という確認音。
  hitmarker(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(1700, now + 0.04);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  // リロードの機械音。短いクリックを2つ重ねた「カチャ」。
  reloadClick(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const click = (at: number, freq: number): void => {
      const noise = this.makeNoise(ctx, Math.floor(ctx.sampleRate * 0.03), 5);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.5;
      bp.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      noise.connect(bp).connect(g).connect(this.master as GainNode);
      noise.start(at);
      noise.stop(at + 0.05);
    };
    const now = ctx.currentTime;
    click(now, 1800);
    click(now + 0.12, 1200);
  }

  // 被弾。低めの鈍い衝撃（自分がダメージを受けたとき）。
  hurt(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  // 近接の発動時に鳴る風切り音。ノイズを帯域通過させ、低めから高めへ滑らせます。
  whoosh(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const src = this.makeNoise(ctx, 4400, 1);
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 2.5;
    band.frequency.setValueAtTime(400, now);
    band.frequency.exponentialRampToValueAtTime(1600, now + 0.22);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    src.connect(band).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.24);
  }

  // キックが当たったときの重い衝撃音。低い正弦波の沈み込みと短いノイズを重ねます。
  impact(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(oscGain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.24);

    const noise = this.makeNoise(ctx, 1600, 3);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    noise.connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.12);
  }

  // フラググレネードの起爆音。低音の沈み込みと、こもった爆風ノイズを重ねます。
  playExplosion(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.4);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(oscGain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.52);

    const samples = Math.floor(ctx.sampleRate * 0.35);
    const noise = this.makeNoise(ctx, samples, 2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    noise.connect(lp).connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.37);
  }

  // フラッシュバンの起爆音。鋭い破裂と、尾を引く高周波の耳鳴りを重ねます。
  playFlashbang(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const noise = this.makeNoise(ctx, 2000, 1.5);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.55, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    noise.connect(noiseGain).connect(this.master);
    noise.start(now);
    noise.stop(now + 0.14);

    const ring = ctx.createOscillator();
    ring.type = "sine";
    ring.frequency.setValueAtTime(3400, now);
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.18, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    ring.connect(ringGain).connect(this.master);
    ring.start(now);
    ring.stop(now + 1.42);
  }

  // KEEP MOVING の速度低下警告。低周波のうなり（短い）。猶予中に繰り返し鳴らす。
  warningTone(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  // KEEP MOVING のダメージ中ビープ（短い高め）。断続的に鳴らす。
  beep(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(720, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // 鈍い打撃音。周波数を変えて使い回します（ナイフ命中280、キック空振り160 など）。
  thud(freq: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);
  }
}
