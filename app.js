'use strict';

// ─── Audio utilities ────────────────────────────────────────────────────────

function buildReverb(ac, secs = 3) {
  const conv = ac.createConvolver();
  const sr   = ac.sampleRate;
  const len  = Math.round(sr * secs);
  const buf  = ac.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let v = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      v = v * 0.90 + (Math.random() * 2 - 1) * 0.10;
      d[i] = v * Math.pow(1 - t, 2.4);
    }
  }
  conv.buffer = buf;
  return conv;
}

function buildNoiseBuffer(ac, type) {
  const sr  = ac.sampleRate;
  const len = sr * 10;
  const buf = ac.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  if (type === 'brown') {
    let v = 0;
    for (let i = 0; i < len; i++) {
      v = v * 0.99 + (Math.random() * 2 - 1) * 0.01;
      d[i] = v;
    }
  } else {  // pink (Voss-McCartney)
    const b = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b[0] = 0.99886 * b[0] + w * 0.0555179;
      b[1] = 0.99332 * b[1] + w * 0.0750759;
      b[2] = 0.96900 * b[2] + w * 0.1538520;
      b[3] = 0.86650 * b[3] + w * 0.3104856;
      b[4] = 0.55000 * b[4] + w * 0.5329522;
      b[5] = -0.7616  * b[5] - w * 0.0168980;
      d[i] = (b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+w*0.5362) * 0.08;
      b[6] = w * 0.115926;
    }
  }

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < len; i++) d[i] = d[i] / peak * 0.65;
  return buf;
}

// Additive synthesis plucked string — individual exponential decay per partial,
// inharmonicity (string stiffness), random phase per pluck.
function computeAdditiveBuffer(ac, freq, durationSec = 4.5) {
  const sr  = ac.sampleRate;
  const len = Math.round(sr * durationSec);
  const buf = ac.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  // [partial, relative amplitude, decay rate 1/sec]
  const partials = [
    [1, 0.55, 1.6 ],
    [2, 0.27, 3.2 ],
    [3, 0.13, 5.5 ],
    [4, 0.07, 8.0 ],
    [5, 0.035, 11.5],
    [6, 0.015, 15.5],
  ];

  const B  = 0.0003;  // inharmonicity coefficient
  const φ  = Math.random() * Math.PI * 2;
  // 5 ms linear fade-in prevents click from phase discontinuity at buffer start
  const fadeIn = Math.round(sr * 0.005);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    partials.forEach(([n, a, dc]) => {
      const f = freq * n * Math.sqrt(1 + B * n * n);
      if (f < sr * 0.45) {
        s += a * Math.exp(-dc * t) * Math.sin(2 * Math.PI * f * t + φ * n * 0.08);
      }
    });
    if (i < fadeIn) s *= i / fadeIn;  // smooth onset
    d[i] = s;
  }

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.01) {
    const fo = Math.min(sr * 0.35, len);
    for (let i = 0; i < len; i++) {
      d[i] = d[i] / peak * 0.7;
      if (i > len - fo) d[i] *= (len - i) / fo;
    }
  }
  return buf;
}

// ─── Presets ────────────────────────────────────────────────────────────────

const MOOD_LABELS = [
  { id: 'quiet-home', label: '家で静かに',               icon: '🏠', desc: '静かな空間でゆっくりと' },
  { id: 'noisy-out',  label: '外で騒がしい中で',          icon: '🌆', desc: 'ノイズをマスクして集中' },
  { id: 'transit',    label: '移動中に気分を落ち着かせたい', icon: '🚃', desc: '揺れの中でも穏やかに' },
  { id: 'hotel',      label: 'ホテルで自宅のように',        icon: '🏨', desc: '慣れない場所でリラックス' },
  { id: 'pre-game',   label: 'これから勝負の準備',          icon: '⚡', desc: '落ち着いた集中モードへ' },
];

const PRESETS = {
  meditation: [
    // 0: 家で静かに — 深い静寂: θ波 + 528Hz + 弦楽パッド + ハープ + ボウル
    {
      breathe: [
        { idx:0, min:0.44, max:0.58 },
        { idx:1, min:0.46, max:0.68 },
        { idx:2, min:0.42, max:0.65 },
        { idx:3, min:0.28, max:0.52 },
        { idx:4, min:0.36, max:0.60 },
      ],
      breatheInterval: 180,
      layers: [
        { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.52 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.60 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[261.63,329.63,392], vol:0.62 },
        { type:'harp',      name:'ハープ',                icon:'🪕',
          patterns:[
            [130.81, null, 196, null, 246.94],
            [null, 164.81, null, 196, null],
            [196, null, 246.94, null, 130.81],
            [null, 130.81, null, 164.81, null],
          ], bpm:20, startDelay:4, vol:0.46 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:24000, vol:0.56 },
      ]
    },
    // 1: 外で騒がしい中で — マスキング瞑想: θ波 + ブラウン + 弦楽パッド + ハープ + 528Hz
    {
      breathe: [
        { idx:0, min:0.46, max:0.62 },
        { idx:1, min:0.30, max:0.56 },
        { idx:2, min:0.40, max:0.62 },
        { idx:3, min:0.26, max:0.50 },
        { idx:4, min:0.42, max:0.62 },
      ],
      breatheInterval: 160,
      layers: [
        { type:'binaural',  name:'バイノーラル θ波 7Hz', icon:'〜', base:200, beat:7, vol:0.58 },
        { type:'noise',     name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.40 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[261.63,329.63,392], vol:0.58 },
        { type:'harp',      name:'ハープ',                icon:'🪕',
          patterns:[
            [130.81, 196, null, 246.94, null],
            [null, 164.81, 196, null, 130.81],
            [196, null, 246.94, 164.81, null],
            [130.81, null, 196, null, 246.94],
          ], bpm:22, startDelay:5, vol:0.42 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.52 },
      ]
    },
    // 2: 移動中に — ポータブル瞑想: θ波 + ブラウン + ハープ + 弦楽パッド + ボウル
    {
      breathe: [
        { idx:0, min:0.48, max:0.64 },
        { idx:1, min:0.26, max:0.50 },
        { idx:2, min:0.38, max:0.60 },
        { idx:3, min:0.38, max:0.60 },
        { idx:4, min:0.32, max:0.56 },
      ],
      breatheInterval: 150,
      layers: [
        { type:'binaural', name:'バイノーラル θ波 5Hz', icon:'〜', base:180, beat:5, vol:0.60 },
        { type:'noise',    name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.34 },
        { type:'harp',     name:'ハープ',                icon:'🪕',
          patterns:[
            [130.81, null, 196, null, null],
            [null, 164.81, null, 246.94, null],
            [196, null, null, 164.81, null],
            [null, 130.81, 196, null, 164.81],
          ], bpm:18, startDelay:3, vol:0.50 },
        { type:'pad',  name:'弦楽器パッド',  icon:'🎻', freqs:[261.63,329.63,392], vol:0.54 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:30000, vol:0.48 },
      ]
    },
    // 3: ホテルで自宅のように — 旅の瞑想: θ波 + 528Hz + 弦楽パッド + ハープ + 波
    {
      breathe: [
        { idx:0, min:0.40, max:0.56 },
        { idx:1, min:0.50, max:0.72 },
        { idx:2, min:0.52, max:0.74 },
        { idx:3, min:0.30, max:0.54 },
        { idx:4, min:0.18, max:0.40 },
      ],
      breatheInterval: 200,
      layers: [
        { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.50 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.64 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[261.63,329.63,392,523.25], vol:0.68 },
        { type:'harp',      name:'ハープ',                icon:'🪕',
          patterns:[
            [130.81, 164.81, 196, null, 246.94],
            [261.63, null, 196, 164.81, null],
            [130.81, null, 246.94, null, 196],
            [164.81, 196, null, 246.94, null],
          ], bpm:18, startDelay:5, vol:0.48 },
        { type:'ocean', name:'波の音', icon:'🌊', vol:0.30 },
      ]
    },
    // 4: 勝負の前 — 集中瞑想: θ高め + 弦楽パッド + ハープ + ボウル + 528Hz
    {
      breathe: [
        { idx:0, min:0.44, max:0.62 },
        { idx:1, min:0.44, max:0.64 },
        { idx:2, min:0.36, max:0.58 },
        { idx:3, min:0.34, max:0.56 },
        { idx:4, min:0.46, max:0.66 },
      ],
      breatheInterval: 165,
      layers: [
        { type:'binaural',  name:'バイノーラル θ波 8Hz', icon:'〜', base:220, beat:8, vol:0.55 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[261.63,329.63,392], vol:0.56 },
        { type:'harp',      name:'ハープ',                icon:'🪕',
          patterns:[
            [196, 246.94, 329.63, null, 392],
            [261.63, 329.63, null, 392, 329.63],
            [246.94, null, 329.63, 261.63, null],
            [196, 261.63, null, 329.63, null],
          ], bpm:26, startDelay:3, vol:0.50 },
        { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:18000, vol:0.50 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.58 },
      ]
    },
  ],

  sleep: [
    // 0: 家で静かに — 焚き火テーマ: fire + solfeggio + pad + harp
    {
      breathe: [
        { idx:0, min:0.36, max:0.54 },
        { idx:1, min:0.44, max:0.64 },
        { idx:2, min:0.38, max:0.58 },
        { idx:3, min:0.32, max:0.55 },
        { idx:4, min:0.22, max:0.46 },
      ],
      breatheInterval: 210,
      layers: [
        { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.50 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.58 },
        { type:'pad',       name:'弦楽器パッド',      icon:'🎻', freqs:[264,330,396], vol:0.56 },
        { type:'fire',      name:'焚き火',            icon:'🔥', vol:0.48 },
        { type:'harp',      name:'ハープ',            icon:'🪕',
          patterns:[
            [132, null, 176, null, null],
            [null, 198, null, 132, null],
            [176, null, null, 264, null],
            [132, null, 198, null, null],
          ], bpm:15, startDelay:7, vol:0.40 },
      ]
    },
    // 1: 外で騒がしい中で — 雨の夜テーマ: rain + stream + brown noise
    {
      breathe: [
        { idx:0, min:0.44, max:0.62 },
        { idx:1, min:0.50, max:0.72 },
        { idx:2, min:0.42, max:0.65 },
        { idx:3, min:0.28, max:0.50 },
        { idx:4, min:0.20, max:0.44 },
      ],
      breatheInterval: 165,
      layers: [
        { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.55 },
        { type:'rain',     name:'雨音',              icon:'🌧️', vol:0.55 },
        { type:'stream',   name:'川の流れ',           icon:'💧', vol:0.40 },
        { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.38 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [132, null, null, 176, null],
            [null, null, 198, null, null],
            [176, null, 132, null, null],
            [null, 198, null, null, 176],
          ], bpm:15, startDelay:10, vol:0.32 },
      ]
    },
    // 2: 移動中に — ミニマル雨テーマ: rain + brown noise
    {
      breathe: [
        { idx:0, min:0.48, max:0.65 },
        { idx:1, min:0.42, max:0.62 },
        { idx:2, min:0.36, max:0.56 },
      ],
      breatheInterval: 145,
      layers: [
        { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:1.5, driftDuration:3000, vol:0.58 },
        { type:'rain',     name:'雨音',              icon:'🌧️', vol:0.54 },
        { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.40 },
      ]
    },
    // 3: ホテルで自宅のように — 海辺の焚き火テーマ: fire + ocean + wind + solfeggio + pad + bowl
    {
      breathe: [
        { idx:0, min:0.36, max:0.54 },
        { idx:1, min:0.50, max:0.72 },
        { idx:2, min:0.46, max:0.68 },
        { idx:3, min:0.38, max:0.60 },
        { idx:4, min:0.28, max:0.50 },
        { idx:5, min:0.18, max:0.38 },
        { idx:6, min:0.20, max:0.44 },
      ],
      breatheInterval: 240,
      layers: [
        { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.48 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.64 },
        { type:'pad',       name:'弦楽器パッド',      icon:'🎻', freqs:[264,330,396,528], vol:0.62 },
        { type:'fire',      name:'焚き火',            icon:'🔥', vol:0.44 },
        { type:'ocean',     name:'波の音',            icon:'🌊', vol:0.34 },
        { type:'wind',      name:'風の音',            icon:'🍃', vol:0.20 },
        { type:'bowl',      name:'チベタンボウル',    icon:'🔔', interval:38000, vol:0.48 },
      ]
    },
    // 4: 勝負の前 — 森の川テーマ: stream + wind + pad + solfeggio + harp
    {
      breathe: [
        { idx:0, min:0.42, max:0.62 },
        { idx:1, min:0.50, max:0.70 },
        { idx:2, min:0.44, max:0.64 },
        { idx:3, min:0.28, max:0.52 },
        { idx:4, min:0.24, max:0.46 },
        { idx:5, min:0.26, max:0.50 },
      ],
      breatheInterval: 190,
      layers: [
        { type:'binaural',  name:'バイノーラル α→δ',  icon:'〜', base:264, beat:9, driftTo:2, driftDuration:2400, vol:0.52 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.60 },
        { type:'pad',       name:'弦楽器パッド',      icon:'🎻', freqs:[264,330,396], vol:0.54 },
        { type:'stream',    name:'川の流れ',           icon:'💧', vol:0.38 },
        { type:'wind',      name:'風の音',             icon:'🍃', vol:0.28 },
        { type:'harp',      name:'ハープ',            icon:'🪕',
          patterns:[
            [132, null, 198, null, null],
            [null, 176, null, null, 132],
            [264, null, null, 176, null],
            [null, 132, null, 198, null],
          ], bpm:15, startDelay:8, vol:0.38 },
      ]
    },
  ],

  focus: [
    // 0: 家で静かに — フロー状態: α波 + ピンク + 弦楽パッド + ハープ + 川の流れ
    {
      breathe: [
        { idx:0, min:0.42, max:0.58 },
        { idx:1, min:0.22, max:0.48 },
        { idx:2, min:0.44, max:0.66 },
        { idx:3, min:0.30, max:0.54 },
        { idx:4, min:0.16, max:0.38 },
      ],
      breatheInterval: 140,
      layers: [
        { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
        { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.32 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440], vol:0.60 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [146.83, 220, null, 293.66, null],
            [185, null, 220, null, 369.99],
            [293.66, 220, null, 185, 220],
            [null, 146.83, 220, null, 293.66],
          ], bpm:35, startDelay:3, vol:0.46 },
        { type:'stream', name:'川の流れ', icon:'💧', vol:0.28 },
      ]
    },
    // 1: 外で騒がしい中で — マスキング集中: α波 + ピンク + ブラウン + 弦楽パッド + ハープ
    {
      breathe: [
        { idx:0, min:0.46, max:0.62 },
        { idx:1, min:0.38, max:0.62 },
        { idx:2, min:0.28, max:0.52 },
        { idx:3, min:0.38, max:0.60 },
        { idx:4, min:0.26, max:0.48 },
      ],
      breatheInterval: 120,
      layers: [
        { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.55 },
        { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.48 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.35 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440], vol:0.54 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [146.83, null, 220, null, 293.66],
            [null, 185, null, 220, null],
            [220, null, 293.66, null, 185],
            [null, 146.83, null, 220, null],
          ], bpm:35, startDelay:4, vol:0.40 },
      ]
    },
    // 2: 移動中に — コンパクト集中: α高め + ピンク + ブラウン + 弦楽パッド + ハープ
    {
      breathe: [
        { idx:0, min:0.48, max:0.65 },
        { idx:1, min:0.36, max:0.60 },
        { idx:2, min:0.26, max:0.50 },
        { idx:3, min:0.40, max:0.62 },
        { idx:4, min:0.24, max:0.46 },
      ],
      breatheInterval: 110,
      layers: [
        { type:'binaural', name:'バイノーラル α波 12Hz', icon:'〜', base:200, beat:12, vol:0.58 },
        { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.46 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.30 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440], vol:0.54 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [146.83, 220, null, 293.66, null],
            [220, null, 293.66, null, 185],
            [null, 185, 220, null, 293.66],
            [293.66, null, 220, 146.83, null],
          ], bpm:30, startDelay:4, vol:0.38 },
      ]
    },
    // 3: ホテルで自宅のように — 深いフロー: α波 + ピンク + 弦楽パッド + ハープ + 川の流れ
    {
      breathe: [
        { idx:0, min:0.42, max:0.58 },
        { idx:1, min:0.20, max:0.42 },
        { idx:2, min:0.48, max:0.70 },
        { idx:3, min:0.32, max:0.56 },
        { idx:4, min:0.18, max:0.40 },
      ],
      breatheInterval: 150,
      layers: [
        { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
        { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.26 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440,587.33], vol:0.64 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [146.83, 220, 185, null, 293.66],
            [185, 220, null, 369.99, 293.66],
            [293.66, null, 220, 185, null],
            [null, 146.83, 220, null, 369.99],
          ], bpm:30, startDelay:4, vol:0.48 },
        { type:'stream', name:'川の流れ', icon:'💧', vol:0.26 },
      ]
    },
    // 4: 勝負の前 — ピークフォーカス: α→β + 弦楽パッド + ハープ + ピンク + ボウル
    {
      breathe: [
        { idx:0, min:0.46, max:0.64 },
        { idx:1, min:0.46, max:0.66 },
        { idx:2, min:0.38, max:0.60 },
        { idx:3, min:0.26, max:0.48 },
        { idx:4, min:0.30, max:0.54 },
      ],
      breatheInterval: 130,
      layers: [
        { type:'binaural', name:'バイノーラル α波 14Hz', icon:'〜', base:220, beat:14, vol:0.55 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440], vol:0.58 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [220, 293.66, 369.99, null, 440],
            [293.66, 369.99, null, 440, 369.99],
            [185, 220, 293.66, null, 369.99],
            [440, null, 369.99, 293.66, null],
          ], bpm:42, startDelay:2, vol:0.54 },
        { type:'noise', name:'ピンクノイズ', icon:'🌫️', noiseType:'pink', vol:0.32 },
        { type:'bowl',  name:'チベタンボウル', icon:'🔔', interval:20000, vol:0.48 },
      ]
    },
  ],
};

const TIMER_OPTIONS = {
  meditation: [{l:'なし',m:0},{l:'10分',m:10},{l:'20分',m:20},{l:'30分',m:30},{l:'60分',m:60}],
  sleep:      [{l:'なし',m:0},{l:'30分',m:30},{l:'1時間',m:60},{l:'90分',m:90},{l:'2時間',m:120},{l:'3時間',m:180},{l:'8時間',m:480}],
  focus:      [{l:'なし',m:0},{l:'25分',m:25},{l:'50分',m:50},{l:'90分',m:90}],
  morning:    [{l:'なし',m:0},{l:'15分',m:15},{l:'30分',m:30},{l:'60分',m:60}],
  ready:      [{l:'なし',m:0},{l:'10分',m:10},{l:'20分',m:20},{l:'30分',m:30}],
};

// A major (bright, uplifting): A3=220 C#4=277.18 E4=329.63 A4=440 C#5=554.37 E5=659.25
PRESETS.morning = [
  // 0: 家で静かに — やさしい目覚め: α→β + 弦楽パッド + ハープ + 小鳥 + 川の流れ
  {
    breathe: [
      { idx:0, min:0.40, max:0.56 },
      { idx:1, min:0.38, max:0.60 },
      { idx:2, min:0.36, max:0.58 },
      { idx:3, min:0.22, max:0.48 },
      { idx:4, min:0.18, max:0.40 },
    ],
    breatheInterval: 150,
    layers: [
      { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
      { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,277.18,329.63,440], vol:0.55 },
      { type:'harp',     name:'ハープ',            icon:'🪕',
        patterns:[
          [220, 277.18, null, 329.63, null],
          [null, 329.63, 440, null, 554.37],
          [277.18, null, 329.63, null, 440],
          [220, null, 277.18, 329.63, null],
        ], bpm:20, startDelay:4, vol:0.48 },
      { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.40 },
      { type:'stream', name:'川の流れ',       icon:'💧', vol:0.24 },
    ]
  },
  // 1: 外で騒がしい中で — ノイズマスク覚醒: α→β + ピンク + ハープ + 小鳥 + 弦楽パッド
  {
    breathe: [
      { idx:0, min:0.44, max:0.60 },
      { idx:1, min:0.30, max:0.54 },
      { idx:2, min:0.28, max:0.52 },
      { idx:3, min:0.18, max:0.40 },
      { idx:4, min:0.34, max:0.56 },
    ],
    breatheInterval: 130,
    layers: [
      { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.52 },
      { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.38 },
      { type:'harp',     name:'ハープ',            icon:'🪕',
        patterns:[
          [220, null, 329.63, null, 440],
          [277.18, 329.63, null, 440, null],
          [null, 220, 277.18, null, 329.63],
          [329.63, null, 440, 329.63, null],
        ], bpm:22, startDelay:4, vol:0.46 },
      { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.30 },
      { type:'pad',   name:'弦楽器パッド',   icon:'🎻', freqs:[220,277.18,329.63,440], vol:0.48 },
    ]
  },
  // 2: 移動中に — モバイル覚醒: α→β + ピンク + ハープ + 弦楽パッド + 川の流れ
  {
    breathe: [
      { idx:0, min:0.46, max:0.62 },
      { idx:1, min:0.28, max:0.52 },
      { idx:2, min:0.26, max:0.50 },
      { idx:3, min:0.36, max:0.58 },
      { idx:4, min:0.16, max:0.36 },
    ],
    breatheInterval: 120,
    layers: [
      { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.55 },
      { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.36 },
      { type:'harp',     name:'ハープ',            icon:'🪕',
        patterns:[
          [220, 329.63, null, 440, null],
          [277.18, null, 329.63, null, 554.37],
          [220, null, 277.18, 329.63, null],
          [329.63, 440, null, 329.63, null],
        ], bpm:22, startDelay:3, vol:0.48 },
      { type:'pad',    name:'弦楽器パッド', icon:'🎻', freqs:[220,277.18,329.63,440], vol:0.52 },
      { type:'stream', name:'川の流れ',     icon:'💧', vol:0.20 },
    ]
  },
  // 3: ホテルで自宅のように — 旅の目覚め: α→β + 弦楽パッド + ハープ + 小鳥 + 風の音
  {
    breathe: [
      { idx:0, min:0.38, max:0.54 },
      { idx:1, min:0.42, max:0.64 },
      { idx:2, min:0.34, max:0.56 },
      { idx:3, min:0.24, max:0.48 },
      { idx:4, min:0.16, max:0.36 },
    ],
    breatheInterval: 160,
    layers: [
      { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
      { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,277.18,329.63,440,554.37], vol:0.58 },
      { type:'harp',     name:'ハープ',            icon:'🪕',
        patterns:[
          [220, 277.18, 329.63, null, 440],
          [329.63, 440, null, 554.37, 440],
          [220, null, 329.63, 440, null],
          [277.18, 329.63, null, 440, null],
        ], bpm:18, startDelay:5, vol:0.50 },
      { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.36 },
      { type:'wind',  name:'風の音',         icon:'🍃', vol:0.18 },
    ]
  },
  // 4: これから勝負の準備 — 戦略的覚醒: α→β速め + 弦楽パッド + ハープ + 小鳥 + 川の流れ
  {
    breathe: [
      { idx:0, min:0.44, max:0.62 },
      { idx:1, min:0.46, max:0.66 },
      { idx:2, min:0.40, max:0.62 },
      { idx:3, min:0.26, max:0.50 },
      { idx:4, min:0.18, max:0.38 },
    ],
    breatheInterval: 110,
    layers: [
      { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:210, beat:10, driftTo:16, driftDuration:900, vol:0.52 },
      { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,329.63,440,554.37], vol:0.58 },
      { type:'harp',     name:'ハープ',            icon:'🪕',
        patterns:[
          [220, 329.63, 440, null, 554.37],
          [329.63, 440, 554.37, null, 659.25],
          [220, 277.18, 329.63, 440, null],
          [440, 554.37, null, 659.25, null],
        ], bpm:26, startDelay:3, vol:0.54 },
      { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.38 },
      { type:'stream', name:'川の流れ',       icon:'💧', vol:0.22 },
    ]
  },
];

// D major (energetic): D4=293.66 F#4=369.99 A4=440 D5=587.33 F#5=739.99 A5=880
PRESETS.ready = [
  // 0: 家で静かに — 朝の活力: β波 + 弦楽パッド + ハープ + ピンク + 小鳥
  {
    breathe: [
      { idx:0, min:0.44, max:0.60 },
      { idx:1, min:0.46, max:0.66 },
      { idx:2, min:0.40, max:0.62 },
      { idx:3, min:0.24, max:0.46 },
      { idx:4, min:0.20, max:0.44 },
    ],
    breatheInterval: 120,
    layers: [
      { type:'binaural', name:'バイノーラル β波 18Hz', icon:'〜', base:220, beat:18, vol:0.50 },
      { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440,587.33], vol:0.58 },
      { type:'harp',     name:'ハープ',                 icon:'🪕',
        patterns:[
          [293.66, 369.99, 440, null, 587.33],
          [440, 587.33, null, 440, 369.99],
          [293.66, null, 440, 587.33, null],
          [369.99, 440, null, 587.33, 440],
        ], bpm:58, startDelay:3, vol:0.52 },
      { type:'noise',  name:'ピンクノイズ',   icon:'🌫️', noiseType:'pink', vol:0.28 },
      { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.36 },
    ]
  },
  // 1: 外で騒がしい中で — マスキング活力: β波 + ピンク + ハープ + 弦楽パッド + 川の流れ
  {
    breathe: [
      { idx:0, min:0.48, max:0.64 },
      { idx:1, min:0.38, max:0.60 },
      { idx:2, min:0.36, max:0.58 },
      { idx:3, min:0.40, max:0.62 },
      { idx:4, min:0.18, max:0.38 },
    ],
    breatheInterval: 100,
    layers: [
      { type:'binaural', name:'バイノーラル β波 18Hz', icon:'〜', base:220, beat:18, vol:0.55 },
      { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.46 },
      { type:'harp',     name:'ハープ',                 icon:'🪕',
        patterns:[
          [293.66, 440, null, 587.33, null],
          [369.99, null, 440, 587.33, 440],
          [293.66, 369.99, null, 440, null],
          [440, 587.33, 440, null, 369.99],
        ], bpm:60, startDelay:3, vol:0.50 },
      { type:'pad',    name:'弦楽器パッド', icon:'🎻', freqs:[293.66,369.99,440,587.33], vol:0.52 },
      { type:'stream', name:'川の流れ',     icon:'💧', vol:0.22 },
    ]
  },
  // 2: 移動中に — モバイル活力: β高め + ピンク + ブラウン + ハープ + 弦楽パッド
  {
    breathe: [
      { idx:0, min:0.50, max:0.66 },
      { idx:1, min:0.36, max:0.58 },
      { idx:2, min:0.24, max:0.46 },
      { idx:3, min:0.36, max:0.58 },
      { idx:4, min:0.36, max:0.58 },
    ],
    breatheInterval: 90,
    layers: [
      { type:'binaural', name:'バイノーラル β波 20Hz', icon:'〜', base:220, beat:20, vol:0.58 },
      { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.44 },
      { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.30 },
      { type:'harp',     name:'ハープ',                 icon:'🪕',
        patterns:[
          [293.66, 440, 587.33, null, 440],
          [369.99, null, 440, 587.33, null],
          [293.66, 369.99, null, 587.33, null],
          [440, 587.33, null, 440, 369.99],
        ], bpm:62, startDelay:2, vol:0.52 },
      { type:'pad', name:'弦楽器パッド', icon:'🎻', freqs:[293.66,369.99,440,587.33], vol:0.52 },
    ]
  },
  // 3: ホテルで自宅のように — 旅の活力: β波 + 弦楽パッド + ハープ + ピンク + 風の音
  {
    breathe: [
      { idx:0, min:0.44, max:0.60 },
      { idx:1, min:0.50, max:0.70 },
      { idx:2, min:0.40, max:0.62 },
      { idx:3, min:0.22, max:0.44 },
      { idx:4, min:0.16, max:0.34 },
    ],
    breatheInterval: 115,
    layers: [
      { type:'binaural', name:'バイノーラル β波 18Hz', icon:'〜', base:220, beat:18, vol:0.50 },
      { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,369.99,440,587.33,739.99], vol:0.62 },
      { type:'harp',     name:'ハープ',                 icon:'🪕',
        patterns:[
          [440, 587.33, null, 739.99, 587.33],
          [293.66, 369.99, 440, null, 587.33],
          [587.33, null, 440, 369.99, null],
          [440, 739.99, null, 587.33, null],
        ], bpm:55, startDelay:3, vol:0.54 },
      { type:'noise', name:'ピンクノイズ', icon:'🌫️', noiseType:'pink', vol:0.26 },
      { type:'wind',  name:'風の音',       icon:'🍃', vol:0.20 },
    ]
  },
  // 4: これから勝負の準備 — ピーク活性: β高め + 弦楽パッド + ハープ + ピンク + 焚き火
  {
    breathe: [
      { idx:0, min:0.48, max:0.66 },
      { idx:1, min:0.52, max:0.72 },
      { idx:2, min:0.44, max:0.66 },
      { idx:3, min:0.26, max:0.48 },
      { idx:4, min:0.30, max:0.54 },
    ],
    breatheInterval: 85,
    layers: [
      { type:'binaural', name:'バイノーラル β波 22Hz', icon:'〜', base:220, beat:22, vol:0.55 },
      { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,440,587.33,739.99], vol:0.62 },
      { type:'harp',     name:'ハープ',                 icon:'🪕',
        patterns:[
          [293.66, 440, 587.33, 739.99, null],
          [440, 587.33, 739.99, null, 880],
          [293.66, 369.99, 440, 587.33, null],
          [587.33, 739.99, null, 880, 739.99],
        ], bpm:70, startDelay:2, vol:0.60 },
      { type:'noise', name:'ピンクノイズ', icon:'🌫️', noiseType:'pink', vol:0.30 },
      { type:'fire',  name:'焚き火',       icon:'🔥', vol:0.36 },
    ]
  },
];

// ─── Main App ───────────────────────────────────────────────────────────────

class HealingApp {
  constructor() {
    this.ac         = null;
    this.masterGain = null;
    this.dryBus     = null;
    this.reverbSend = null;
    this.reverb     = null;

    this.isPlaying     = false;
    this.currentCat    = null;
    this.currentMood   = null;
    this.layers        = [];
    this.schedulerTmrs = [];
    this.animFrame     = null;

    this.timerMins      = 0;
    this.timerRemaining = 0;
    this.timerInterval  = null;

    this.canvas = null;
    this.ctx    = null;
    this.t      = 0;

    this.bgCanvas    = null;
    this.bgCtx       = null;
    this.bgT         = 0;
    this.bgAnimFrame = null;

    this._audioEl = null;

    this._initUI();
    this._initBgCanvas();
  }

  // ── Nebula background (home / mood screens) ──────────────────────────────

  _initBgCanvas() {
    this.bgCanvas = document.getElementById('bg-canvas');
    this.bgCtx    = this.bgCanvas.getContext('2d');
    this._drawBgCanvas();
  }

  _drawBgCanvas() {
    const c   = this.bgCanvas;
    const ctx = this.bgCtx;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      c.width = c.clientWidth; c.height = c.clientHeight;
    }
    const W = c.width, H = c.height, t = this.bgT;

    ctx.fillStyle = '#050912';
    ctx.fillRect(0, 0, W, H);

    // Slow-drifting nebula blobs
    const blobs = [
      { cx:0.25, cy:0.35, r:0.60, rgb:[55,80,200],   a:0.048, sx:0.13, sy:0.10, sp:0.00022, ph:0.0 },
      { cx:0.75, cy:0.55, r:0.52, rgb:[90,50,180],   a:0.036, sx:0.11, sy:0.12, sp:0.00016, ph:2.1 },
      { cx:0.50, cy:0.12, r:0.46, rgb:[20,130,190],  a:0.026, sx:0.10, sy:0.09, sp:0.00019, ph:4.3 },
      { cx:0.15, cy:0.78, r:0.42, rgb:[70,50,190],   a:0.032, sx:0.08, sy:0.11, sp:0.00021, ph:1.2 },
      { cx:0.85, cy:0.20, r:0.38, rgb:[30,100,180],  a:0.020, sx:0.09, sy:0.08, sp:0.00017, ph:3.5 },
    ];

    blobs.forEach(b => {
      const x  = (b.cx + Math.sin(t * b.sp + b.ph) * b.sx) * W;
      const y  = (b.cy + Math.cos(t * b.sp * 0.71 + b.ph) * b.sy) * H;
      const r  = b.r * Math.max(W, H);
      const [r0,g0,bl0] = b.rgb;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0,   `rgba(${r0},${g0},${bl0},${b.a})`);
      gr.addColorStop(0.45,`rgba(${r0},${g0},${bl0},${b.a * 0.35})`);
      gr.addColorStop(1,   `rgba(${r0},${g0},${bl0},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    });

    // Subtle star field
    for (let i = 0; i < 42; i++) {
      const sx = ((Math.sin(i * 127.1) + 1) / 2) * W;
      const sy = ((Math.sin(i * 311.7) + 1) / 2) * H;
      const tw = 0.05 + 0.22 * Math.abs(Math.sin(t * 0.00035 + i * 2.3));
      ctx.fillStyle = `rgba(170,190,230,${tw})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 0.3 + 0.85 * Math.abs(Math.sin(i * 0.87)), 0, Math.PI * 2);
      ctx.fill();
    }

    this.bgT += 1;
    this.bgAnimFrame = requestAnimationFrame(() => this._drawBgCanvas());
  }

  _stopBgCanvas() {
    if (this.bgAnimFrame) { cancelAnimationFrame(this.bgAnimFrame); this.bgAnimFrame = null; }
  }

  _startBgCanvas() {
    if (!this.bgAnimFrame) this._drawBgCanvas();
  }

  // ── Audio graph (rebuilt fresh per session) ───────────────────────────────

  _initAudio() {
    this.ac = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ac.state === 'suspended') this.ac.resume();

    const comp = this.ac.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value      = 10;
    comp.ratio.value     = 8;
    comp.attack.value    = 0.002;
    comp.release.value   = 0.3;

    // iOS mute-switch bypass:
    // Routing Web Audio through MediaStreamDestination → <audio playsinline>
    // forces the iOS audio session into "playback" category, which ignores
    // the hardware mute switch. Direct ac.destination is used on other platforms.
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
    if (isIOS && typeof this.ac.createMediaStreamDestination === 'function') {
      try {
        const dest = this.ac.createMediaStreamDestination();
        comp.connect(dest);
        if (this._audioEl) { try { this._audioEl.pause(); this._audioEl.remove(); } catch (_) {} }
        const el = document.createElement('audio');
        el.setAttribute('playsinline', '');
        el.srcObject = dest.stream;
        el.play().catch(() => comp.connect(this.ac.destination));
        document.body.appendChild(el);
        this._audioEl = el;
      } catch (_) {
        comp.connect(this.ac.destination);
      }
    } else {
      comp.connect(this.ac.destination);
    }

    this.masterGain = this.ac.createGain();
    this.masterGain.gain.value = 0.75;
    this.masterGain.connect(comp);

    this.dryBus = this.ac.createGain();
    this.dryBus.connect(this.masterGain);

    this.reverb   = buildReverb(this.ac);
    const revWet  = this.ac.createGain();
    revWet.gain.value = 0.25;
    this.reverb.connect(revWet);
    revWet.connect(this.masterGain);

    this.reverbSend = this.ac.createGain();
    this.reverbSend.connect(this.reverb);
  }

  // ── Sound generators ──────────────────────────────────────────────────────

  _makeBinauralBeat(baseFreq, beatFreq) {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);

    const merger = ac.createChannelMerger(2);
    merger.connect(gainNode);

    let rightOsc = null;
    [[baseFreq, 0], [baseFreq + beatFreq, 1]].forEach(([freq, ch]) => {
      const osc = ac.createOscillator();
      const g   = ac.createGain();
      osc.type  = 'sine';
      osc.frequency.value = freq;
      g.gain.value = 0.12;
      osc.connect(g);
      g.connect(merger, 0, ch);
      osc.start();
      if (ch === 1) rightOsc = osc;
    });

    return { gainNode, rightOsc };
  }

  _makeNoise(type) {
    const ac  = this.ac;
    const src = ac.createBufferSource();
    src.buffer = buildNoiseBuffer(ac, type);
    src.loop   = true;

    const lpf = ac.createBiquadFilter();
    lpf.type  = 'lowpass';
    lpf.frequency.value = type === 'pink' ? 1400 : 700;
    lpf.Q.value = 0.4;

    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);

    src.connect(lpf);
    lpf.connect(gainNode);
    src.start();

    return { gainNode, nodes: [src] };
  }

  // Rain: three bandpass noise layers (large/medium/fine drops) with slow intensity LFO
  _makeRain() {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);

    const nodes = [];
    [
      { hpf:  80, lpf:  450, vol: 0.52 },
      { hpf: 500, lpf: 2000, vol: 0.30 },
      { hpf:2200, lpf: 5500, vol: 0.18 },
    ].forEach(({ hpf, lpf, vol }) => {
      const src = ac.createBufferSource();
      src.buffer = buildNoiseBuffer(ac, 'pink');
      src.loop   = true;

      const hp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = hpf; hp.Q.value = 0.5;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';  lp.frequency.value = lpf; lp.Q.value = 0.4;

      // Very slow LFO — drizzle vs brief heavier moments
      const lfo  = ac.createOscillator();
      const lfoG = ac.createGain();
      lfo.frequency.value = 0.03 + Math.random() * 0.05;
      lfoG.gain.value     = vol * 0.22;

      const g = ac.createGain();
      g.gain.value = vol * 0.78;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      src.connect(hp); hp.connect(lp); lp.connect(g);
      g.connect(gainNode);
      src.start(); lfo.start();
      nodes.push(src, lfo);
    });

    return { gainNode, nodes };
  }

  // Ocean: brown noise with two overlapping wave LFOs for organic irregularity
  _makeOcean() {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const src = ac.createBufferSource();
    src.buffer = buildNoiseBuffer(ac, 'brown');
    src.loop   = true;

    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 480; lp.Q.value = 0.35;

    // Primary wave (~9–14s period) + secondary modulation (~22–32s) = irregular feel
    const w1 = ac.createOscillator(), w1G = ac.createGain();
    w1.frequency.value = 0.08 + Math.random() * 0.04;
    w1G.gain.value     = 0.30;
    w1.connect(w1G);

    const w2 = ac.createOscillator(), w2G = ac.createGain();
    w2.frequency.value = 0.033 + Math.random() * 0.018;
    w2G.gain.value     = 0.14;
    w2.connect(w2G);

    const amp = ac.createGain();
    amp.gain.value = 0.56;
    w1G.connect(amp.gain);
    w2G.connect(amp.gain);

    src.connect(lp); lp.connect(amp); amp.connect(gainNode);
    src.start(); w1.start(); w2.start();

    return { gainNode, nodes: [src, w1, w2] };
  }

  // Fire: almost-silent warmth base + realistic individual crackle/pop events
  _makeFire() {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];

    // Barely-there warmth hum — heat convection, very quiet
    const src  = ac.createBufferSource();
    src.buffer = buildNoiseBuffer(ac, 'brown');
    src.loop   = true;
    const lp   = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 130; lp.Q.value = 0.4;
    const baseG = ac.createGain();
    baseG.gain.value = 0.055;
    src.connect(lp); lp.connect(baseG); baseG.connect(gainNode);
    src.start(); nodes.push(src);

    // Single pop/crack event — wood fiber bursting under heat
    const firePop = (when, ampScale = 1.0) => {
      const sr  = ac.sampleRate;
      const dur = 0.016 + Math.random() * 0.048;
      const len = Math.round(sr * dur);
      const buf = ac.createBuffer(1, len, sr);
      const d   = buf.getChannelData(0);
      // 1ms attack → sharp transient, then exponential decay
      const atk = Math.round(sr * 0.001);
      for (let i = 0; i < len; i++) {
        const env = (i < atk ? i / atk : 1) * Math.exp(-i / (len * 0.16));
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const popSrc = ac.createBufferSource();
      popSrc.buffer = buf;
      // High-pass shapes the "crack" character; LP removes ultra-harsh digitals
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 900 + Math.random() * 2000;
      const lp2 = ac.createBiquadFilter();
      lp2.type = 'lowpass'; lp2.frequency.value = 8000;
      const g = ac.createGain();
      g.gain.setValueAtTime((0.30 + Math.random() * 0.45) * ampScale, when);
      popSrc.connect(hp); hp.connect(lp2); lp2.connect(g);
      g.connect(gainNode);
      popSrc.start(when);
    };

    // Event scheduler: single pop / doublet / micro-burst, with 1-6s gaps
    const schedule = () => {
      if (!this.isPlaying) return;
      const now = ac.currentTime;
      const r   = Math.random();

      if (r < 0.44) {
        firePop(now);                                           // single crack
      } else if (r < 0.70) {
        firePop(now);                                           // wood-split doublet
        firePop(now + 0.045 + Math.random() * 0.075);
      } else {
        const n = 3 + Math.floor(Math.random() * 4);           // sap-bubble burst
        for (let i = 0; i < n; i++)
          firePop(now + i * (0.009 + Math.random() * 0.016), 0.50);
      }

      this.schedulerTmrs.push(setTimeout(schedule, 1100 + Math.random() * 5200));
    };
    this.schedulerTmrs.push(setTimeout(schedule, 700 + Math.random() * 1800));

    return { gainNode, nodes };
  }

  // Wind: pink noise through bandpass with slow filter + amplitude LFOs for gusting
  _makeWind() {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);

    const src = ac.createBufferSource();
    src.buffer = buildNoiseBuffer(ac, 'pink');
    src.loop   = true;

    const hp = ac.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 100; hp.Q.value = 0.5;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 340; bp.Q.value = 1.2;

    // LFO modulates filter pitch (wind character variation)
    const fLfo  = ac.createOscillator();
    const fLfoG = ac.createGain();
    fLfo.frequency.value = 0.028 + Math.random() * 0.045;
    fLfoG.gain.value     = 200;
    fLfo.connect(fLfoG);
    fLfoG.connect(bp.frequency);

    // LFO modulates amplitude (gust surges)
    const aLfo  = ac.createOscillator();
    const aLfoG = ac.createGain();
    aLfo.frequency.value = 0.018 + Math.random() * 0.032;
    aLfoG.gain.value     = 0.28;
    const amp = ac.createGain();
    amp.gain.value = 0.72;
    aLfo.connect(aLfoG);
    aLfoG.connect(amp.gain);

    src.connect(hp); hp.connect(bp); bp.connect(amp); amp.connect(gainNode);
    src.start(); fLfo.start(); aLfo.start();

    return { gainNode, nodes: [src, fLfo, aLfo] };
  }

  // Stream: layered filtered noise with faster LFO for babbling-brook feel
  _makeStream() {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];
    [
      { type: 'pink',  hp: 380, lp: 3200, vol: 0.54, lfoHz: 0.20 },
      { type: 'brown', hp:  65, lp:  500, vol: 0.40, lfoHz: 0.10 },
    ].forEach(({ type, hp, lp, vol, lfoHz }) => {
      const src = ac.createBufferSource();
      src.buffer = buildNoiseBuffer(ac, type);
      src.loop   = true;

      const hpf = ac.createBiquadFilter();
      hpf.type = 'highpass'; hpf.frequency.value = hp; hpf.Q.value = 0.55;
      const lpf = ac.createBiquadFilter();
      lpf.type = 'lowpass';  lpf.frequency.value = lp; lpf.Q.value = 0.40;

      const lfo  = ac.createOscillator();
      const lfoG = ac.createGain();
      lfo.frequency.value = lfoHz + Math.random() * lfoHz;
      lfoG.gain.value     = vol * 0.22;

      const g = ac.createGain();
      g.gain.value = vol * 0.78;
      lfo.connect(lfoG);
      lfoG.connect(g.gain);
      src.connect(hpf); hpf.connect(lpf); lpf.connect(g);
      g.connect(gainNode);
      src.start(); lfo.start();
      nodes.push(src, lfo);
    });

    return { gainNode, nodes };
  }

  // Bird: single chirp — ascending frequency sweep with fast decay
  _makeBirdChirp(destGain, baseFreq) {
    const ac  = this.ac;
    const now = ac.currentTime;
    const dur = 0.10 + Math.random() * 0.12;
    const f1  = baseFreq * (0.85 + Math.random() * 0.30);
    const f2  = f1 * (1.30 + Math.random() * 0.50);

    const osc = ac.createOscillator();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(f1, now);
    osc.frequency.linearRampToValueAtTime(f2, now + dur * 0.65);
    osc.frequency.linearRampToValueAtTime(f2 * 0.93, now + dur);

    const env = ac.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.16 + Math.random() * 0.10, now + 0.012);
    env.gain.setTargetAtTime(0, now + dur * 0.35, 0.038);

    osc.connect(env);
    env.connect(destGain);
    env.connect(this.reverbSend);
    osc.start(now);
    osc.stop(now + dur + 0.18);
  }

  // Randomly schedules clusters of 1-4 chirps every 8-28 s
  _scheduleBirds(destGain) {
    const baseFreqs = [2200, 2800, 3400, 2500, 3100];
    const scheduleCluster = () => {
      if (!this.isPlaying) return;
      const count = 1 + Math.floor(Math.random() * 4);
      const baseF = baseFreqs[Math.floor(Math.random() * baseFreqs.length)];
      for (let i = 0; i < count; i++) {
        const delayMs = i * (60 + Math.random() * 180);
        this.schedulerTmrs.push(setTimeout(() => {
          if (!this.isPlaying) return;
          this._makeBirdChirp(destGain, baseF * (0.90 + Math.random() * 0.20));
        }, delayMs));
      }
      const nextMs = (8 + Math.random() * 20) * 1000;
      this.schedulerTmrs.push(setTimeout(scheduleCluster, nextMs));
    };
    this.schedulerTmrs.push(setTimeout(scheduleCluster, (3 + Math.random() * 5) * 1000));
  }

  _makeStringPad(freqs) {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];
    freqs.forEach(freq => {
      [-4, 4].forEach(det => {
        const osc = ac.createOscillator();
        osc.type  = 'sine';
        osc.frequency.value = freq;
        osc.detune.value    = det;

        const lfo  = ac.createOscillator();
        const lfoG = ac.createGain();
        lfo.frequency.value = 4.6 + Math.random() * 0.8;
        lfoG.gain.value     = 4;
        lfo.connect(lfoG);
        lfoG.connect(osc.detune);

        const env = ac.createGain();
        env.gain.setValueAtTime(0, ac.currentTime);
        env.gain.linearRampToValueAtTime(0.14, ac.currentTime + 5);

        osc.connect(env);
        env.connect(gainNode);
        osc.start(); lfo.start();
        nodes.push(osc, lfo);
      });
    });

    return { gainNode, nodes };
  }

  _makeSolfeggio528() {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];
    [{ f: 132, a: 0.16 }, { f: 264, a: 0.11 }, { f: 528, a: 0.06 }].forEach(({ f, a }) => {
      const osc = ac.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = f;

      const trLFO  = ac.createOscillator();
      const trGain = ac.createGain();
      trLFO.frequency.value = 0.1;
      trGain.gain.value     = 0.018;
      trLFO.connect(trGain);

      const env = ac.createGain();
      env.gain.setValueAtTime(0, ac.currentTime);
      env.gain.linearRampToValueAtTime(a, ac.currentTime + 6);
      trGain.connect(env.gain);

      osc.connect(env);
      env.connect(gainNode);
      osc.start(); trLFO.start();
      nodes.push(osc, trLFO);
    });

    return { gainNode, nodes };
  }

  _makeTibetanBowl(destGain) {
    const ac  = this.ac;
    const now = ac.currentTime;
    [1, 1.74, 2.76].forEach((r, i) => {
      const osc = ac.createOscillator();
      osc.type  = 'sine';
      osc.frequency.value = 432 * r;
      const env = ac.createGain();
      const amp = 0.16 * Math.pow(0.42, i);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(amp, now + 0.4);
      env.gain.setTargetAtTime(0.0001, now + 1.5, 2.8);
      osc.connect(env);
      env.connect(destGain);
      env.connect(this.reverbSend);
      osc.start(now);
      osc.stop(now + 16);
    });
  }

  _scheduleBowl(destGain, intervalMs) {
    const ring = () => {
      if (!this.isPlaying) return;
      this._makeTibetanBowl(destGain);
      // ±25% jitter — like a human hand, never perfectly metronomic
      const jitter = intervalMs * 0.25 * (Math.random() * 2 - 1);
      this.schedulerTmrs.push(setTimeout(ring, intervalMs + jitter));
    };
    // Stagger first ring so it doesn't coincide with fade-in
    this.schedulerTmrs.push(setTimeout(ring, intervalMs * (0.4 + Math.random() * 0.4)));
  }

  // Harp arpeggiator: multi-pattern rotation, velocity variation,
  // 10% chance of a silent "breath" after each pattern for organic feel
  _schedulePatternArp(patterns, bpm, destGain, startDelaySec = 3) {
    const beatMs = (60 / bpm) * 1000;
    const maxLen = Math.max(...patterns.map(p => p.length));
    const REST   = Array(maxLen).fill(null);  // silent breath pattern

    let patIdx = 0, noteIdx = 0, curPat = patterns[0];

    const tick = () => {
      if (!this.isPlaying) return;

      const freq = curPat[noteIdx];
      if (freq) {
        const velocity = 0.52 + Math.random() * 0.42;
        const buf = computeAdditiveBuffer(this.ac, freq, 4.5);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const g   = this.ac.createGain();
        const now = this.ac.currentTime;
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(velocity, now + 0.006); // 6 ms attack ramp
        src.connect(g);
        g.connect(destGain);
        g.connect(this.reverbSend);
        src.start();
        src.onended = () => { try { g.disconnect(); } catch (_) {} };
      }

      noteIdx++;
      if (noteIdx >= curPat.length) {
        noteIdx = 0;
        // 10% chance of a silent breath after a real pattern
        if (curPat !== REST && Math.random() < 0.10) {
          curPat = REST;
        } else {
          if (patterns.length > 1) {
            let next;
            do { next = Math.floor(Math.random() * patterns.length); } while (next === patIdx);
            patIdx = next;
          }
          curPat = patterns[patIdx];
        }
      }

      const jitter = beatMs * 0.035 * (Math.random() - 0.5);
      this.schedulerTmrs.push(setTimeout(tick, beatMs + jitter));
    };

    this.schedulerTmrs.push(setTimeout(tick, startDelaySec * 1000));
  }

  // ── Category start ────────────────────────────────────────────────────────

  _startCategory(cat, moodId) {
    this._initAudio();
    this.isPlaying   = true;
    this.currentCat  = cat;
    this.currentMood = moodId;

    const preset = PRESETS[cat][moodId];
    this.layers = [];

    preset.layers.forEach(def => {
      switch (def.type) {
        case 'binaural': {
          const b = this._makeBinauralBeat(def.base, def.beat);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: b.gainNode, nodes: [], defaultVol: def.vol });
          // Frequency drift: slowly deepen the beat frequency over driftDuration seconds
          if (def.driftTo != null && b.rightOsc) {
            b.rightOsc.frequency.setValueAtTime(def.base + def.beat, this.ac.currentTime);
            b.rightOsc.frequency.linearRampToValueAtTime(
              def.base + def.driftTo,
              this.ac.currentTime + (def.driftDuration || 1800)
            );
          }
          break;
        }
        case 'noise': {
          const n = this._makeNoise(def.noiseType);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: n.gainNode, nodes: n.nodes, defaultVol: def.vol });
          break;
        }
        case 'pad': {
          const p = this._makeStringPad(def.freqs);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: p.gainNode, nodes: p.nodes, defaultVol: def.vol });
          break;
        }
        case 'solfeggio': {
          const s = this._makeSolfeggio528();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: s.gainNode, nodes: s.nodes, defaultVol: def.vol });
          break;
        }
        case 'harp': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._schedulePatternArp(def.patterns, def.bpm, g, def.startDelay);
          break;
        }
        case 'bowl': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._scheduleBowl(g, def.interval);
          break;
        }
        case 'rain': {
          const r = this._makeRain();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: r.gainNode, nodes: r.nodes, defaultVol: def.vol });
          break;
        }
        case 'ocean': {
          const o = this._makeOcean();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: o.gainNode, nodes: o.nodes, defaultVol: def.vol });
          break;
        }
        case 'fire': {
          const fi = this._makeFire();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: fi.gainNode, nodes: fi.nodes, defaultVol: def.vol });
          break;
        }
        case 'wind': {
          const w = this._makeWind();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: w.gainNode, nodes: w.nodes, defaultVol: def.vol });
          break;
        }
        case 'stream': {
          const st = this._makeStream();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: st.gainNode, nodes: st.nodes, defaultVol: def.vol });
          break;
        }
        case 'birds': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._scheduleBirds(g);
          break;
        }
      }
    });

    this.layers.forEach(l => {
      l.gainNode.gain.cancelScheduledValues(this.ac.currentTime);
      l.gainNode.gain.setValueAtTime(0, this.ac.currentTime);
      l.gainNode.gain.linearRampToValueAtTime(l.defaultVol, this.ac.currentTime + 3.5);
    });

    // Start organic volume breathing if preset defines it
    if (preset.breathe) {
      this._startVolumeBreathing(preset.breathe, preset.breatheInterval || 180);
    }

    this._renderLayers();
    this._updatePlayBtn(true);
    this._startVisuals(cat);
  }

  // ── Volume breathing: each layer slowly wanders between its min/max ────────
  // Next trigger is 60–140% of baseInterval so it never feels mechanical.

  _startVolumeBreathing(breatheConfigs, baseIntervalSec) {
    const step = () => {
      if (!this.isPlaying) return;
      breatheConfigs.forEach(({ idx, min, max }) => {
        const layer = this.layers[idx];
        if (!layer) return;
        const target  = min + Math.random() * (max - min);
        const fadeSec = 22 + Math.random() * 52;
        const now = this.ac.currentTime;
        layer.gainNode.gain.cancelScheduledValues(now);
        layer.gainNode.gain.setValueAtTime(layer.gainNode.gain.value, now);
        layer.gainNode.gain.linearRampToValueAtTime(target, now + fadeSec);
      });
      const next = baseIntervalSec * (0.6 + Math.random() * 0.8);
      this.schedulerTmrs.push(setTimeout(step, next * 1000));
    };
    const firstDelay = baseIntervalSec * (0.7 + Math.random() * 0.6);
    this.schedulerTmrs.push(setTimeout(step, firstDelay * 1000));
  }

  // ── Timer buttons (category-specific options) ─────────────────────────────

  _renderTimerBtns(cat) {
    const container = document.querySelector('.timer-btns');
    container.innerHTML = '';
    (TIMER_OPTIONS[cat] || TIMER_OPTIONS.meditation).forEach(({ l, m }) => {
      const btn = document.createElement('button');
      btn.className = 'timer-btn' + (m === 0 ? ' active' : '');
      btn.dataset.mins = m;
      btn.textContent  = l;
      btn.addEventListener('click', () => this._setTimer(m));
      container.appendChild(btn);
    });
    this.timerMins = 0;
    document.getElementById('timer-display').textContent = '--:--';
  }

  // ── Playback control ──────────────────────────────────────────────────────

  _pause() {
    this.isPlaying = false;
    this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.8);
    this._updatePlayBtn(false);
  }

  _resume() {
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    this.isPlaying = true;
    const vol = document.getElementById('master-vol').value / 100;
    this.masterGain.gain.setTargetAtTime(vol, this.ac.currentTime, 0.5);
    this._updatePlayBtn(true);
  }

  _stopAll() {
    this.isPlaying = false;

    this.schedulerTmrs.forEach(clearTimeout);
    this.schedulerTmrs = [];

    this.layers.forEach(l => {
      l.nodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (_) {} });
      try { l.gainNode.disconnect(); } catch (_) {}
    });
    this.layers = [];

    this._stopTimer();
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this.currentCat  = null;
    this.currentMood = null;
  }

  _closeAudio() {
    if (this._audioEl) {
      try { this._audioEl.pause(); this._audioEl.remove(); } catch (_) {}
      this._audioEl = null;
    }
    if (this.ac) {
      try { this.ac.close(); } catch (_) {}
      this.ac = null;
      this.masterGain = this.dryBus = this.reverbSend = this.reverb = null;
    }
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  _setTimer(mins) {
    this._stopTimer();
    this.timerMins = mins;
    document.querySelectorAll('.timer-btn').forEach(b =>
      b.classList.toggle('active', +b.dataset.mins === mins));

    if (mins === 0) { document.getElementById('timer-display').textContent = '--:--'; return; }
    this.timerRemaining = mins * 60;
    this._updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      this.timerRemaining--;
      this._updateTimerDisplay();
      if (this.timerRemaining <= 0) {
        this._stopTimer();
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 3);
        setTimeout(() => { this._stopAll(); this._showHome(); }, 10000);
      } else if (this.timerRemaining <= 90 && this.masterGain) {
        const vol = document.getElementById('master-vol').value / 100;
        this.masterGain.gain.setTargetAtTime(vol * (this.timerRemaining / 90), this.ac.currentTime, 5);
      }
    }, 1000);
  }

  _stopTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  _updateTimerDisplay() {
    const m = Math.floor(this.timerRemaining / 60);
    const s = this.timerRemaining % 60;
    document.getElementById('timer-display').textContent =
      `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  // ── Layer UI ──────────────────────────────────────────────────────────────

  _renderLayers() {
    const container = document.getElementById('layers-container');
    container.innerHTML = '';
    this.layers.forEach((layer, idx) => {
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <button class="layer-toggle on" data-idx="${idx}">${layer.icon}</button>
        <span class="layer-name">${layer.name}</span>
        <input type="range" class="layer-slider" min="0" max="100"
          value="${Math.round(layer.defaultVol * 100)}" data-idx="${idx}">
      `;
      row.querySelector('.layer-slider').addEventListener('input', e => {
        const l = this.layers[+e.target.dataset.idx];
        if (!l) return;
        l.gainNode.gain.cancelScheduledValues(this.ac.currentTime);
        l.gainNode.gain.setTargetAtTime(+e.target.value / 100, this.ac.currentTime, 0.1);
      });
      row.querySelector('.layer-toggle').addEventListener('click', e => {
        const btn = e.currentTarget;
        btn.classList.toggle('on');
        const l   = this.layers[+btn.dataset.idx];
        if (!l) return;
        const vol = btn.classList.contains('on')
          ? row.querySelector('.layer-slider').value / 100 : 0;
        l.gainNode.gain.setTargetAtTime(vol, this.ac.currentTime, 0.4);
      });
      container.appendChild(row);
    });
  }

  // ── Visual Engine ─────────────────────────────────────────────────────────

  _startVisuals(cat) {
    this.canvas = document.getElementById('canvas');
    this.ctx    = this.canvas.getContext('2d');
    this.t      = 0;
    const render = () => {
      this.t += 0.016;
      const c = this.canvas;
      if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
        c.width = c.clientWidth; c.height = c.clientHeight;
      }
      if      (cat === 'meditation') this._drawMeditation();
      else if (cat === 'sleep')      this._drawSleep();
      else if (cat === 'morning')    this._drawMorning();
      else if (cat === 'ready')      this._drawReady();
      else                           this._drawFocus();
      this.animFrame = requestAnimationFrame(render);
    };
    render();
  }

  _drawMeditation() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.40;

    ctx.fillStyle = '#070412'; ctx.fillRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.65);
    bg.addColorStop(0, 'rgba(109,40,217,0.22)');
    bg.addColorStop(0.55, 'rgba(79,70,229,0.08)');
    bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const ph = (t % 16) / 16;
    let ratio, label;
    if      (ph < 0.25) { ratio = ph / 0.25;              label = '吸　う'; }
    else if (ph < 0.5)  { ratio = 1;                      label = '保　つ'; }
    else if (ph < 0.75) { ratio = 1 - (ph - 0.5) / 0.25; label = '吐　く'; }
    else                { ratio = 0;                      label = '　　…'; }

    const minR = Math.min(W, H) * 0.10;
    const maxR = Math.min(W, H) * 0.26;
    const r    = minR + (maxR - minR) * ratio;

    for (let i = 3; i >= 1; i--) {
      const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * (1 + i * 0.55));
      g.addColorStop(0, `rgba(139,92,246,${0.12/i})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * (1 + i * 0.55), 0, Math.PI * 2); ctx.fill();
    }

    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0, 'rgba(216,180,254,0.55)');
    cg.addColorStop(0.6, 'rgba(139,92,246,0.25)');
    cg.addColorStop(1, 'rgba(79,70,229,0.04)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(216,180,254,${0.3 + ratio * 0.35})`;
    ctx.lineWidth = 1.5; ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = `${Math.round(Math.min(W,H) * 0.042)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);

    for (let i = 0; i < 30; i++) {
      const s  = i * 137.51;
      const px = cx + Math.cos(s) * W * 0.34 + Math.sin(t * 0.25 + s * 0.9) * 20;
      const py = cy + Math.sin(s * 0.7) * H * 0.28 + Math.cos(t * 0.18 + s * 1.2) * 16;
      const a  = 0.2 + 0.5 * Math.abs(Math.sin(t * 0.4 + s));
      ctx.fillStyle = `rgba(221,214,254,${a})`;
      ctx.beginPath(); ctx.arc(px, py, 0.8 + 2 * Math.abs(Math.sin(s * 0.3)), 0, Math.PI * 2); ctx.fill();
    }
  }

  _drawSleep() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#010a18'); bg.addColorStop(0.5, '#040d1e'); bg.addColorStop(1, '#071428');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const spulse = 0.5 + 0.5 * Math.sin(t * 0.8);
    const cx = W * 0.5, cy = H * 0.4;
    const sr = Math.min(W, H) * (0.08 + 0.04 * spulse);
    const sG = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr * 3);
    sG.addColorStop(0, `rgba(100, 210, 200, ${0.18 + 0.08 * spulse})`);
    sG.addColorStop(1, 'transparent');
    ctx.fillStyle = sG; ctx.beginPath(); ctx.arc(cx, cy, sr * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(150, 240, 230, ${0.5 + 0.3 * spulse})`;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();

    ctx.save(); ctx.globalAlpha = 0.10;
    [[30,64,175],[4,100,80],[79,70,229]].forEach(([r,g,b], i) => {
      const wv = H * 0.28;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let x = 0; x <= W; x += 4)
        ctx.lineTo(x, wv * 0.5 * (1 + Math.sin(x / W * Math.PI * 3 + t * 0.04 + i * 2.1)));
      ctx.lineTo(W, 0); ctx.closePath(); ctx.fill();
    });
    ctx.restore();

    for (let i = 0; i < 90; i++) {
      const s  = i * 137.51;
      const sx = ((Math.sin(s * 0.11) + 1) / 2) * W;
      const sy = ((Math.sin(s * 0.073) + 1) / 2) * H * 0.72;
      const tw = 0.25 + 0.75 * Math.abs(Math.sin(t * 0.45 + s));
      ctx.fillStyle = `rgba(200,220,255,${tw})`;
      ctx.beginPath(); ctx.arc(sx, sy, 0.4 + 1.6 * Math.abs(Math.sin(s * 0.29)), 0, Math.PI * 2); ctx.fill();
    }

    const mx = W * 0.74, my = H * 0.18, mr = Math.min(W,H) * 0.066;
    const mG = ctx.createRadialGradient(mx - mr*0.2, my - mr*0.2, 0, mx, my, mr);
    mG.addColorStop(0, 'rgba(245,235,210,0.92)'); mG.addColorStop(1, 'rgba(210,200,170,0)');
    ctx.fillStyle = mG; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    const mhG = ctx.createRadialGradient(mx, my, mr, mx, my, mr * 2.8);
    mhG.addColorStop(0, 'rgba(210,195,155,0.10)'); mhG.addColorStop(1, 'transparent');
    ctx.fillStyle = mhG; ctx.beginPath(); ctx.arc(mx, my, mr * 2.8, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(150,240,230,0.45)';
    ctx.font = `${Math.round(Math.min(W,H) * 0.028)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('528 Hz', cx, cy + Math.min(W,H) * 0.13);

    const baseY = H * 0.84;
    for (let w = 0; w < 4; w++) {
      ctx.strokeStyle = `rgba(30,80,180,${0.22 - w * 0.04})`;
      ctx.lineWidth = 1.2; ctx.beginPath();
      ctx.moveTo(0, baseY + w * 14);
      for (let x = 0; x <= W; x += 3)
        ctx.lineTo(x, baseY + w * 14 + Math.sin(x / W * Math.PI * 4 + t * 0.4 + w * 0.8) * 7);
      ctx.stroke();
    }
  }

  _drawFocus() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.40;

    ctx.fillStyle = '#020d0a'; ctx.fillRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.5);
    bg.addColorStop(0, 'rgba(4,120,87,0.14)'); bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const R   = Math.min(W, H) * 0.18;
    const rot = t * 0.04;
    const centers = [[0, 0]];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + rot;
      centers.push([Math.cos(a) * R, Math.sin(a) * R]);
    }

    ctx.strokeStyle = 'rgba(52,211,153,0.18)'; ctx.lineWidth = 0.9;
    centers.forEach(([x,y]) => { ctx.beginPath(); ctx.arc(cx+x, cy+y, R, 0, Math.PI*2); ctx.stroke(); });

    ctx.strokeStyle = 'rgba(52,211,153,0.07)';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6 + rot * 0.5;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a)*R*2, cy + Math.sin(a)*R*2, R, 0, Math.PI*2); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(52,211,153,0.10)'; ctx.lineWidth = 0.6;
    for (let i = 0; i < centers.length; i++)
      for (let j = i+1; j < centers.length; j++) {
        ctx.beginPath();
        ctx.moveTo(cx+centers[i][0], cy+centers[i][1]);
        ctx.lineTo(cx+centers[j][0], cy+centers[j][1]);
        ctx.stroke();
      }

    const pulse = 0.5 + 0.5 * Math.sin(t * 1.5);
    const pr    = 4 + 5 * pulse;
    const pG    = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr * 3);
    pG.addColorStop(0, `rgba(110,231,183,${0.85 - pulse * 0.25})`); pG.addColorStop(1,'transparent');
    ctx.fillStyle = pG; ctx.beginPath(); ctx.arc(cx, cy, pr*3, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(167,243,208,0.92)';
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI*2); ctx.fill();

    for (let i = 0; i < 6; i++) {
      const a  = (i * Math.PI) / 3 + t * 0.3;
      const a2 = 0.4 + 0.6 * Math.abs(Math.sin(t + i * 1.047));
      ctx.fillStyle = `rgba(110,231,183,${a2})`;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a)*R, cy + Math.sin(a)*R, 2.8, 0, Math.PI*2); ctx.fill();
    }
  }

  _drawMorning() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,    '#090618');
    bg.addColorStop(0.45, '#1e0e28');
    bg.addColorStop(0.78, '#3d1408');
    bg.addColorStop(1,    '#7a2e10');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Sun: slowly rises, gently pulses
    const sunX = W * 0.5;
    const sunY = H * (0.82 - 0.08 * Math.abs(Math.sin(t * 0.007)));
    const sunR = Math.min(W, H) * (0.072 + 0.010 * Math.sin(t * 0.55));

    // Outer horizon glow
    const hG = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, Math.min(W,H) * 0.55);
    hG.addColorStop(0,   'rgba(255,160,40,0.16)');
    hG.addColorStop(0.5, 'rgba(200,80,20,0.06)');
    hG.addColorStop(1,   'transparent');
    ctx.fillStyle = hG; ctx.fillRect(0, 0, W, H);

    // Light rays
    ctx.save();
    ctx.globalAlpha = 0.03 + 0.015 * Math.sin(t * 0.4);
    for (let i = 0; i < 14; i++) {
      const a1 = (i / 14) * Math.PI * 2 + t * 0.018;
      const a2 = a1 + 0.07;
      ctx.fillStyle = 'rgba(255,220,120,1)';
      ctx.beginPath();
      ctx.moveTo(sunX, sunY);
      ctx.arc(sunX, sunY, W * 0.85, a1, a2);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    // Sun disc
    const sunG = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sunG.addColorStop(0,   'rgba(255,245,200,0.96)');
    sunG.addColorStop(0.55,'rgba(255,195,60,0.80)');
    sunG.addColorStop(1,   'rgba(255,130,30,0.12)');
    ctx.fillStyle = sunG;
    ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();

    // Shimmer particles (warm golden)
    for (let i = 0; i < 45; i++) {
      const s  = i * 137.51;
      const px = W * 0.10 + ((Math.sin(s * 0.13) + 1) / 2) * W * 0.80;
      const py = H * 0.05 + ((Math.sin(s * 0.09) + 1) / 2) * H * 0.70;
      const a  = 0.12 + 0.55 * Math.abs(Math.sin(t * 0.55 + s * 0.7));
      ctx.fillStyle = `rgba(255,215,130,${a})`;
      ctx.beginPath();
      ctx.arc(px, py, 0.5 + 2.0 * Math.abs(Math.sin(s * 0.38)), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawReady() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.40;

    ctx.fillStyle = '#0f0800'; ctx.fillRect(0, 0, W, H);

    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.65);
    bg.addColorStop(0,   'rgba(217,119,6,0.22)');
    bg.addColorStop(0.5, 'rgba(180,60,0,0.08)');
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    const R     = Math.min(W, H) * (0.13 + 0.06 * pulse);

    for (let i = 3; i >= 1; i--) {
      const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * i);
      g.addColorStop(0, `rgba(251,191,36,${0.16 / i})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R * i, 0, Math.PI * 2); ctx.fill();
    }

    const cG = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    cG.addColorStop(0,   'rgba(255,245,200,0.92)');
    cG.addColorStop(0.5, 'rgba(251,191,36,0.55)');
    cG.addColorStop(1,   'rgba(217,119,6,0.05)');
    ctx.fillStyle = cG;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // Orbiting particles
    for (let i = 0; i < 8; i++) {
      const a  = (i / 8) * Math.PI * 2 + t * 0.90;
      const r2 = R * (1.5 + 0.4 * Math.sin(t * 2.0 + i));
      const px = cx + Math.cos(a) * r2;
      const py = cy + Math.sin(a) * r2;
      const al = 0.5 + 0.5 * Math.abs(Math.sin(t * 1.4 + i * 0.9));
      ctx.fillStyle = `rgba(251,191,36,${al})`;
      ctx.beginPath(); ctx.arc(px, py, 2.5 + 2.0 * al, 0, Math.PI * 2); ctx.fill();
    }

    // Outer spark field
    for (let i = 0; i < 26; i++) {
      const s  = i * 137.51;
      const r3 = R * (1.9 + 0.9 * Math.abs(Math.sin(s * 0.31)));
      const a  = s + t * (0.28 + 0.18 * Math.sin(s));
      const px = cx + Math.cos(a) * r3;
      const py = cy + Math.sin(a) * r3 * 0.82;
      const al = 0.10 + 0.45 * Math.abs(Math.sin(t * 0.8 + s));
      ctx.fillStyle = `rgba(251,191,36,${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.8 + 1.5 * Math.abs(Math.sin(s)), 0, Math.PI * 2); ctx.fill();
    }

    // Horizontal energy waves
    for (let i = 0; i < 3; i++) {
      const ly = cy + (i - 1) * Math.min(W,H) * 0.13 + Math.sin(t * 1.5 + i) * 8;
      ctx.strokeStyle = `rgba(251,191,36,${0.07 + 0.04 * Math.sin(t + i)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 3)
        ctx.lineTo(x, ly + Math.sin(x / W * Math.PI * 6 + t * 1.8 + i) * 5);
      ctx.stroke();
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  _showHome() {
    this._stopAll();
    this._closeAudio();

    document.getElementById('player').classList.remove('active');
    document.getElementById('mood').classList.remove('active');
    document.getElementById('home').classList.add('active');
    document.getElementById('timer-display').textContent = '--:--';
    document.querySelectorAll('.timer-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mins === '0'));
    this._updatePlayBtn(false);
  }

  _showMood(cat) {
    this.currentCat = cat;
    const catNames = { meditation: '瞑想', sleep: '睡眠', focus: '集中', morning: '朝の目覚め', ready: '朝の支度' };
    document.getElementById('mood-cat-title').textContent = catNames[cat];

    const list = document.getElementById('mood-list');
    list.innerHTML = '';
    MOOD_LABELS.forEach((mood, idx) => {
      const btn = document.createElement('button');
      btn.className = 'mood-btn';
      btn.innerHTML = `
        <span class="mood-btn-icon">${mood.icon}</span>
        <div class="mood-btn-text">
          <div class="mood-btn-label">${mood.label}</div>
          <div class="mood-btn-desc">${mood.desc}</div>
        </div>
        <span class="mood-btn-arrow">›</span>
      `;
      btn.addEventListener('click', () => this._showPlayer(cat, idx));
      list.appendChild(btn);
    });

    document.getElementById('home').classList.remove('active');
    document.getElementById('mood').classList.add('active');
  }

  _showPlayer(cat, moodId) {
    const catNames = { meditation: '瞑想', sleep: '睡眠', focus: '集中', morning: '朝の目覚め', ready: '朝の支度' };
    const mood = MOOD_LABELS[moodId];
    document.getElementById('player-name').textContent = `${catNames[cat]} · ${mood.label}`;
    document.getElementById('player-desc').textContent = mood.desc;

    this._stopBgCanvas();
    this._renderTimerBtns(cat);
    document.getElementById('mood').classList.remove('active');
    document.getElementById('player').classList.add('active');
    this._startCategory(cat, moodId);
  }

  _backFromPlayer() {
    const cat = this.currentCat;  // save before _stopAll nulls it
    this._stopAll();
    this._closeAudio();

    this._startBgCanvas();
    document.getElementById('player').classList.remove('active');
    document.getElementById('timer-display').textContent = '--:--';
    document.querySelectorAll('.timer-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mins === '0'));
    this._updatePlayBtn(false);

    this._showMood(cat);
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  _updatePlayBtn(playing) {
    document.getElementById('play-icon').textContent = playing ? '⏸' : '▶';
    document.getElementById('play-text').textContent = playing ? '一時停止' : '再生';
    document.getElementById('btn-play').classList.toggle('paused', !playing);
  }

  _initUI() {
    document.querySelectorAll('.category-card').forEach(card =>
      card.addEventListener('click', () => this._showMood(card.dataset.cat)));

    document.getElementById('btn-mood-back').addEventListener('click', () => this._showHome());
    document.getElementById('btn-back').addEventListener('click', () => this._backFromPlayer());

    document.getElementById('btn-play').addEventListener('click', () => {
      if (!this.ac) return;
      this.isPlaying ? this._pause() : this._resume();
    });

    document.getElementById('master-vol').addEventListener('input', e => {
      if (this.masterGain && this.isPlaying)
        this.masterGain.gain.setTargetAtTime(+e.target.value / 100, this.ac.currentTime, 0.1);
    });

    // timer buttons are rendered dynamically in _renderTimerBtns(cat)
  }
}

document.addEventListener('DOMContentLoaded', () => { new HealingApp(); });
