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
    // 0: 家で静かに — オルガン＋ハープ: binaural + organ + solfeggio + harp + bowl
    {
      breathe: [
        { idx:0, min:0.38, max:0.56 },
        { idx:1, min:0.42, max:0.62 },
        { idx:2, min:0.36, max:0.56 },
        { idx:3, min:0.24, max:0.48 },
        { idx:4, min:0.20, max:0.44 },
      ],
      breatheInterval: 220,
      layers: [
        { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.50 },
        { type:'organ',     name:'オルガン',           icon:'🎹', baseFreq:98.0, vol:0.52 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.54 },
        { type:'harp',      name:'ハープ',            icon:'🪕',
          patterns:[
            [132, null, 176, null, null],
            [null, 198, null, 132, null],
            [176, null, null, 264, null],
            [132, null, 198, null, null],
          ], bpm:15, startDelay:7, vol:0.38 },
        { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:22000, vol:0.46 },
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
    // 3: ホテルで自宅のように — 焚き火＋オルガン: fire + organ + binaural
    {
      breathe: [
        { idx:0, min:0.40, max:0.58 },
        { idx:1, min:0.38, max:0.60 },
        { idx:2, min:0.34, max:0.54 },
      ],
      breatheInterval: 200,
      layers: [
        { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.44 },
        { type:'fire',     name:'焚き火',             icon:'🔥', vol:0.62 },
        { type:'organ',    name:'オルガン',            icon:'🎹', baseFreq:65.41, vol:0.46 },
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

    this._PREFS_KEY = 'nagi_prefs';
    this._uiCat        = 'morning';  // currently selected mode tab
    this._uiMood       = 0;          // currently selected situation chip
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

    this.soundBuffers  = {};    // keyed by sound name, AudioBuffer once loaded
    this._soundsReady  = Promise.resolve();  // resolves after all files decoded

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
      // Re-seed stars on resize
      this._bgStars = null;
    }
    const W = c.width, H = c.height, t = this.bgT;

    // ── Base fill: deep ocean (not pure black) ──
    const baseFill = ctx.createLinearGradient(0, 0, 0, H);
    baseFill.addColorStop(0,   '#0d2038');
    baseFill.addColorStop(0.5, '#0b1929');
    baseFill.addColorStop(1,   '#091420');
    ctx.fillStyle = baseFill;
    ctx.fillRect(0, 0, W, H);

    // ── Ocean/dusk nebula blobs ──
    // Mix of ocean teal, twilight violet, warm sunset amber
    const blobs = [
      { cx:0.20, cy:0.30, r:0.70, rgb:[ 14,120,210],  a:0.060, sx:0.12, sy:0.09, sp:0.00018, ph:0.0 },
      { cx:0.80, cy:0.55, r:0.60, rgb:[120, 40,180],  a:0.045, sx:0.10, sy:0.11, sp:0.00013, ph:2.1 },
      { cx:0.50, cy:0.08, r:0.52, rgb:[ 20,150,190],  a:0.038, sx:0.09, sy:0.08, sp:0.00015, ph:4.3 },
      { cx:0.10, cy:0.78, r:0.46, rgb:[ 60, 80,200],  a:0.042, sx:0.07, sy:0.10, sp:0.00017, ph:1.2 },
      { cx:0.88, cy:0.22, r:0.42, rgb:[200, 80, 60],  a:0.030, sx:0.08, sy:0.07, sp:0.00014, ph:3.5 }, // sunset glow
      { cx:0.55, cy:0.88, r:0.38, rgb:[180, 60,200],  a:0.032, sx:0.11, sy:0.06, sp:0.00020, ph:5.1 },
      { cx:0.35, cy:0.65, r:0.34, rgb:[240,140, 40],  a:0.022, sx:0.06, sy:0.08, sp:0.00016, ph:0.8 }, // warm amber
    ];

    blobs.forEach(b => {
      const bx = (b.cx + Math.sin(t * b.sp + b.ph) * b.sx) * W;
      const by = (b.cy + Math.cos(t * b.sp * 0.71 + b.ph) * b.sy) * H;
      const br = b.r * Math.max(W, H);
      const [r0, g0, bl0] = b.rgb;
      const gr = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      gr.addColorStop(0,    `rgba(${r0},${g0},${bl0},${b.a})`);
      gr.addColorStop(0.40, `rgba(${r0},${g0},${bl0},${(b.a * 0.38).toFixed(3)})`);
      gr.addColorStop(1,    `rgba(${r0},${g0},${bl0},0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
    });

    // ── Star field (seeded once, twinkle over time) ──
    if (!this._bgStars) {
      this._bgStars = Array.from({ length: 72 }, (_, i) => ({
        x: ((Math.sin(i * 127.1 + 3) + 1) / 2) * W,
        y: ((Math.sin(i * 311.7 + 1) + 1) / 2) * H,
        r: 0.28 + 0.90 * Math.abs(Math.sin(i * 0.87)),
        phase: i * 2.3,
        speed: 0.00028 + Math.random() * 0.00040,
      }));
    }
    this._bgStars.forEach(s => {
      const tw = 0.08 + 0.32 * Math.abs(Math.sin(t * s.speed + s.phase));
      // Slightly warm-tinted stars (ocean/dusk feel)
      ctx.fillStyle = `rgba(200,230,255,${tw.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Occasional shooting star ──
    if (!this._shootT) this._shootT = 0;
    this._shootT++;
    if (this._shootT % 420 === 0) {
      const sx = Math.random() * W;
      const sy = Math.random() * H * 0.5;
      const len = 60 + Math.random() * 80;
      const ang = Math.PI * 0.18 + Math.random() * 0.1;
      const gr2 = ctx.createLinearGradient(sx, sy, sx + Math.cos(ang)*len, sy + Math.sin(ang)*len);
      gr2.addColorStop(0, 'rgba(200,220,255,0)');
      gr2.addColorStop(0.4, 'rgba(200,220,255,0.55)');
      gr2.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.strokeStyle = gr2;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(ang)*len, sy + Math.sin(ang)*len);
      ctx.stroke();
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

    // Start async preload of all real audio files
    this._soundsReady = this._preloadSounds();
  }

  // Preload all MP3 samples and store as AudioBuffers
  async _preloadSounds() {
    const FILES = {
      rain:   'sounds/rain.mp3',
      ocean:  'sounds/ocean.mp3',
      stream: 'sounds/stream.mp3',
      wind:   'sounds/wind.mp3',
      fire:   'sounds/fire.mp3',
      bowl:   'sounds/bowl.mp3',
      birds:  'sounds/birds.mp3',
    };
    await Promise.all(Object.entries(FILES).map(async ([key, url]) => {
      try {
        const res  = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        const ab   = await res.arrayBuffer();
        this.soundBuffers[key] = await this.ac.decodeAudioData(ab);
      } catch (e) {
        console.warn(`[HealingSound] Could not load ${url}:`, e);
        this.soundBuffers[key] = null;
      }
    }));
  }

  // Helper: create a looping AudioBuffer source from a preloaded sample
  _makeFileLoop(key, useReverb = false) {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    if (useReverb) gainNode.connect(this.reverbSend);
    const nodes = [];
    const buf = this.soundBuffers[key];
    if (buf) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop   = true;
      src.connect(gainNode);
      src.start();
      nodes.push(src);
    }
    return { gainNode, nodes };
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
    // Use real recording; gentle LP to soften harsh high end
    if (this.soundBuffers.rain) {
      const ac       = this.ac;
      const gainNode = ac.createGain();
      gainNode.gain.value = 0;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.5;
      lp.connect(this.dryBus);
      gainNode.connect(lp);
      const src = ac.createBufferSource();
      src.buffer = this.soundBuffers.rain;
      src.loop   = true;
      src.connect(gainNode);
      src.start();
      return { gainNode, nodes: [src] };
    }
    // ── synthesis fallback ──
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
      const lfo  = ac.createOscillator();
      const lfoG = ac.createGain();
      lfo.frequency.value = 0.03 + Math.random() * 0.05;
      lfoG.gain.value     = vol * 0.22;
      const g = ac.createGain();
      g.gain.value = vol * 0.78;
      lfo.connect(lfoG); lfoG.connect(g.gain);
      src.connect(hp); hp.connect(lp); lp.connect(g);
      g.connect(gainNode);
      src.start(); lfo.start();
      nodes.push(src, lfo);
    });
    return { gainNode, nodes };
  }

  _makeOcean() {
    return this._makeFileLoop('ocean', true);
  }

  _makeFire() {
    // Use real recording when available
    if (this.soundBuffers.fire) {
      return this._makeFileLoop('fire', false);
    }
    // ── synthesis fallback ──
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);

    const nodes = [];

    // Layer 1: deep warmth hum with fast flicker (5-8Hz) — feels like flame, not wave
    {
      const src = ac.createBufferSource();
      src.buffer = buildNoiseBuffer(ac, 'brown');
      src.loop = true;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 95; lp.Q.value = 0.45;
      const baseG = ac.createGain();
      baseG.gain.value = 0.07;
      const flickerLFO = ac.createOscillator();
      flickerLFO.type = 'sawtooth';
      flickerLFO.frequency.value = 5.2 + Math.random() * 3.0;
      const flickerDepth = ac.createGain();
      flickerDepth.gain.value = 0.045;
      flickerLFO.connect(flickerDepth);
      flickerDepth.connect(baseG.gain);
      flickerLFO.start();
      src.connect(lp); lp.connect(baseG); baseG.connect(gainNode);
      src.start();
      nodes.push(src, flickerLFO);
    }

    // Layer 2: mid-range micro-crackle texture — continuous burning presence
    {
      const src = ac.createBufferSource();
      src.buffer = buildNoiseBuffer(ac, 'pink');
      src.loop = true;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 700; hp.Q.value = 0.7;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 2800; lp.Q.value = 0.5;
      const g = ac.createGain();
      g.gain.value = 0.022;
      const lfo = ac.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 7.5 + Math.random() * 4.5;
      const depth = ac.createGain();
      depth.gain.value = 0.016;
      lfo.connect(depth); depth.connect(g.gain);
      lfo.start();
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(gainNode);
      src.start();
      nodes.push(src, lfo);
    }

    // Sharp crack (high-freq transient)
    const fireCrack = (when, ampScale = 1.0) => {
      const sr  = ac.sampleRate;
      const dur = 0.010 + Math.random() * 0.028;
      const len = Math.round(sr * dur);
      const buf = ac.createBuffer(1, len, sr);
      const d   = buf.getChannelData(0);
      const atk = Math.round(sr * 0.0008);
      for (let i = 0; i < len; i++) {
        const env = (i < atk ? i / atk : 1) * Math.exp(-i / (len * 0.13));
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const s = ac.createBufferSource(); s.buffer = buf;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1400 + Math.random() * 2200;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7500;
      const g = ac.createGain();
      g.gain.setValueAtTime((0.25 + Math.random() * 0.38) * ampScale, when);
      s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(gainNode);
      s.start(when);
    };

    // Deeper thud (low-freq wood settling)
    const fireThud = (when, ampScale = 1.0) => {
      const sr  = ac.sampleRate;
      const dur = 0.022 + Math.random() * 0.038;
      const len = Math.round(sr * dur);
      const buf = ac.createBuffer(1, len, sr);
      const d   = buf.getChannelData(0);
      const atk = Math.round(sr * 0.002);
      for (let i = 0; i < len; i++) {
        const env = (i < atk ? i / atk : 1) * Math.exp(-i / (len * 0.22));
        d[i] = (Math.random() * 2 - 1) * env;
      }
      const s = ac.createBufferSource(); s.buffer = buf;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 550 + Math.random() * 350;
      const g = ac.createGain();
      g.gain.setValueAtTime((0.16 + Math.random() * 0.18) * ampScale, when);
      s.connect(lp); lp.connect(g); g.connect(gainNode);
      s.start(when);
    };

    const schedule = () => {
      if (!this.isPlaying) return;
      const now = ac.currentTime;
      const r   = Math.random();

      if (r < 0.32) {
        fireCrack(now);
      } else if (r < 0.50) {
        fireThud(now);
      } else if (r < 0.68) {
        fireCrack(now);
        fireCrack(now + 0.038 + Math.random() * 0.072);
      } else if (r < 0.82) {
        fireCrack(now, 0.80);
        fireThud(now + 0.025 + Math.random() * 0.045, 0.70);
      } else {
        const n = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++)
          fireCrack(now + i * (0.007 + Math.random() * 0.013), 0.42);
      }

      this.schedulerTmrs.push(setTimeout(schedule, 900 + Math.random() * 4800));
    };
    this.schedulerTmrs.push(setTimeout(schedule, 500 + Math.random() * 1500));

    return { gainNode, nodes };
  }

  // Organ: additive sine harmonics (drawbar-style) with gentle tremolo
  _makeOrgan(baseFreq = 98.0) {
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];

    // Summing node before filter
    const mixG = ac.createGain();
    mixG.gain.value = 1;

    // Soft LP to remove harsh upper partials
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1600; lp.Q.value = 0.6;

    // Tremolo (Leslie-style) at ~5.6Hz
    const tremG     = ac.createGain();
    tremG.gain.value = 0.86;
    const tremLFO   = ac.createOscillator();
    tremLFO.type    = 'sine';
    tremLFO.frequency.value = 5.6;
    const tremDepth = ac.createGain();
    tremDepth.gain.value = 0.12;
    tremLFO.connect(tremDepth);
    tremDepth.connect(tremG.gain);
    tremLFO.start();
    nodes.push(tremLFO);

    mixG.connect(lp); lp.connect(tremG); tremG.connect(gainNode);

    // Drawbar harmonics: 16'(×0.5), 8'(×1), 5⅓'(×1.5), 4'(×2), 2⅔'(×3), 2'(×4)
    [
      { ratio: 0.5, gv: 0.30 },
      { ratio: 1,   gv: 0.52 },
      { ratio: 2,   gv: 0.34 },
      { ratio: 3,   gv: 0.16 },
      { ratio: 4,   gv: 0.09 },
      { ratio: 6,   gv: 0.04 },
    ].forEach(({ ratio, gv }) => {
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = baseFreq * ratio;
      const g = ac.createGain(); g.gain.value = gv;
      osc.connect(g); g.connect(mixG);
      osc.start(); nodes.push(osc);
    });

    return { gainNode, nodes };
  }

  // Wind: pink noise through bandpass with slow filter + amplitude LFOs for gusting
  _makeWind() {
    return this._makeFileLoop('wind', false);
  }

  _makeStream() {
    return this._makeFileLoop('stream', true);
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
    // Real audio: loop the birds recording continuously
    if (this.soundBuffers.birds) {
      const src = this.ac.createBufferSource();
      src.buffer = this.soundBuffers.birds;
      src.loop   = true;
      src.connect(destGain);
      src.start();
      return;
    }
    // Synthesis fallback: synthesized chirp clusters
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
    // Use real bowl recording when available
    if (this.soundBuffers.bowl) {
      const src = ac.createBufferSource();
      src.buffer = this.soundBuffers.bowl;
      const env = ac.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.90, now + 0.06);
      env.gain.setTargetAtTime(0.0001, now + 1.0, 5.5);
      src.connect(env);
      env.connect(destGain);
      env.connect(this.reverbSend);
      src.start(now);
      return;
    }
    // Synthesis fallback
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

  // ── Stops only layer nodes/schedulers; keeps AudioContext alive ───────────
  // Use this for mode/situation switches — avoids re-init and re-decode cost.

  _stopLayersOnly() {
    this.isPlaying = false;

    this.schedulerTmrs.forEach(clearTimeout);
    this.schedulerTmrs = [];

    this._stopTimer();
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }

    this.layers.forEach(l => {
      l.nodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (_) {} });
      try { l.gainNode.disconnect(); } catch (_) {}
    });
    this.layers = [];

    this.currentCat  = null;
    this.currentMood = null;
    // AudioContext, masterGain, dryBus, reverbSend → kept alive intentionally
  }

  // ── Category start ────────────────────────────────────────────────────────

  async _startCategory(cat, moodId, fadeSec = 3.5) {
    // Re-use existing AudioContext when switching modes; only init once.
    if (!this.ac || this.ac.state === 'closed') {
      this._initAudio();
    } else {
      // AudioContext is alive — restore masterGain to target volume immediately
      const vol = +document.getElementById('master-vol').value / 100;
      this.masterGain.gain.cancelScheduledValues(this.ac.currentTime);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ac.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(vol, this.ac.currentTime + 0.05);
      if (this.ac.state === 'suspended') this.ac.resume();
    }

    this.isPlaying   = true;
    this.currentCat  = cat;
    this.currentMood = moodId;

    const preset = PRESETS[cat][moodId];
    this.layers = [];

    // Wait for all audio files to be decoded before building layers.
    // After the first play this resolves instantly (buffers cached).
    await this._soundsReady;
    if (!this.isPlaying) return;  // user switched again before decode finished

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
        case 'organ': {
          const og = this._makeOrgan(def.baseFreq || 98.0);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: og.gainNode, nodes: og.nodes, defaultVol: def.vol });
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

    // Apply saved layer volumes if available; otherwise use preset defaults
    const savedVols = this._savedLayerVols(cat, moodId);
    this.layers.forEach((l, idx) => {
      const vol = (savedVols && savedVols[idx] != null) ? savedVols[idx] : l.defaultVol;
      l.gainNode.gain.cancelScheduledValues(this.ac.currentTime);
      l.gainNode.gain.setValueAtTime(0, this.ac.currentTime);
      l.gainNode.gain.linearRampToValueAtTime(vol, this.ac.currentTime + fadeSec);
    });

    // Save last session & master volume
    this._savePrefs({
      lastCat:   cat,
      lastMood:  moodId,
      masterVol: document.getElementById('master-vol').value,
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

  // ── Preferences (localStorage) ───────────────────────────────────────────

  _loadPrefs() {
    try { return JSON.parse(localStorage.getItem(this._PREFS_KEY)) || {}; }
    catch { return {}; }
  }

  _savePrefs(patch) {
    try {
      const prefs = this._loadPrefs();
      Object.assign(prefs, patch);
      localStorage.setItem(this._PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage blocked */ }
  }

  _prefsKey(cat, mood) { return `${cat}:${mood}`; }

  // Save current layer volumes for this cat/mood
  _saveLayerVols() {
    if (!this.currentCat && this.currentCat !== 0) return;
    const vols = this.layers.map(l => {
      const slider = document.querySelector(`.layer-slider[data-idx="${this.layers.indexOf(l)}"]`);
      return slider ? +slider.value / 100 : l.defaultVol;
    });
    const layerVols = this._loadPrefs().layerVols || {};
    layerVols[this._prefsKey(this.currentCat, this.currentMood)] = vols;
    this._savePrefs({ layerVols });
  }

  // Load saved layer volumes for this cat/mood, or null if none
  _savedLayerVols(cat, mood) {
    const prefs = this._loadPrefs();
    return (prefs.layerVols && prefs.layerVols[this._prefsKey(cat, mood)]) || null;
  }

  _renderLayers() {
    const container  = document.getElementById('layers-container');
    container.innerHTML = '';
    const savedVols  = this._savedLayerVols(this.currentCat, this.currentMood);

    this.layers.forEach((layer, idx) => {
      // Use saved volume if available, otherwise preset default
      const initVol = (savedVols && savedVols[idx] != null)
        ? savedVols[idx]
        : layer.defaultVol;

      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <button class="layer-toggle on" data-idx="${idx}">${layer.icon}</button>
        <span class="layer-name">${layer.name}</span>
        <input type="range" class="layer-slider" min="0" max="100"
          value="${Math.round(initVol * 100)}" data-idx="${idx}">
      `;

      row.querySelector('.layer-slider').addEventListener('input', e => {
        const l = this.layers[+e.target.dataset.idx];
        if (!l) return;
        l.gainNode.gain.cancelScheduledValues(this.ac.currentTime);
        l.gainNode.gain.setTargetAtTime(+e.target.value / 100, this.ac.currentTime, 0.1);
        this._saveLayerVols();  // ← 自動保存
      });
      row.querySelector('.layer-toggle').addEventListener('click', e => {
        const btn = e.currentTarget;
        btn.classList.toggle('on');
        const l   = this.layers[+btn.dataset.idx];
        if (!l) return;
        const vol = btn.classList.contains('on')
          ? row.querySelector('.layer-slider').value / 100 : 0;
        l.gainNode.gain.setTargetAtTime(vol, this.ac.currentTime, 0.4);
        this._saveLayerVols();  // ← 自動保存
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

  // ── 朝の目覚め — Aurora Dawn ─────────────────────────────────────────────
  // 暁のオーロラリボン（水平）+ 地平線グロー + 黄金の光の粒
  _drawMorning() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.5;

    // Sky: deep indigo → twilight violet → dawn rose → amber horizon
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    '#070516');
    sky.addColorStop(0.38, '#1a0830');
    sky.addColorStop(0.65, '#3d1040');
    sky.addColorStop(0.82, '#7a2018');
    sky.addColorStop(1,    '#b84010');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Aurora ribbons — filled sine-wave polygons with vertical gradient
    const bands = [
      { y: 0.20, amp: 0.055, freq: 2.1, spd: 0.18, rgb: [70,210,240],   a: 0.30, h: 0.16 },
      { y: 0.32, amp: 0.042, freq: 1.65,spd: 0.13, rgb: [200,100,210],  a: 0.24, h: 0.13 },
      { y: 0.12, amp: 0.032, freq: 2.9, spd: 0.23, rgb: [255,190, 80],  a: 0.18, h: 0.10 },
    ];
    bands.forEach(b => {
      const yM = b.y * H, hH = b.h * H;
      const [r, g, bl] = b.rgb;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const w = Math.sin(x / W * Math.PI * b.freq + t * b.spd) * b.amp * H;
        x === 0 ? ctx.moveTo(x, yM + w - hH) : ctx.lineTo(x, yM + w - hH);
      }
      for (let x = W; x >= 0; x -= 4) {
        const w = Math.sin(x / W * Math.PI * b.freq + t * b.spd) * b.amp * H;
        ctx.lineTo(x, yM + w + hH);
      }
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, yM - hH, 0, yM + hH * 1.5);
      gr.addColorStop(0,    `rgba(${r},${g},${bl},0)`);
      gr.addColorStop(0.30, `rgba(${r},${g},${bl},${b.a})`);
      gr.addColorStop(0.65, `rgba(${r},${g},${bl},${(b.a * 0.55).toFixed(3)})`);
      gr.addColorStop(1,    `rgba(${r},${g},${bl},0)`);
      ctx.fillStyle = gr; ctx.fill();
    });

    // Horizon glow
    const hor = ctx.createRadialGradient(cx, H, 0, cx, H, H * 0.80);
    hor.addColorStop(0,    'rgba(210,90,30,0.42)');
    hor.addColorStop(0.38, 'rgba(170,45,70,0.16)');
    hor.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = hor; ctx.fillRect(0, 0, W, H);

    // Sun cresting the horizon (slowly rises)
    const sunR = Math.min(W, H) * 0.068;
    const sunY = H * 0.98 - sunR * (0.5 + 0.35 * Math.abs(Math.sin(t * 0.006)));
    const sunG = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, sunR * 2.8);
    sunG.addColorStop(0,   'rgba(255,245,180,0.96)');
    sunG.addColorStop(0.35,'rgba(255,175,50, 0.55)');
    sunG.addColorStop(1,   'rgba(255,110,20, 0)');
    ctx.fillStyle = sunG; ctx.beginPath(); ctx.arc(cx, sunY, sunR * 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,252,220,0.95)';
    ctx.beginPath(); ctx.arc(cx, sunY, sunR, 0, Math.PI * 2); ctx.fill();

    // Drifting golden motes (float upward)
    for (let i = 0; i < 50; i++) {
      const s  = i * 137.508;
      const px = ((Math.sin(s * 0.17) + 1) / 2) * W;
      const vy = t * 0.00055 * (0.6 + 0.4 * Math.sin(s * 0.3));
      const py = ((((Math.sin(s * 0.11) + 1) / 2) - vy) % 1 + 1) % 1 * H;
      const al = (0.14 + 0.55 * Math.abs(Math.sin(t * 0.38 + s))).toFixed(2);
      const rr = 0.5 + 1.6 * Math.abs(Math.sin(s * 0.44));
      ctx.fillStyle = `rgba(255,210,90,${al})`;
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── 朝の支度 — Solar Storm ───────────────────────────────────────────────
  // 膨張する光の波紋 + 中心コア + スパイラル粒子アーム
  _drawReady() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.42;
    const U  = Math.min(W, H);

    ctx.fillStyle = '#090600'; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.65);
    bg.addColorStop(0,   'rgba(200,90,10,0.20)');
    bg.addColorStop(0.5, 'rgba(160,50,5,0.07)');
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Expanding pulse rings (5 rings cycling continuously)
    for (let i = 0; i < 5; i++) {
      const prog  = ((t * 0.20 + i * 0.2) % 1);
      const rRing = prog * U * 0.50;
      const al    = (1 - prog) * 0.18;
      ctx.beginPath(); ctx.arc(cx, cy, rRing, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(251,146,60,${al.toFixed(3)})`;
      ctx.lineWidth = 1.4 * (1 - prog * 0.6); ctx.stroke();
    }

    // Central corona + core
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.0);
    const cR    = U * (0.038 + 0.016 * pulse);
    const corona = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR * (5 + 2 * pulse));
    corona.addColorStop(0,   `rgba(255,235,140,${0.60 + 0.20 * pulse})`);
    corona.addColorStop(0.25,`rgba(251,146,60, ${0.28 + 0.12 * pulse})`);
    corona.addColorStop(1,   'rgba(217,70,10,0)');
    ctx.fillStyle = corona;
    ctx.beginPath(); ctx.arc(cx, cy, cR * (5 + 2 * pulse), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,250,210,${0.90 + 0.08 * pulse})`;
    ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();

    // Spiral particle arms (3 arms × 10 particles)
    for (let arm = 0; arm < 3; arm++) {
      const armBase = (arm / 3) * Math.PI * 2 + t * 0.60;
      for (let p = 0; p < 10; p++) {
        const prog = p / 10;
        const ang  = armBase + prog * Math.PI * 1.5;
        const dist = U * (0.08 + prog * 0.32);
        const px   = cx + Math.cos(ang) * dist;
        const py   = cy + Math.sin(ang) * dist;
        const al   = ((1 - prog) * (0.55 + 0.35 * Math.abs(Math.sin(t * 1.1 + p)))).toFixed(2);
        const rp   = (1 - prog * 0.65) * 2.8;
        ctx.fillStyle = `rgba(251,191,36,${al})`;
        ctx.beginPath(); ctx.arc(px, py, rp, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Ambient spark field
    for (let i = 0; i < 28; i++) {
      const s  = i * 137.508;
      const a  = s + t * (0.26 + 0.16 * Math.sin(s * 0.1));
      const d  = U * (0.24 + 0.22 * Math.abs(Math.sin(s * 0.31)));
      const px = cx + Math.cos(a) * d;
      const py = cy + Math.sin(a) * d * 0.88;
      const al = (0.08 + 0.38 * Math.abs(Math.sin(t * 0.75 + s))).toFixed(2);
      ctx.fillStyle = `rgba(251,191,36,${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.8 + 1.4 * Math.abs(Math.sin(s * 0.5)), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── 集中 — Lissajous Flow ────────────────────────────────────────────────
  // パラメトリック曲線（リサジュー）が緩やかに変形する — フロー状態の可視化
  _drawFocus() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.44;
    const U  = Math.min(W, H);

    ctx.fillStyle = '#010c0a'; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.52);
    bg.addColorStop(0,   `rgba(0,130,95,${0.10 + 0.04 * Math.sin(t * 0.5)})`);
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Lissajous figure — a:b ratio morphs slowly (3:2 → 5:3)
    const A    = U * 0.28, B = U * 0.22;
    const fa   = 3;
    const fb   = 2 + 0.08 * Math.sin(t * 0.028);   // gently morphs
    const dphi = t * 0.055;                          // slow phase drift

    const STEPS = 220;
    for (let i = 0; i < STEPS; i++) {
      const θ   = (i / STEPS) * Math.PI * 2;
      const x   = cx + A * Math.sin(fa * θ + dphi);
      const y   = cy + B * Math.sin(fb * θ);
      // Hue shifts teal → cyan → emerald along the curve
      const hue = 155 + 45 * ((i / STEPS));
      const al  = (0.28 + 0.52 * Math.abs(Math.sin(θ * 3.1 + t * 0.7))).toFixed(2);
      const rr  = 1.2 + 1.5 * Math.abs(Math.sin(θ * 2.2 + t * 0.4));
      ctx.fillStyle = `hsla(${hue | 0},78%,62%,${al})`;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    }

    // Three moving highlight glows tracing the curve
    for (let k = 0; k < 3; k++) {
      const θ = (t * 0.72 + k * Math.PI * 2 / 3) % (Math.PI * 2);
      const x = cx + A * Math.sin(fa * θ + dphi);
      const y = cy + B * Math.sin(fb * θ);
      const dotG = ctx.createRadialGradient(x, y, 0, x, y, U * 0.055);
      dotG.addColorStop(0,   'rgba(110,240,185,0.88)');
      dotG.addColorStop(0.4, 'rgba(52, 211,153,0.35)');
      dotG.addColorStop(1,   'transparent');
      ctx.fillStyle = dotG; ctx.beginPath(); ctx.arc(x, y, U * 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(210,255,235,0.95)';
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // Faint sacred geometry backdrop (Flower of Life fragment)
    const rot = t * 0.022;
    const R   = U * 0.19;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(52,211,153,0.07)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rot;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // Subtle grid
    ctx.strokeStyle = 'rgba(52,211,153,0.035)'; ctx.lineWidth = 0.5;
    const gStep = U * 0.088;
    for (let x = cx % gStep; x < W; x += gStep) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = cy % gStep; y < H; y += gStep) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  }

  // ── 瞑想 — Breathing Mandala ─────────────────────────────────────────────
  // 呼吸マンダラ: 多層リプル + フラワーペタル + 呼吸インジケーター
  _drawMeditation() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.42;
    const U  = Math.min(W, H);

    ctx.fillStyle = '#060212'; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.60);
    bg.addColorStop(0,   'rgba(100,28,140,0.26)');
    bg.addColorStop(0.55,'rgba(70,20,110,0.10)');
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Breath cycle (4-4-4-4 pattern: in / hold / out / rest)
    const ph = (t % 16) / 16;
    let ratio, label;
    if      (ph < 0.25) { ratio = ph / 0.25;              label = '吸　う'; }
    else if (ph < 0.50) { ratio = 1;                      label = '保　つ'; }
    else if (ph < 0.75) { ratio = 1 - (ph - 0.50) / 0.25; label = '吐　く'; }
    else                { ratio = 0;                      label = '　　…'; }
    const cR = U * (0.09 + 0.17 * ratio);  // core radius breathes

    // Ripple rings (6 rings, offset timing — like ripples from a stone)
    for (let i = 0; i < 6; i++) {
      const prog = ((t * 0.16 + i / 6) % 1);
      const rRip = cR + prog * U * 0.44;
      const al   = (1 - prog) * 0.22;
      if (al < 0.008) continue;
      ctx.beginPath(); ctx.arc(cx, cy, rRip, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(192,105,255,${al.toFixed(3)})`;
      ctx.lineWidth = 1.4 * (1 - prog * 0.5); ctx.stroke();
    }

    // Outer petal ring (12 petals, slowly rotating)
    const rotOuter = t * 0.020;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rotOuter;
      const pr = cR * 0.72, pd = cR * 0.80;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * pd, cy + Math.sin(a) * pd, pr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180,100,255,${(0.06 + ratio * 0.05).toFixed(3)})`;
      ctx.lineWidth = 0.7; ctx.stroke();
    }
    // Inner petal ring (6 petals, counter-rotating)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - rotOuter * 1.4;
      const pr = cR * 0.88, pd = cR * 0.92;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * pd, cy + Math.sin(a) * pd, pr, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(216,150,255,${(0.10 + ratio * 0.08).toFixed(3)})`;
      ctx.lineWidth = 0.8; ctx.stroke();
    }

    // Core glow layers
    for (let i = 3; i >= 1; i--) {
      const g = ctx.createRadialGradient(cx, cy, cR * 0.6, cx, cy, cR * (1 + i * 0.60));
      g.addColorStop(0, `rgba(200,140,255,${(0.13 / i).toFixed(3)})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cR * (1 + i * 0.60), 0, Math.PI * 2); ctx.fill();
    }
    const cG = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
    cG.addColorStop(0,    'rgba(245,220,255,0.62)');
    cG.addColorStop(0.55, 'rgba(160, 80,255,0.28)');
    cG.addColorStop(1,    'rgba(100, 40,220,0.04)');
    ctx.fillStyle = cG; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(216,180,254,${(0.32 + ratio * 0.38).toFixed(3)})`;
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.stroke();

    // Breath label
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.font = `${(U * 0.042) | 0}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);

    // Orbiting particles
    for (let i = 0; i < 36; i++) {
      const s  = i * 137.508;
      const a  = s + t * (0.055 + 0.035 * Math.sin(s * 0.2));
      const d  = U * (0.30 + 0.14 * Math.abs(Math.sin(s * 0.4)));
      const px = cx + Math.cos(a) * d;
      const py = cy + Math.sin(a) * d * 0.86;
      const al = (0.10 + 0.48 * Math.abs(Math.sin(t * 0.26 + s))).toFixed(2);
      ctx.fillStyle = `rgba(220,195,255,${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.7 + 1.9 * Math.abs(Math.sin(s * 0.3)), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── 睡眠 — Aurora Night ──────────────────────────────────────────────────
  // 縦のオーロラカーテン + 星野 + 月 + 波紋
  _drawSleep() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;

    // Deep space gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,   '#010710');
    sky.addColorStop(0.45,'#030c1c');
    sky.addColorStop(0.85,'#050f22');
    sky.addColorStop(1,   '#040d1a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Vertical aurora curtains (3 bands, sine-wave polygon edges)
    const curtains = [
      { xR: 0.25, wR: 0.32, spd: 0.080, ph: 0.0, rgb: [0,  195, 155], a: 0.22 },
      { xR: 0.58, wR: 0.28, spd: 0.065, ph: 2.1, rgb: [70, 120, 220], a: 0.18 },
      { xR: 0.76, wR: 0.22, spd: 0.100, ph: 4.4, rgb: [140, 55, 200], a: 0.14 },
    ];
    curtains.forEach(c => {
      const xC = (c.xR + Math.sin(t * c.spd + c.ph) * 0.06) * W;
      const wW = c.wR * W;
      const [r, g, b] = c.rgb;
      ctx.beginPath();
      const S = 44;
      for (let s = 0; s <= S; s++) {
        const y = (s / S) * H * 0.90;
        const wo = Math.sin(y / H * Math.PI * 3.2 + t * 0.12 + c.ph) * wW * 0.22;
        s === 0 ? ctx.moveTo(xC - wW * 0.5 + wo, y) : ctx.lineTo(xC - wW * 0.5 + wo, y);
      }
      for (let s = S; s >= 0; s--) {
        const y = (s / S) * H * 0.90;
        const wo = Math.sin(y / H * Math.PI * 3.2 + t * 0.12 + c.ph) * wW * 0.22;
        ctx.lineTo(xC + wW * 0.5 + wo, y);
      }
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, 0, 0, H * 0.90);
      gr.addColorStop(0,    `rgba(${r},${g},${b},0)`);
      gr.addColorStop(0.12, `rgba(${r},${g},${b},${c.a})`);
      gr.addColorStop(0.65, `rgba(${r},${g},${b},${(c.a * 0.52).toFixed(3)})`);
      gr.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr; ctx.fill();
    });

    // Star field (deterministic, twinkle over time)
    for (let i = 0; i < 80; i++) {
      const s  = i * 127.1;
      const sx = ((Math.sin(s * 0.11) + 1) / 2) * W;
      const sy = ((Math.sin(s * 0.073) + 1) / 2) * H * 0.78;
      const tw = 0.10 + 0.55 * Math.abs(Math.sin(t * (0.0003 + (i % 7) * 0.00005) * 5000 + s));
      const sr = 0.35 + 1.4 * Math.abs(Math.sin(s * 0.29));
      ctx.fillStyle = `rgba(200,225,255,${tw.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }

    // Moon: disc + soft halo
    const mx = W * 0.74, my = H * 0.17;
    const mr = Math.min(W, H) * 0.064;
    const mhG = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
    mhG.addColorStop(0,   'rgba(195,215,255,0.12)');
    mhG.addColorStop(1,   'transparent');
    ctx.fillStyle = mhG; ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, Math.PI * 2); ctx.fill();
    const mG = ctx.createRadialGradient(mx - mr * 0.18, my - mr * 0.18, 0, mx, my, mr);
    mG.addColorStop(0,   'rgba(242,238,215,0.95)');
    mG.addColorStop(0.7, 'rgba(212,205,175,0.90)');
    mG.addColorStop(1,   'rgba(190,182,148,0.35)');
    ctx.fillStyle = mG; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();

    // Gentle ocean waves at the bottom
    for (let w = 0; w < 4; w++) {
      const baseY = H * (0.82 + w * 0.045);
      ctx.strokeStyle = `rgba(20,100,180,${(0.18 - w * 0.035).toFixed(3)})`;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 3) {
        const y = baseY + Math.sin(x / W * Math.PI * 4.5 + t * (0.28 - w * 0.03) + w * 0.8) * (6 - w);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ── Mode & situation selection ───────────────────────────────────────────

  // Short labels for situation chips (compact horizontal rail)
  _sitLabel(mood) {
    const SHORT = {
      'quiet-home': '🏠 自宅',
      'noisy-out':  '🌆 外出中',
      'transit':    '🚃 移動中',
      'hotel':      '🏨 ホテル',
      'pre-game':   '⚡ 勝負前',
    };
    return SHORT[mood.id] || mood.icon + ' ' + mood.label.slice(0, 5);
  }

  _selectMode(cat) {
    if (cat === this._uiCat && !this.isPlaying) return;

    const wasPlaying = this.isPlaying;
    this._uiCat  = cat;
    this._uiMood = 0;

    // Update tab UI instantly
    document.querySelectorAll('.mode-tab').forEach(t => {
      const active = t.dataset.cat === cat;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this._renderSitChips();
    this._renderModeTagline();
    this._renderTimerBtns(cat);

    // Canvas switches immediately (no audio dependency)
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this._startVisuals(cat);

    if (wasPlaying) {
      // Short ramp-out, then swap layers — AudioContext stays alive, no re-decode
      this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.12);
      this._stopLayersOnly();
      this._startCategory(cat, this._uiMood, 1.2);  // quick 1.2s fade-in
    }
  }

  _selectSituation(idx) {
    if (idx === this._uiMood) return;
    const wasPlaying = this.isPlaying;
    this._uiMood = idx;

    document.querySelectorAll('.sit-chip').forEach(c => {
      c.classList.toggle('active', +c.dataset.idx === idx);
    });

    if (wasPlaying) {
      this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.12);
      this._stopLayersOnly();
      this._startCategory(this._uiCat, idx, 1.2);
    }
  }

  _renderSitChips() {
    const rail = document.getElementById('sit-rail');
    rail.innerHTML = '';
    const cat = this._uiCat;
    MOOD_LABELS.forEach((mood, idx) => {
      const btn = document.createElement('button');
      btn.className   = 'sit-chip' + (idx === this._uiMood ? ' active' : '');
      btn.dataset.idx = idx;
      btn.dataset.cat = cat;
      btn.textContent = this._sitLabel(mood);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === this._uiMood ? 'true' : 'false');
      btn.addEventListener('click', () => this._selectSituation(idx));
      rail.appendChild(btn);
    });
  }

  _renderModeTagline() {
    const TAGS = {
      morning:   'α→β波でやさしく覚醒',
      ready:     'β波でテンションアップ',
      focus:     'α波でフロー状態へ',
      meditation:'θ波で深い瞑想状態へ',
      sleep:     'δ波で深い眠りへ',
    };
    const el = document.getElementById('mode-sub');
    if (el) el.textContent = TAGS[this._uiCat] || '';
  }

  // ── Navigation (repurposed for single-screen) ─────────────────────────────

  // Called when timer runs out — stop and reset to idle
  _showHome() {
    this._stopAll();
    this._closeAudio();
    this._updatePlayBtn(false);
    document.getElementById('timer-display').textContent = '--:--';
    document.querySelectorAll('.timer-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mins === '0'));
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  _updatePlayBtn(playing) {
    const btn  = document.getElementById('btn-play');
    const icon = document.getElementById('play-icon');
    const text = document.getElementById('play-text');
    if (icon) icon.textContent = playing ? '⏸' : '▶';
    if (text) text.textContent = playing ? '一時停止' : '再生';
    if (btn)  btn.className    = 'play-btn' + (playing ? ' playing' : ' paused');
  }

  _initUI() {
    // ── Restore prefs ──
    const savedPrefs = this._loadPrefs();
    if (savedPrefs.masterVol != null) {
      document.getElementById('master-vol').value = savedPrefs.masterVol;
    }

    // ── Initial mode / situation ──
    this._uiCat  = savedPrefs.lastCat  || 'morning';
    this._uiMood = savedPrefs.lastMood != null ? savedPrefs.lastMood : 0;

    // Activate the right mode tab
    document.querySelectorAll('.mode-tab').forEach(t => {
      const active = t.dataset.cat === this._uiCat;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
      t.addEventListener('click', () => this._selectMode(t.dataset.cat));
    });

    // Render situation chips + tagline + timer buttons for initial mode
    this._renderSitChips();
    this._renderModeTagline();
    this._renderTimerBtns(this._uiCat);

    // ── Play button ──
    document.getElementById('btn-play').addEventListener('click', () => {
      if (this.isPlaying) {
        this._pause();
      } else if (this.ac && this.ac.state !== 'closed' && this.layers.length > 0) {
        // Paused mid-session — just resume
        this._resume();
      } else {
        // First play, or after timer fade-out (AC closed) — fresh start
        this._startCategory(this._uiCat, this._uiMood);
      }
    });

    // ── Master volume ──
    document.getElementById('master-vol').addEventListener('input', e => {
      if (this.masterGain && this.isPlaying)
        this.masterGain.gain.setTargetAtTime(+e.target.value / 100, this.ac.currentTime, 0.1);
      this._savePrefs({ masterVol: e.target.value });
    });

    // ── Layer panel placeholder ──
    const container = document.getElementById('layers-container');
    if (container && container.children.length === 0) {
      const hint = document.createElement('p');
      hint.className   = 'layer-panel-empty';
      hint.textContent = '▶ 再生するとレイヤーが表示されます';
      container.appendChild(hint);
    }

    // ── Show initial canvas animation for the selected mode ──
    this._startVisuals(this._uiCat);
  }
}

document.addEventListener('DOMContentLoaded', () => { new HealingApp(); });
