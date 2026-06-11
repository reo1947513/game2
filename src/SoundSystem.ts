// WebAudio で効果音をその場で合成するクラスです。音声ファイルは使わず、
// 発振器とノイズだけで近接戦闘の手応え（風切り・衝撃・鈍い打撃）を作ります。
// 検証済みデモ v5 のパラメータをそのまま移植しています。
export class SoundSystem {
  // ブラウザの音声処理の入口。ユーザー操作がないと作れないため遅延生成します。
  private ctx: AudioContext | null = null;

  // 必要になった瞬間に AudioContext を用意し、停止していれば再開します。
  private ensure(): AudioContext | null {
    if (this.ctx === null) {
      // 一部ブラウザの旧名（webkitAudioContext）にも対応します。
      const AC: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
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

  // 近接の発動時に鳴る風切り音。ノイズを帯域通過させ、低めから高めへ滑らせます。
  whoosh(): void {
    const ctx = this.ensure();
    if (!ctx) return;
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

    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(now);
    src.stop(now + 0.24);
  }

  // キックが当たったときの重い衝撃音。低い正弦波の沈み込みと短いノイズを重ねます。
  impact(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 低音の沈み込み（ドスッという芯）
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);

    // 接触の質感（短いノイズ）
    const noise = this.makeNoise(ctx, 1600, 3);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.12);
  }

  // フラググレネードの起爆音。低音の沈み込みと、こもった爆風ノイズを重ねます。
  playExplosion(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 低音の芯（ドゥンと沈む）
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.4);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.52);

    // 爆風のこもったノイズ（lowpassで丸める）
    const samples = Math.floor(ctx.sampleRate * 0.35);
    const noise = this.makeNoise(ctx, samples, 2);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    noise.connect(lp).connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.37);
  }

  // フラッシュバンの起爆音。鋭い破裂と、尾を引く高周波の耳鳴りを重ねます。
  playFlashbang(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    // 破裂（短く鋭いノイズ）
    const noise = this.makeNoise(ctx, 2000, 1.5);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.55, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    noise.connect(noiseGain).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.14);

    // 耳鳴り（高周波の固定音が尾を引く）
    const ring = ctx.createOscillator();
    ring.type = "sine";
    ring.frequency.setValueAtTime(3400, now);
    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0.18, now);
    ringGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    ring.connect(ringGain).connect(ctx.destination);
    ring.start(now);
    ring.stop(now + 1.42);
  }

  // 鈍い打撃音。周波数を変えて使い回します（ナイフ命中280、キック空振り160 など）。
  thud(freq: number): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.4, now + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }
}
