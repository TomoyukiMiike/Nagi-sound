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

function computePianoBuffer(ac, freq, velocity = 0.7, durationSec = 5.5) {
  const sr  = ac.sampleRate;
  const len = Math.round(sr * durationSec);
  const buf = ac.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  // Piano partials: brighter than harp, with dual-decay envelope
  const partials = [
    [1, 0.58, 0.6,  0.055],  // [harmonic, amp, fastDecay/s, slowDecay/s]
    [2, 0.32, 1.4,  0.12 ],
    [3, 0.17, 2.6,  0.22 ],
    [4, 0.09, 4.2,  0.38 ],
    [5, 0.05, 6.5,  0.60 ],
    [6, 0.027,9.5,  0.90 ],
    [7, 0.013,13.0, 1.30 ],
    [8, 0.006,17.0, 1.80 ],
  ];

  // Piano strings are stiffer than harp → higher inharmonicity
  const B = 0.00025 * Math.max(1, freq / 261.63);
  const phi = Math.random() * Math.PI * 2;
  const fadeIn = Math.round(sr * 0.002);  // 2 ms crisp attack

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;

    partials.forEach(([n, amp, fastDc, slowDc]) => {
      const f = freq * n * Math.sqrt(1 + B * n * n);
      if (f >= sr * 0.45) return;
      // Dual-decay: fast initial decay blends into slow sustain
      const env = amp * (0.45 * Math.exp(-fastDc * t) + 0.55 * Math.exp(-slowDc * t));
      s += env * Math.sin(2 * Math.PI * f * t + phi * n * 0.04);
    });

    // Hammer transient: sharp noise burst at attack
    if (i < Math.round(sr * 0.018)) {
      const atkNorm = i / Math.round(sr * 0.018);
      s += (Math.random() * 2 - 1) * 0.10 * velocity * Math.exp(-atkNorm * 8);
    }

    if (i < fadeIn) s *= i / fadeIn;
    d[i] = s * velocity;
  }

  // Normalize with fade-out tail
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.01) {
    const fo = Math.min(sr * 0.6, len);
    for (let i = 0; i < len; i++) {
      d[i] = d[i] / peak * 0.72;
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

const SLEEP_MOODS = [
  { id: 'bedroom',  label: '深夜の寝室',         icon: '🌙', desc: '静かな寝室でゆっくりと' },
  { id: 'noise',    label: '騒音をマスクして',   icon: '🔇', desc: '外の音を遮断して眠る' },
  { id: 'transit',  label: '移動中の仮眠',        icon: '🚃', desc: '電車・飛行機でうとうと' },
  { id: 'hotel',    label: 'ホテルでの眠り',      icon: '🏨', desc: '慣れない場所でも深く眠る' },
  { id: 'powernap', label: 'パワーナップ',        icon: '⚡', desc: '20分の最高の仮眠' },
];

const PRESLEEP_MOODS = [
  { id: 'bath',      label: '入浴中',       icon: '🛁', desc: 'お風呂でゆっくりと' },
  { id: 'afterbath', label: '入浴後',        icon: '✨', desc: '湯上がりのリラックスタイム' },
  { id: 'bedprep',   label: '就寝準備',      icon: '🌙', desc: '眠りに向けて体を整える' },
  { id: 'reading',   label: '読書・スマホオフ', icon: '📖', desc: '静かな時間で心を落ち着かせる' },
  { id: 'stretch',   label: 'ストレッチ',    icon: '🧘', desc: '体をほぐして眠りへ' },
];

const WALK_MOODS = [
  { id: 'park',    label: '公園・緑地',     icon: '🌲', desc: '木々の中をゆっくり歩く' },
  { id: 'urban',   label: '都会の通勤路',   icon: '🌆', desc: '街中でも自然を感じながら' },
  { id: 'seaside', label: '海辺の散歩',     icon: '🏖️', desc: '波音を感じながら歩く' },
  { id: 'mountain',label: '山道・ハイキング',icon: '⛰️', desc: '山の空気を感じながら' },
  { id: 'night',   label: '夜の散歩',      icon: '🌙', desc: '静かな夜に一人でゆっくりと' },
];

// ─── Just Intonation Frequencies ────────────────────────────────────────────
// Root: C4 = 264 Hz → A4 = 440 Hz (standard pitch) → C5 = 528 Hz (solfeggio)
// All intervals are pure integer ratios. No equal-temperament approximations.
const JI = {
  // Octave 2
  C2: 66,   F2: 88,   G2: 99,   A2: 110,
  // Octave 3
  C3: 132,  D3: 148.5, E3: 165,  F3: 176,  G3: 198,  A3: 220,  B3: 247.5,
  // Octave 3 sharps (A major / D major context)
  Cs3: 137.5, Fs3: 183.33, Gs3: 206.25,
  // Octave 4
  C4: 264,  D4: 297,  E4: 330,  F4: 352,  G4: 396,  A4: 440,  B4: 495,
  // Octave 4 sharps
  Cs4: 275,  Fs4: 366.67, Gs4: 412.5,
  // D major F#4 (= D4 × 5/4 = 297 × 5/4 = 371.25, slightly different from A-major F#4=366.67)
  Fs4d: 371.25,
  // Octave 5
  C5: 528,  D5: 594,  E5: 660,  G5: 792,  A5: 880,
  Cs5: 550, Fs5: 733.33,
};
// Convenient aliases
const _ = JI;  // so presets can write _.C4, _.E4, etc.

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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.60 },
          { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:24000, vol:0.56 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.60 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396], vol:0.62 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [132, null, 198, null, 247.5],
              [null, 165, null, 198, null],
              [198, null, 247.5, null, 132],
              [null, 132, null, 165, null],
            ], bpm:20, startDelay:4, vol:0.46 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [132,  null, null, null, 264,  null, null, null],
              [null, null, 198,  null, null, null, 330,  null],
              [264,  null, null, null, 198,  null, null, 132 ],
              [null, 165,  null, null, null, 247.5,null, null],
            ], bpm:9, startDelay:7, vol:0.34 },
          { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:24000, vol:0.56 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.60 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396], vol:0.62 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [132, null, 198, null, 247.5],
              [null, 165, null, 198, null],
              [198, null, 247.5, null, 132],
              [null, 132, null, 165, null],
            ], bpm:20, startDelay:4, vol:0.46 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [132,  null, null, null, 264,  null, null, null],
              [null, null, 198,  null, null, null, 330,  null],
              [264,  null, null, null, 198,  null, null, 132 ],
              [null, 165,  null, null, null, 247.5,null, null],
            ], bpm:9, startDelay:7, vol:0.34 },
          { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:24000, vol:0.56 },
          { type:'ocean', name:'波の音', icon:'🌊', vol:0.22 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural',  name:'バイノーラル θ波 7Hz', icon:'〜', base:200, beat:7, vol:0.58 },
          { type:'noise',     name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.40 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural',  name:'バイノーラル θ波 7Hz', icon:'〜', base:200, beat:7, vol:0.58 },
          { type:'noise',     name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.40 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396], vol:0.58 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [132, 198, null, 247.5, null],
              [null, 165, 198, null, 132],
              [198, null, 247.5, 165, null],
              [132, null, 198, null, 247.5],
            ], bpm:22, startDelay:5, vol:0.42 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.52 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル θ波 7Hz', icon:'〜', base:200, beat:7, vol:0.58 },
          { type:'noise',     name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.40 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396], vol:0.58 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [132, 198, null, 247.5, null],
              [null, 165, 198, null, 132],
              [198, null, 247.5, 165, null],
              [132, null, 198, null, 247.5],
            ], bpm:22, startDelay:5, vol:0.42 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.52 },
          { type:'rain', name:'雨音', icon:'🌧️', vol:0.28 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル θ波 5Hz', icon:'〜', base:180, beat:5, vol:0.60 },
          { type:'noise',    name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.34 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル θ波 5Hz', icon:'〜', base:180, beat:5, vol:0.60 },
          { type:'noise',    name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.34 },
          { type:'harp',     name:'ハープ',                icon:'🪕',
            patterns:[
              [132, null, 198, null, null],
              [null, 165, null, 247.5, null],
              [198, null, null, 165, null],
              [null, 132, 198, null, 165],
            ], bpm:18, startDelay:3, vol:0.50 },
          { type:'pad',  name:'弦楽器パッド',  icon:'🎻', freqs:[264,330,396], vol:0.54 },
          { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:30000, vol:0.48 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル θ波 5Hz', icon:'〜', base:180, beat:5, vol:0.60 },
          { type:'noise',    name:'ブラウンノイズ',        icon:'🌫️', noiseType:'brown', vol:0.34 },
          { type:'harp',     name:'ハープ',                icon:'🪕',
            patterns:[
              [132, null, 198, null, null],
              [null, 165, null, 247.5, null],
              [198, null, null, 165, null],
              [null, 132, 198, null, 165],
            ], bpm:18, startDelay:3, vol:0.50 },
          { type:'pad',  name:'弦楽器パッド',  icon:'🎻', freqs:[264,330,396], vol:0.54 },
          { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:30000, vol:0.48 },
          { type:'rain', name:'雨音', icon:'🌧️', vol:0.26 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.50 },
          { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.64 },
          { type:'ocean', name:'波の音', icon:'🌊', vol:0.30 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.50 },
          { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.64 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396,528], vol:0.68 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [132, 165, 198, null, 247.5],
              [264, null, 198, 165, null],
              [132, null, 247.5, null, 198],
              [165, 198, null, 247.5, null],
            ], bpm:18, startDelay:5, vol:0.48 },
          { type:'ocean', name:'波の音', icon:'🌊', vol:0.30 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル θ波 6Hz', icon:'〜', base:200, beat:6, vol:0.50 },
          { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.64 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396,528], vol:0.68 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [132, 165, 198, null, 247.5],
              [264, null, 198, 165, null],
              [132, null, 247.5, null, 198],
              [165, 198, null, 247.5, null],
            ], bpm:18, startDelay:5, vol:0.48 },
          { type:'ocean', name:'波の音', icon:'🌊', vol:0.30 },
          { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:28000, vol:0.42 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural',  name:'バイノーラル θ波 8Hz', icon:'〜', base:220, beat:8, vol:0.55 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.58 },
          { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:18000, vol:0.50 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural',  name:'バイノーラル θ波 8Hz', icon:'〜', base:220, beat:8, vol:0.55 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396], vol:0.56 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [198, 247.5, 330, null, 396],
              [264, 330, null, 396, 330],
              [247.5, null, 330, 264, null],
              [198, 264, null, 330, null],
            ], bpm:26, startDelay:3, vol:0.50 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [132,  null, null, null, 264,  null, null, null],
              [null, null, 198,  null, null, null, 330,  null],
              [264,  null, null, null, 198,  null, null, 132 ],
              [null, 165,  null, null, null, 247.5,null, null],
            ], bpm:9, startDelay:7, vol:0.34 },
          { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:18000, vol:0.50 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.58 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル θ波 8Hz', icon:'〜', base:220, beat:8, vol:0.55 },
          { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396], vol:0.56 },
          { type:'harp',      name:'ハープ',                icon:'🪕',
            patterns:[
              [198, 247.5, 330, null, 396],
              [264, 330, null, 396, 330],
              [247.5, null, 330, 264, null],
              [198, 264, null, 330, null],
            ], bpm:26, startDelay:3, vol:0.50 },
          { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:18000, vol:0.50 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.58 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.24 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.50 },
          { type:'organ',     name:'オルガン',           icon:'🎹', baseFreq:98.0, vol:0.52 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.50 },
          { type:'organ',     name:'オルガン',           icon:'🎹', baseFreq:99.0, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.54 },
          { type:'harp',      name:'ハープ',            icon:'🪕',
            patterns:[
              [132, null, 176, null, null],
              [null, 198, null, 132, null],
              [176, null, null, 264, null],
              [132, null, 198, null, null],
            ], bpm:15, startDelay:7, vol:0.38 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [132,  null, null, null, null, null, 198,  null],
              [null, null, null, 165,  null, null, null, null],
              [132,  null, null, null, 198,  null, null, null],
              [null, null, 132,  null, null, null, null, 165 ],
            ], bpm:7, startDelay:10, vol:0.32 },
          { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:22000, vol:0.46 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.50 },
          { type:'organ',     name:'オルガン',           icon:'🎹', baseFreq:99.0, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.54 },
          { type:'harp',      name:'ハープ',             icon:'🪕',
            patterns:[[132,null,176,null,null],[null,198,null,132,null],[176,null,null,264,null],[132,null,198,null,null]],
            bpm:15, startDelay:7, vol:0.38 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [132,  null, null, null, null, null, 198,  null],
              [null, null, null, 165,  null, null, null, null],
              [132,  null, null, null, 198,  null, null, null],
              [null, null, 132,  null, null, null, null, 165 ],
            ], bpm:7, startDelay:10, vol:0.32 },
          { type:'bowl',      name:'チベタンボウル',      icon:'🔔', interval:22000, vol:0.46 },
          { type:'wind',      name:'風の音',              icon:'🍃', vol:0.16 },
        ]},
        { name: 'ジャーニー', journey: true, layers: [
          { type:'binaural', name:'バイノーラル α→δ旅', icon:'〜', base:264, beat:8, driftTo:1.0, driftDuration:3600, vol:0.52 },
          { type:'organ',    name:'オルガン',            icon:'🎹', baseFreq:98.0, vol:0.40 },
          { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.28 },
          { type:'harp',     name:'ハープ',              icon:'🪕',
            patterns:[[132,null,176,null,null],[null,198,null,132,null],[176,null,null,264,null],[null,132,null,198,null]],
            bpm:10, startDelay:10, vol:0.28 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.55 },
          { type:'rain',     name:'雨音',              icon:'🌧️', vol:0.55 },
          { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.38 },
        ]},
        { name:'スタンダード', layers: [
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
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.55 },
          { type:'rain',     name:'雨音',              icon:'🌧️', vol:0.55 },
          { type:'stream',   name:'川の流れ',           icon:'💧', vol:0.40 },
          { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.38 },
          { type:'harp',     name:'ハープ',            icon:'🪕',
            patterns:[[132,null,null,176,null],[null,null,198,null,null],[176,null,132,null,null],[null,198,null,null,176]],
            bpm:15, startDelay:10, vol:0.32 },
          { type:'organ',    name:'オルガン',           icon:'🎹', baseFreq:66.0, vol:0.28 },
        ]},
        { name: 'ジャーニー', journey: true, layers: [
          { type:'binaural', name:'バイノーラル α→δ旅', icon:'〜', base:264, beat:8, driftTo:1.0, driftDuration:3600, vol:0.55 },
          { type:'rain',     name:'雨音',               icon:'🌧️', vol:0.52 },
          { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.38 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:1.5, driftDuration:3000, vol:0.58 },
          { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.40 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:1.5, driftDuration:3000, vol:0.58 },
          { type:'rain',     name:'雨音',              icon:'🌧️', vol:0.54 },
          { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.40 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:1.5, driftDuration:3000, vol:0.58 },
          { type:'rain',     name:'雨音',              icon:'🌧️', vol:0.54 },
          { type:'noise',    name:'ブラウンノイズ',     icon:'🌫️', noiseType:'brown', vol:0.40 },
          { type:'stream',   name:'川の流れ',           icon:'💧', vol:0.24 },
          { type:'harp',     name:'ハープ',            icon:'🪕',
            patterns:[[132,null,176,null,null],[null,198,null,132,null],[176,null,null,264,null],[132,null,198,null,null]],
            bpm:12, startDelay:10, vol:0.28 },
        ]},
        { name: 'ジャーニー', journey: true, layers: [
          { type:'binaural', name:'バイノーラル α→δ旅', icon:'〜', base:264, beat:8, driftTo:1.0, driftDuration:3600, vol:0.56 },
          { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.42 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.44 },
          { type:'fire',     name:'焚き火',             icon:'🔥', vol:0.62 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.44 },
          { type:'fire',     name:'焚き火',             icon:'🔥', vol:0.62 },
          { type:'organ',    name:'オルガン',            icon:'🎹', baseFreq:66.0, vol:0.46 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:6, driftTo:2, driftDuration:2400, vol:0.44 },
          { type:'fire',     name:'焚き火',             icon:'🔥', vol:0.55 },
          { type:'organ',    name:'オルガン',            icon:'🎹', baseFreq:66.0, vol:0.46 },
          { type:'noise',    name:'ブラウンノイズ',      icon:'🌫️', noiseType:'brown', vol:0.24 },
          { type:'bowl',     name:'チベタンボウル',      icon:'🔔', interval:28000, vol:0.36 },
        ]},
        { name: 'ジャーニー', journey: true, layers: [
          { type:'binaural', name:'バイノーラル α→δ旅', icon:'〜', base:264, beat:8, driftTo:1.0, driftDuration:3600, vol:0.50 },
          { type:'fire',     name:'焚き火',             icon:'🔥', vol:0.46 },
          { type:'organ',    name:'オルガン',            icon:'🎹', baseFreq:66.0, vol:0.36 },
          { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.22 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural',  name:'バイノーラル α→δ',  icon:'〜', base:264, beat:9, driftTo:2, driftDuration:2400, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.60 },
          { type:'stream',    name:'川の流れ',           icon:'💧', vol:0.38 },
        ]},
        { name:'スタンダード', layers: [
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
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル α→δ',  icon:'〜', base:264, beat:9, driftTo:2, driftDuration:2400, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.60 },
          { type:'pad',       name:'弦楽器パッド',       icon:'🎻', freqs:[264,330,396], vol:0.54 },
          { type:'stream',    name:'川の流れ',           icon:'💧', vol:0.38 },
          { type:'wind',      name:'風の音',             icon:'🍃', vol:0.28 },
          { type:'harp',      name:'ハープ',            icon:'🪕',
            patterns:[[132,null,198,null,null],[null,176,null,null,132],[264,null,null,176,null],[null,132,null,198,null]],
            bpm:15, startDelay:8, vol:0.38 },
        ]},
        { name: 'ジャーニー', journey: true, napMode: true, layers: [
          { type:'binaural', name:'バイノーラル α→θ旅', icon:'〜', base:256, beat:9, driftTo:4.0, driftDuration:1200, vol:0.54 },
          { type:'noise',    name:'ピンクノイズ',        icon:'🌫️', noiseType:'pink', vol:0.36 },
          { type:'stream',   name:'川の流れ',            icon:'💧', vol:0.30 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.32 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.32 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.60 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, 220, null, 293.66, null],
              [183.33, null, 220, null, 367.08],
              [293.66, 220, null, 183.33, 220],
              [null, 148.5, 220, null, 293.66],
            ], bpm:35, startDelay:3, vol:0.46 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [148.5, null, null, null, 293.66, null, null, null],
              [null,  null, 220,  null, null,   null, 293.66,null],
              [293.66,null, null, 220,  null,   null, null,  148.5],
              [null,  148.5,null, null, null,   220,  null,  null ],
            ], bpm:11, startDelay:6, vol:0.34 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.28 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.32 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.60 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, 220, null, 293.66, null],
              [183.33, null, 220, null, 367.08],
              [293.66, 220, null, 183.33, 220],
              [null, 148.5, 220, null, 293.66],
            ], bpm:35, startDelay:3, vol:0.46 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [148.5, null, null, null, 293.66, null, null, null],
              [null,  null, 220,  null, null,   null, 293.66,null],
              [293.66,null, null, 220,  null,   null, null,  148.5],
              [null,  148.5,null, null, null,   220,  null,  null ],
            ], bpm:11, startDelay:6, vol:0.34 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.28 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.34 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.55 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.48 },
          { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.35 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.55 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.48 },
          { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.35 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.54 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, null, 220, null, 293.66],
              [null, 183.33, null, 220, null],
              [220, null, 293.66, null, 183.33],
              [null, 148.5, null, 220, null],
            ], bpm:35, startDelay:4, vol:0.40 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.55 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.48 },
          { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.35 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.54 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, null, 220, null, 293.66],
              [null, 183.33, null, 220, null],
              [220, null, 293.66, null, 183.33],
              [null, 148.5, null, 220, null],
            ], bpm:35, startDelay:4, vol:0.40 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.20 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル α波 12Hz', icon:'〜', base:200, beat:12, vol:0.58 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.46 },
          { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.30 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル α波 12Hz', icon:'〜', base:200, beat:12, vol:0.58 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.46 },
          { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.30 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.54 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, 220, null, 293.66, null],
              [220, null, 293.66, null, 183.33],
              [null, 183.33, 220, null, 293.66],
              [293.66, null, 220, 148.5, null],
            ], bpm:30, startDelay:4, vol:0.38 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル α波 12Hz', icon:'〜', base:200, beat:12, vol:0.58 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.46 },
          { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.30 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.54 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, 220, null, 293.66, null],
              [220, null, 293.66, null, 183.33],
              [null, 183.33, 220, null, 293.66],
              [293.66, null, 220, 148.5, null],
            ], bpm:30, startDelay:4, vol:0.38 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.22 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.26 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.26 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440,594], vol:0.64 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, 220, 183.33, null, 293.66],
              [183.33, 220, null, 367.08, 293.66],
              [293.66, null, 220, 183.33, null],
              [null, 148.5, 220, null, 367.08],
            ], bpm:30, startDelay:4, vol:0.48 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.26 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.50 },
          { type:'noise',    name:'ピンクノイズ',           icon:'🌫️', noiseType:'pink', vol:0.26 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440,594], vol:0.64 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [148.5, 220, 183.33, null, 293.66],
              [183.33, 220, null, 367.08, 293.66],
              [293.66, null, 220, 183.33, null],
              [null, 148.5, 220, null, 367.08],
            ], bpm:30, startDelay:4, vol:0.48 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [148.5, null, null, null, 293.66, null, null, null],
              [null,  null, 220,  null, null,   null, 293.66,null],
              [293.66,null, null, 220,  null,   null, null,  148.5],
              [null,  148.5,null, null, null,   220,  null,  null ],
            ], bpm:11, startDelay:6, vol:0.34 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.26 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.38 },
        ]},
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
      presets: [
        { name:'ライト', layers: [
          { type:'binaural', name:'バイノーラル α波 14Hz', icon:'〜', base:220, beat:14, vol:0.55 },
          { type:'noise', name:'ピンクノイズ', icon:'🌫️', noiseType:'pink', vol:0.32 },
        ]},
        { name:'スタンダード', layers: [
          { type:'binaural', name:'バイノーラル α波 14Hz', icon:'〜', base:220, beat:14, vol:0.55 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.58 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [220, 293.66, 367.08, null, 440],
              [293.66, 367.08, null, 440, 367.08],
              [183.33, 220, 293.66, null, 367.08],
              [440, null, 367.08, 293.66, null],
            ], bpm:42, startDelay:2, vol:0.54 },
          { type:'noise', name:'ピンクノイズ', icon:'🌫️', noiseType:'pink', vol:0.32 },
          { type:'bowl',  name:'チベタンボウル', icon:'🔔', interval:20000, vol:0.48 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural', name:'バイノーラル α波 14Hz', icon:'〜', base:220, beat:14, vol:0.55 },
          { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[293.66,367.08,440], vol:0.58 },
          { type:'harp',     name:'ハープ',                 icon:'🪕',
            patterns:[
              [220, 293.66, 367.08, null, 440],
              [293.66, 367.08, null, 440, 367.08],
              [183.33, 220, 293.66, null, 367.08],
              [440, null, 367.08, 293.66, null],
            ], bpm:42, startDelay:2, vol:0.54 },
          { type:'noise', name:'ピンクノイズ', icon:'🌫️', noiseType:'pink', vol:0.32 },
          { type:'bowl',  name:'チベタンボウル', icon:'🔔', interval:20000, vol:0.48 },
          { type:'stream', name:'川の流れ', icon:'💧', vol:0.26 },
        ]},
      ]
    },
  ],
};

const TIMER_OPTIONS = {
  meditation: [{l:'なし',m:0},{l:'10分',m:10},{l:'20分',m:20},{l:'30分',m:30},{l:'60分',m:60}],
  sleep:      [{l:'なし',m:0},{l:'20分(仮眠)',m:20},{l:'90分',m:90},{l:'3時間',m:180},{l:'4.5時間',m:270},{l:'6時間',m:360},{l:'7.5時間',m:450},{l:'9時間',m:540}],
  focus:      [{l:'なし',m:0},{l:'25分',m:25},{l:'50分',m:50},{l:'90分',m:90}],
  morning:    [{l:'なし',m:0},{l:'15分',m:15},{l:'30分',m:30},{l:'60分',m:60}],
  relax:      [{l:'なし',m:0},{l:'15分',m:15},{l:'30分',m:30},{l:'45分',m:45},{l:'60分',m:60}],
  presleep: [{l:'なし',m:0},{l:'30分',m:30},{l:'45分',m:45},{l:'60分',m:60},{l:'90分',m:90}],
  walk: [{l:'なし',m:0},{l:'15分',m:15},{l:'30分',m:30},{l:'45分',m:45},{l:'60分',m:60}],
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
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.40 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,275,330,440], vol:0.55 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 275, null, 330, null],
            [null, 330, 440, null, 550],
            [275, null, 330, null, 440],
            [220, null, 275, 330, null],
          ], bpm:20, startDelay:4, vol:0.48 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [110,  null, null, null, 220,  null, null, null],
            [null, null, 165,  null, null, null, 275,  null],
            [220,  null, null, 165,  null, null, null, 110 ],
            [null, 110,  null, null, null, 220,  null, null],
          ], bpm:12, startDelay:6, vol:0.34 },
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.40 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.24 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,275,330,440], vol:0.55 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 275, null, 330, null],
            [null, 330, 440, null, 550],
            [275, null, 330, null, 440],
            [220, null, 275, 330, null],
          ], bpm:20, startDelay:4, vol:0.48 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [110,  null, null, null, 220,  null, null, null],
            [null, null, 165,  null, null, null, 275,  null],
            [220,  null, null, 165,  null, null, null, 110 ],
            [null, 110,  null, null, null, 220,  null, null],
          ], bpm:12, startDelay:6, vol:0.34 },
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.40 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.24 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.28 },
      ]},
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
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.52 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.38 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.52 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.38 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, null, 330, null, 440],
            [275, 330, null, 440, null],
            [null, 220, 275, null, 330],
            [330, null, 440, 330, null],
          ], bpm:22, startDelay:4, vol:0.46 },
        { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.30 },
        { type:'pad',   name:'弦楽器パッド',   icon:'🎻', freqs:[220,275,330,440], vol:0.48 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.52 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.38 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, null, 330, null, 440],
            [275, 330, null, 440, null],
            [null, 220, 275, null, 330],
            [330, null, 440, 330, null],
          ], bpm:22, startDelay:4, vol:0.46 },
        { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.30 },
        { type:'pad',   name:'弦楽器パッド',   icon:'🎻', freqs:[220,275,330,440], vol:0.48 },
        { type:'stream', name:'川の流れ', icon:'💧', vol:0.18 },
      ]},
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
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.55 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.36 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.55 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.36 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 330, null, 440, null],
            [275, null, 330, null, 550],
            [220, null, 275, 330, null],
            [330, 440, null, 330, null],
          ], bpm:22, startDelay:3, vol:0.48 },
        { type:'pad',    name:'弦楽器パッド', icon:'🎻', freqs:[220,275,330,440], vol:0.52 },
        { type:'stream', name:'川の流れ',     icon:'💧', vol:0.20 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.55 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.36 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 330, null, 440, null],
            [275, null, 330, null, 550],
            [220, null, 275, 330, null],
            [330, 440, null, 330, null],
          ], bpm:22, startDelay:3, vol:0.48 },
        { type:'pad',    name:'弦楽器パッド', icon:'🎻', freqs:[220,275,330,440], vol:0.52 },
        { type:'stream', name:'川の流れ',     icon:'💧', vol:0.20 },
        { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.22 },
      ]},
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
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
        { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.36 },
        { type:'pad',   name:'弦楽器パッド',   icon:'🎻', freqs:[220,275,330,440,550], vol:0.58 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,275,330,440,550], vol:0.58 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 275, 330, null, 440],
            [330, 440, null, 550, 440],
            [220, null, 330, 440, null],
            [275, 330, null, 440, null],
          ], bpm:18, startDelay:5, vol:0.50 },
        { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.36 },
        { type:'wind',  name:'風の音',         icon:'🍃', vol:0.18 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:200, beat:8, driftTo:14, driftDuration:1200, vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,275,330,440,550], vol:0.58 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 275, 330, null, 440],
            [330, 440, null, 550, 440],
            [220, null, 330, 440, null],
            [275, 330, null, 440, null],
          ], bpm:18, startDelay:5, vol:0.50 },
        { type:'birds', name:'小鳥のさえずり', icon:'🐦', vol:0.36 },
        { type:'wind',  name:'風の音',         icon:'🍃', vol:0.18 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:30000, vol:0.32 },
      ]},
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
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:210, beat:10, driftTo:16, driftDuration:900, vol:0.52 },
        { type:'noise',    name:'ピンクノイズ',      icon:'🌫️', noiseType:'pink', vol:0.32 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:210, beat:10, driftTo:16, driftDuration:900, vol:0.52 },
        { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,330,440,550], vol:0.58 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 330, 440, null, 550],
            [330, 440, 550, null, 660],
            [220, 275, 330, 440, null],
            [440, 550, null, 660, null],
          ], bpm:26, startDelay:3, vol:0.54 },
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.38 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.22 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α→β', icon:'〜', base:210, beat:10, driftTo:16, driftDuration:900, vol:0.52 },
        { type:'pad',      name:'弦楽器パッド',      icon:'🎻', freqs:[220,330,440,550], vol:0.58 },
        { type:'harp',     name:'ハープ',            icon:'🪕',
          patterns:[
            [220, 330, 440, null, 550],
            [330, 440, 550, null, 660],
            [220, 275, 330, 440, null],
            [440, 550, null, 660, null],
          ], bpm:26, startDelay:3, vol:0.54 },
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.38 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.22 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.30 },
      ]},
    ]
  },
];

// C major pentatonic (calm): C4=261.63 E4=329.63 G4=392 A4=440 C5=523.25
PRESETS.relax = [
  // 0: 家で静かに — 深海の静寂: α波 + 波 + 弦楽パッド + ハープ + ボウル
  {
    breathe: [
      { idx:0, min:0.38, max:0.54 },
      { idx:1, min:0.44, max:0.62 },
      { idx:2, min:0.40, max:0.58 },
      { idx:3, min:0.26, max:0.46 },
      { idx:4, min:0.30, max:0.50 },
    ],
    breatheInterval: 230,
    presets: [
      { name:'ライト', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz',  icon:'〜', base:180, beat:8, vol:0.46 },
        { type:'ocean',     name:'波の音',                icon:'🌊', vol:0.56 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz',  icon:'〜', base:180, beat:8, vol:0.46 },
        { type:'ocean',     name:'波の音',                icon:'🌊', vol:0.56 },
        { type:'pad',       name:'弦楽器パッド',           icon:'🎻', freqs:[264,330,396,528], vol:0.52 },
        { type:'harp',      name:'ハープ',                 icon:'🪕',
          patterns:[
            [264, null, 396, null, null],
            [null, 330, null, 264, null],
            [396, null, null, 330, null],
            [null, 264, null, null, 528],
          ], bpm:16, startDelay:6, vol:0.40 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [132,  null, null, null, 264,  null, null, null],
            [null, null, 198,  null, null, null, 264,  null],
            [264,  null, null, 198,  null, null, null, 132 ],
            [null, 165,  null, null, null, 198,  null, null],
          ], bpm:10, startDelay:8, vol:0.34 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:26000, vol:0.50 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz',  icon:'〜', base:180, beat:8, vol:0.46 },
        { type:'ocean',     name:'波の音',                icon:'🌊', vol:0.56 },
        { type:'pad',       name:'弦楽器パッド',           icon:'🎻', freqs:[264,330,396,528], vol:0.52 },
        { type:'harp',      name:'ハープ',                 icon:'🪕',
          patterns:[
            [264, null, 396, null, null],
            [null, 330, null, 264, null],
            [396, null, null, 330, null],
            [null, 264, null, null, 528],
          ], bpm:16, startDelay:6, vol:0.40 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [132,  null, null, null, 264,  null, null, null],
            [null, null, 198,  null, null, null, 264,  null],
            [264,  null, null, 198,  null, null, null, 132 ],
            [null, 165,  null, null, null, 198,  null, null],
          ], bpm:10, startDelay:8, vol:0.34 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:26000, vol:0.50 },
        { type:'rain', name:'雨音', icon:'🌧️', vol:0.22 },
      ]},
    ]
  },
  // 1: 外で騒がしい中で — 雨音リラックス: α波 + 雨音 + ブラウン + 弦楽パッド + ハープ
  {
    breathe: [
      { idx:0, min:0.42, max:0.58 },
      { idx:1, min:0.48, max:0.66 },
      { idx:2, min:0.34, max:0.52 },
      { idx:3, min:0.36, max:0.56 },
      { idx:4, min:0.24, max:0.44 },
    ],
    breatheInterval: 195,
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.50 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.58 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.34 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.50 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.58 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.34 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[264,330,396], vol:0.48 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [264, null, null, 330, null],
            [null, 396, null, 264, null],
            [330, null, 264, null, null],
            [null, null, 396, null, 264],
          ], bpm:14, startDelay:8, vol:0.34 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.50 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.58 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.34 },
        { type:'pad',      name:'弦楽器パッド',           icon:'🎻', freqs:[264,330,396], vol:0.48 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [264, null, null, 330, null],
            [null, 396, null, 264, null],
            [330, null, 264, null, null],
            [null, null, 396, null, 264],
          ], bpm:14, startDelay:8, vol:0.34 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [132,  null, null, null, 264,  null, null, null],
            [null, null, 198,  null, null, null, 264,  null],
            [264,  null, null, 198,  null, null, null, 132 ],
            [null, 165,  null, null, null, 198,  null, null],
          ], bpm:10, startDelay:8, vol:0.34 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:24000, vol:0.44 },
      ]},
    ]
  },
  // 2: 移動中に — 静かな雨: α波 + 雨音 + ブラウン + ハープ
  {
    breathe: [
      { idx:0, min:0.44, max:0.60 },
      { idx:1, min:0.44, max:0.62 },
      { idx:2, min:0.32, max:0.50 },
      { idx:3, min:0.30, max:0.48 },
    ],
    breatheInterval: 175,
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.52 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.55 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.52 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.55 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.38 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [264, null, 330, null, null],
            [null, 396, null, null, 264],
            [330, null, null, 264, null],
            [null, 264, null, 396, null],
          ], bpm:13, startDelay:7, vol:0.36 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.52 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.55 },
        { type:'noise',    name:'ブラウンノイズ',         icon:'🌫️', noiseType:'brown', vol:0.38 },
        { type:'harp',     name:'ハープ',                 icon:'🪕',
          patterns:[
            [264, null, 330, null, null],
            [null, 396, null, null, 264],
            [330, null, null, 264, null],
            [null, 264, null, 396, null],
          ], bpm:13, startDelay:7, vol:0.36 },
        { type:'ocean', name:'波の音', icon:'🌊', vol:0.30 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:26000, vol:0.36 },
      ]},
    ]
  },
  // 3: ホテルで自宅のように — リゾート海辺: α波 + 波 + 528Hz + 弦楽パッド + ハープ
  {
    breathe: [
      { idx:0, min:0.36, max:0.52 },
      { idx:1, min:0.48, max:0.66 },
      { idx:2, min:0.50, max:0.68 },
      { idx:3, min:0.30, max:0.50 },
      { idx:4, min:0.22, max:0.42 },
    ],
    breatheInterval: 245,
    presets: [
      { name:'ライト', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.44 },
        { type:'ocean',     name:'波の音',               icon:'🌊', vol:0.58 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',   icon:'✦',  vol:0.52 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.44 },
        { type:'ocean',     name:'波の音',               icon:'🌊', vol:0.58 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',   icon:'✦',  vol:0.52 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396,528], vol:0.56 },
        { type:'harp',      name:'ハープ',                icon:'🪕',
          patterns:[
            [264, 330, null, 396, null],
            [330, null, 396, null, 264],
            [null, 264, null, 330, 528],
            [396, null, 330, 264, null],
          ], bpm:17, startDelay:7, vol:0.40 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.44 },
        { type:'ocean',     name:'波の音',               icon:'🌊', vol:0.58 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',   icon:'✦',  vol:0.52 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[264,330,396,528], vol:0.56 },
        { type:'harp',      name:'ハープ',                icon:'🪕',
          patterns:[
            [264, 330, null, 396, null],
            [330, null, 396, null, 264],
            [null, 264, null, 330, 528],
            [396, null, 330, 264, null],
          ], bpm:17, startDelay:7, vol:0.40 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [132,  null, null, null, 264,  null, null, null],
            [null, null, 198,  null, null, null, 264,  null],
            [264,  null, null, 198,  null, null, null, 132 ],
            [null, 165,  null, null, null, 198,  null, null],
          ], bpm:10, startDelay:8, vol:0.34 },
        { type:'bowl', name:'チベタンボウル', icon:'🔔', interval:26000, vol:0.44 },
      ]},
    ]
  },
  // 4: これから勝負の準備 — 試合前の静息: α波 + 川 + 弦楽パッド + ボウル + ハープ
  {
    breathe: [
      { idx:0, min:0.40, max:0.58 },
      { idx:1, min:0.44, max:0.62 },
      { idx:2, min:0.42, max:0.60 },
      { idx:3, min:0.28, max:0.48 },
      { idx:4, min:0.26, max:0.46 },
    ],
    breatheInterval: 205,
    presets: [
      { name:'ライト', layers: [
        { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.48 },
        { type:'stream',   name:'川の流れ',               icon:'💧', vol:0.46 },
      ]},
      { name:'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.48 },
        { type:'stream',   name:'川の流れ',               icon:'💧', vol:0.46 },
        { type:'pad',      name:'弦楽器パッド',            icon:'🎻', freqs:[264,330,396], vol:0.52 },
        { type:'bowl',     name:'チベタンボウル',           icon:'🔔', interval:20000, vol:0.48 },
        { type:'harp',     name:'ハープ',                  icon:'🪕',
          patterns:[
            [264, null, 396, null, 330],
            [null, 330, null, 264, null],
            [396, null, 264, null, null],
            [null, 264, 330, null, 396],
          ], bpm:20, startDelay:6, vol:0.38 },
      ]},
      { name:'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α波 10Hz', icon:'〜', base:200, beat:10, vol:0.48 },
        { type:'stream',   name:'川の流れ',               icon:'💧', vol:0.46 },
        { type:'pad',      name:'弦楽器パッド',            icon:'🎻', freqs:[264,330,396], vol:0.52 },
        { type:'bowl',     name:'チベタンボウル',           icon:'🔔', interval:20000, vol:0.48 },
        { type:'harp',     name:'ハープ',                  icon:'🪕',
          patterns:[
            [264, null, 396, null, 330],
            [null, 330, null, 264, null],
            [396, null, 264, null, null],
            [null, 264, 330, null, 396],
          ], bpm:20, startDelay:6, vol:0.38 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [132,  null, null, null, 264,  null, null, null],
            [null, null, 198,  null, null, null, 264,  null],
            [264,  null, null, 198,  null, null, null, 132 ],
            [null, 165,  null, null, null, 198,  null, null],
          ], bpm:10, startDelay:8, vol:0.34 },
        { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦', vol:0.40 },
      ]},
    ]
  },
];

// F major pentatonic: F3=174.61, A3=220, C4=261.63, F4=349.23, A4=440, C5=523.25
PRESETS.presleep = [
  // 0: 入浴中 — お風呂でのんびり: α波 + 川の流れ + 弦楽パッド + ハープ
  {
    breathe: [
      { idx:0, min:0.40, max:0.56 },
      { idx:1, min:0.46, max:0.64 },
      { idx:2, min:0.42, max:0.60 },
      { idx:3, min:0.28, max:0.48 },
    ],
    breatheInterval: 200,
    presets: [
      { name: 'ライト', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.50 },
        { type:'stream',   name:'川の流れ',             icon:'💧', vol:0.58 },
      ]},
      { name: 'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.50 },
        { type:'stream',   name:'川の流れ',             icon:'💧', vol:0.54 },
        { type:'pad',      name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.50 },
        { type:'harp',     name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, 264, null, null],
            [null, 220, null, 176, null],
            [264, null, null, 220, null],
            [null, 176, null, null, 352],
          ], bpm:14, startDelay:6, vol:0.40 },
      ]},
      { name: 'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.50 },
        { type:'stream',   name:'川の流れ',             icon:'💧', vol:0.50 },
        { type:'rain',     name:'雨音',                 icon:'🌧️', vol:0.26 },
        { type:'pad',      name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.52 },
        { type:'harp',     name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, 264, null, null],
            [null, 220, null, 176, null],
            [264, null, null, 220, null],
            [null, 176, null, null, 352],
          ], bpm:14, startDelay:6, vol:0.40 },
        { type:'bowl',     name:'チベタンボウル',         icon:'🔔', interval:28000, vol:0.42 },
      ]},
    ]
  },
  // 1: 入浴後 — 湯上がりのリラックス: α波 + 弦楽パッド + ハープ + ボウル
  {
    breathe: [
      { idx:0, min:0.38, max:0.54 },
      { idx:1, min:0.44, max:0.62 },
      { idx:2, min:0.38, max:0.58 },
      { idx:3, min:0.26, max:0.46 },
    ],
    breatheInterval: 210,
    presets: [
      { name: 'ライト', layers: [
        { type:'binaural', name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.56 },
      ]},
      { name: 'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.56 },
        { type:'harp',     name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, null, 264, null],
            [null, 220, null, null, 176],
            [264, null, 220, null, null],
            [null, null, 176, 220, null],
          ], bpm:13, startDelay:7, vol:0.38 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [176,  null, null, null, 264,  null, null, null],
            [null, null, 220,  null, null, null, 264,  null],
            [264,  null, null, 220,  null, null, null, 176 ],
            [null, 176,  null, null, null, 220,  null, null],
          ], bpm:9, startDelay:7, vol:0.34 },
        { type:'bowl',     name:'チベタンボウル',         icon:'🔔', interval:26000, vol:0.48 },
      ]},
      { name: 'ディープ', layers: [
        { type:'binaural',  name:'バイノーラル α波 8Hz', icon:'〜', base:180, beat:8, vol:0.48 },
        { type:'pad',       name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.56 },
        { type:'harp',      name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, null, 264, null],
            [null, 220, null, null, 176],
            [264, null, 220, null, null],
            [null, null, 176, 220, null],
          ], bpm:13, startDelay:7, vol:0.38 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [176,  null, null, null, 264,  null, null, null],
            [null, null, 220,  null, null, null, 264,  null],
            [264,  null, null, 220,  null, null, null, 176 ],
            [null, 176,  null, null, null, 220,  null, null],
          ], bpm:9, startDelay:7, vol:0.34 },
        { type:'bowl',      name:'チベタンボウル',         icon:'🔔', interval:26000, vol:0.48 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',    icon:'✦',  vol:0.44 },
      ]},
    ]
  },
  // 2: 就寝準備 — 眠りへの橋渡し: α→θ + ブラウン + 弦楽パッド + ハープ
  {
    breathe: [
      { idx:0, min:0.42, max:0.58 },
      { idx:1, min:0.34, max:0.54 },
      { idx:2, min:0.40, max:0.58 },
      { idx:3, min:0.24, max:0.44 },
    ],
    breatheInterval: 190,
    presets: [
      { name: 'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→θ',    icon:'〜', base:200, beat:9, driftTo:5, driftDuration:2700, vol:0.52 },
        { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.36 },
      ]},
      { name: 'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→θ',    icon:'〜', base:200, beat:9, driftTo:5, driftDuration:2700, vol:0.52 },
        { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.34 },
        { type:'pad',      name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.50 },
        { type:'harp',     name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, 264, null, null],
            [null, null, 220, null, 176],
            [264, null, null, null, 220],
            [null, 176, null, 264, null],
          ], bpm:12, startDelay:8, vol:0.34 },
      ]},
      { name: 'ディープ', layers: [
        { type:'binaural',  name:'バイノーラル α→θ',   icon:'〜', base:200, beat:9, driftTo:5, driftDuration:2700, vol:0.52 },
        { type:'noise',     name:'ブラウンノイズ',      icon:'🌫️', noiseType:'brown', vol:0.34 },
        { type:'pad',       name:'弦楽器パッド',         icon:'🎻', freqs:[176,220,264,352], vol:0.50 },
        { type:'harp',      name:'ハープ',              icon:'🪕',
          patterns:[
            [176, null, 264, null, null],
            [null, null, 220, null, 176],
            [264, null, null, null, 220],
            [null, 176, null, 264, null],
          ], bpm:12, startDelay:8, vol:0.34 },
        { type:'bowl',      name:'チベタンボウル',      icon:'🔔', interval:24000, vol:0.44 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',  icon:'✦',  vol:0.40 },
      ]},
    ]
  },
  // 3: 読書・スマホオフ — 焚き火と弦楽器: α波 + 焚き火 + オルガン + ハープ
  {
    breathe: [
      { idx:0, min:0.36, max:0.52 },
      { idx:1, min:0.40, max:0.58 },
      { idx:2, min:0.36, max:0.56 },
      { idx:3, min:0.24, max:0.44 },
    ],
    breatheInterval: 215,
    presets: [
      { name: 'ライト', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.46 },
        { type:'fire',     name:'焚き火',               icon:'🔥', vol:0.58 },
      ]},
      { name: 'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.46 },
        { type:'fire',     name:'焚き火',               icon:'🔥', vol:0.55 },
        { type:'organ',    name:'オルガン',              icon:'🎹', baseFreq:88.0, vol:0.44 },
        { type:'harp',     name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, 220, null, null],
            [null, 264, null, 176, null],
            [220, null, null, 264, null],
            [null, 176, null, null, 220],
          ], bpm:15, startDelay:6, vol:0.36 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [176,  null, null, null, 264,  null, null, null],
            [null, null, 220,  null, null, null, 264,  null],
            [264,  null, null, 220,  null, null, null, 176 ],
            [null, 176,  null, null, null, 220,  null, null],
          ], bpm:9, startDelay:7, vol:0.34 },
      ]},
      { name: 'ディープ', layers: [
        { type:'binaural', name:'バイノーラル α波 9Hz', icon:'〜', base:180, beat:9, vol:0.46 },
        { type:'fire',     name:'焚き火',               icon:'🔥', vol:0.52 },
        { type:'organ',    name:'オルガン',              icon:'🎹', baseFreq:88.0, vol:0.44 },
        { type:'harp',     name:'ハープ',               icon:'🪕',
          patterns:[
            [176, null, 220, null, null],
            [null, 264, null, 176, null],
            [220, null, null, 264, null],
            [null, 176, null, null, 220],
          ], bpm:15, startDelay:6, vol:0.36 },
        { type:'piano', name:'ソフトピアノ', icon:'🎹',
          patterns:[
            [176,  null, null, null, 264,  null, null, null],
            [null, null, 220,  null, null, null, 264,  null],
            [264,  null, null, 220,  null, null, null, 176 ],
            [null, 176,  null, null, null, 220,  null, null],
          ], bpm:9, startDelay:7, vol:0.34 },
        { type:'bowl',     name:'チベタンボウル',        icon:'🔔', interval:26000, vol:0.40 },
      ]},
    ]
  },
  // 4: ストレッチ — 体をほぐして眠りへ: α→θ + 川 + 弦楽パッド + ボウル
  {
    breathe: [
      { idx:0, min:0.40, max:0.56 },
      { idx:1, min:0.44, max:0.62 },
      { idx:2, min:0.38, max:0.56 },
      { idx:3, min:0.26, max:0.46 },
    ],
    breatheInterval: 185,
    presets: [
      { name: 'ライト', layers: [
        { type:'binaural', name:'バイノーラル α→θ',    icon:'〜', base:200, beat:9, driftTo:5, driftDuration:2400, vol:0.50 },
        { type:'stream',   name:'川の流れ',             icon:'💧', vol:0.52 },
      ]},
      { name: 'スタンダード', layers: [
        { type:'binaural', name:'バイノーラル α→θ',    icon:'〜', base:200, beat:9, driftTo:5, driftDuration:2400, vol:0.50 },
        { type:'stream',   name:'川の流れ',             icon:'💧', vol:0.48 },
        { type:'pad',      name:'弦楽器パッド',          icon:'🎻', freqs:[176,220,264,352], vol:0.52 },
        { type:'bowl',     name:'チベタンボウル',        icon:'🔔', interval:22000, vol:0.50 },
      ]},
      { name: 'ディープ', layers: [
        { type:'binaural',  name:'バイノーラル α→θ',   icon:'〜', base:200, beat:9, driftTo:5, driftDuration:2400, vol:0.50 },
        { type:'stream',    name:'川の流れ',            icon:'💧', vol:0.46 },
        { type:'pad',       name:'弦楽器パッド',         icon:'🎻', freqs:[176,220,264,352], vol:0.52 },
        { type:'bowl',      name:'チベタンボウル',       icon:'🔔', interval:22000, vol:0.50 },
        { type:'harp',      name:'ハープ',              icon:'🪕',
          patterns:[
            [176, null, 264, null, null],
            [null, 220, null, 176, null],
            [264, null, null, 220, null],
            [null, 176, 220, null, null],
          ], bpm:13, startDelay:7, vol:0.36 },
        { type:'solfeggio', name:'528Hz ソルフェジオ',  icon:'✦',  vol:0.42 },
      ]},
    ]
  },
];

PRESETS.walk = [
  // 0: 公園・緑地
  {
    presets: [
      { name:'ライト', layers: [
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.62 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.44 },
      ]},
      { name:'スタンダード', layers: [
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.60 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.46 },
        { type:'wind',   name:'風の音',         icon:'🍃', vol:0.28 },
      ]},
      { name:'ディープ', layers: [
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.58 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.50 },
        { type:'wind',   name:'風の音',         icon:'🍃', vol:0.32 },
        { type:'rain',   name:'小雨',           icon:'🌧️', vol:0.20 },
      ]},
    ]
  },
  // 1: 都会の通勤路
  {
    presets: [
      { name:'ライト', layers: [
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.55 },
        { type:'noise',  name:'ブラウンノイズ', icon:'🌫️', noiseType:'brown', vol:0.30 },
      ]},
      { name:'スタンダード', layers: [
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.54 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.38 },
        { type:'noise',  name:'ブラウンノイズ', icon:'🌫️', noiseType:'brown', vol:0.34 },
      ]},
      { name:'ディープ', layers: [
        { type:'birds',  name:'小鳥のさえずり', icon:'🐦', vol:0.52 },
        { type:'rain',   name:'雨音',           icon:'🌧️', vol:0.42 },
        { type:'stream', name:'川の流れ',       icon:'💧', vol:0.36 },
        { type:'noise',  name:'ブラウンノイズ', icon:'🌫️', noiseType:'brown', vol:0.32 },
      ]},
    ]
  },
  // 2: 海辺の散歩
  {
    presets: [
      { name:'ライト', layers: [
        { type:'ocean', name:'波の音', icon:'🌊', vol:0.68 },
      ]},
      { name:'スタンダード', layers: [
        { type:'ocean', name:'波の音',         icon:'🌊', vol:0.66 },
        { type:'wind',  name:'潮風',           icon:'🍃', vol:0.30 },
        { type:'birds', name:'海鳥のさえずり', icon:'🐦', vol:0.32 },
      ]},
      { name:'ディープ', layers: [
        { type:'ocean', name:'波の音',         icon:'🌊', vol:0.70 },
        { type:'wind',  name:'潮風',           icon:'🍃', vol:0.36 },
        { type:'rain',  name:'小雨',           icon:'🌧️', vol:0.22 },
        { type:'birds', name:'海鳥のさえずり', icon:'🐦', vol:0.24 },
      ]},
    ]
  },
  // 3: 山道・ハイキング
  {
    presets: [
      { name:'ライト', layers: [
        { type:'stream', name:'山の流れ',       icon:'💧', vol:0.58 },
        { type:'birds',  name:'山鳥のさえずり', icon:'🐦', vol:0.50 },
      ]},
      { name:'スタンダード', layers: [
        { type:'stream', name:'山の流れ',       icon:'💧', vol:0.60 },
        { type:'birds',  name:'山鳥のさえずり', icon:'🐦', vol:0.52 },
        { type:'wind',   name:'山の風',         icon:'🍃', vol:0.34 },
      ]},
      { name:'ディープ', layers: [
        { type:'stream',   name:'山の流れ',       icon:'💧', vol:0.58 },
        { type:'birds',    name:'山鳥のさえずり', icon:'🐦', vol:0.50 },
        { type:'wind',     name:'山の風',         icon:'🍃', vol:0.38 },
        { type:'crickets', name:'虫の声',         icon:'🦗', vol:0.28 },
      ]},
    ]
  },
  // 4: 夜の散歩
  {
    presets: [
      { name:'ライト', layers: [
        { type:'crickets', name:'コオロギ', icon:'🦗', vol:0.55 },
        { type:'wind',     name:'夜風',    icon:'🍃', vol:0.32 },
      ]},
      { name:'スタンダード', layers: [
        { type:'crickets', name:'コオロギ', icon:'🦗', vol:0.55 },
        { type:'stream',   name:'小川',    icon:'💧', vol:0.38 },
        { type:'wind',     name:'夜風',    icon:'🍃', vol:0.36 },
      ]},
      { name:'ディープ', layers: [
        { type:'crickets', name:'コオロギ', icon:'🦗', vol:0.52 },
        { type:'rain',     name:'夜雨',    icon:'🌧️', vol:0.36 },
        { type:'stream',   name:'小川',    icon:'💧', vol:0.34 },
        { type:'wind',     name:'夜風',    icon:'🍃', vol:0.30 },
      ]},
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
    this._uiPreset     = 0;          // currently selected preset (0=ライト, 1=スタンダード, 2=ディープ)
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

    this._journeyTimers = [];
    this._journeyPhase  = 0;

    this._breathGuideActive = false;
    this._breathTimers      = [];

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

  _makeCrickets() {
    const ac = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];
    const sumG = ac.createGain();
    sumG.gain.value = 0.20;
    sumG.connect(gainNode);

    // 4 cricket voices at slightly detuned frequencies with independent chirp rates
    [
      { freq: 3180, chirpRate: 6.5, vol: 0.55 },
      { freq: 3320, chirpRate: 6.1, vol: 0.45 },
      { freq: 3050, chirpRate: 5.8, vol: 0.38 },
      { freq: 3460, chirpRate: 7.0, vol: 0.30 },
    ].forEach(({ freq, chirpRate, vol }) => {
      const src = ac.createBufferSource();
      src.buffer = buildNoiseBuffer(ac, 'pink');
      src.loop = true;

      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = 20 + Math.random() * 8;

      const am = ac.createGain();
      am.gain.value = 0.5;
      const lfo = ac.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = chirpRate;
      const depth = ac.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(am.gain);
      lfo.start();

      const vg = ac.createGain();
      vg.gain.value = vol;
      src.connect(bp); bp.connect(am); am.connect(vg); vg.connect(sumG);
      src.start();
      nodes.push(src, lfo);
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
    const ac = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);
    const nodes = [];

    // ── Summing bus → dual LP → output ──
    const sumG = ac.createGain();
    sumG.gain.value = 1;
    const lp1 = ac.createBiquadFilter();
    lp1.type = 'lowpass'; lp1.frequency.value = 2800; lp1.Q.value = 0.4;
    const lp2 = ac.createBiquadFilter();
    lp2.type = 'lowpass'; lp2.frequency.value = 1600; lp2.Q.value = 0.3;
    sumG.connect(lp1); lp1.connect(lp2); lp2.connect(gainNode);

    // ── Master tremolo (bowing variation, very subtle) ──
    const tremLFO = ac.createOscillator();
    tremLFO.frequency.value = 4.8 + Math.random() * 0.5;
    tremLFO.type = 'sine';
    const tremDpth = ac.createGain();
    tremDpth.gain.value = 0.018;
    tremLFO.connect(tremDpth);
    tremDpth.connect(sumG.gain);
    tremLFO.start();
    nodes.push(tremLFO);

    freqs.forEach((freq, fi) => {
      // Per-note vibrato LFO (slightly different rate for each string)
      const vibLFO = ac.createOscillator();
      vibLFO.type = 'sine';
      vibLFO.frequency.value = 5.1 + fi * 0.18 + Math.random() * 0.4;
      vibLFO.start();
      nodes.push(vibLFO);

      // Two detuned voices: -5 cents and +5 cents (section-strings spread)
      [-5, 5].forEach((detCents) => {
        const detRatio = Math.pow(2, detCents / 1200);
        const voiceG = ac.createGain();
        voiceG.gain.value = 0.50;
        voiceG.connect(sumG);

        // Vibrato depth per voice
        const vibDepth = ac.createGain();
        vibDepth.gain.value = freq * detRatio * 0.0055;  // ~9 cents depth
        vibLFO.connect(vibDepth);

        // Sawtooth oscillator (rich harmonic series → string-like)
        const osc = ac.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * detRatio;
        vibDepth.connect(osc.frequency);

        // Per-voice rolloff (soften individual notes before summing)
        const noteLp = ac.createBiquadFilter();
        noteLp.type = 'lowpass';
        noteLp.frequency.value = Math.min(freq * 7, 3500);
        noteLp.Q.value = 0.35;

        // Envelope: 0 → full over 1.5 s (bowing attack)
        const env = ac.createGain();
        env.gain.setValueAtTime(0, ac.currentTime);
        env.gain.linearRampToValueAtTime(0.14, ac.currentTime + 1.5);

        osc.connect(noteLp);
        noteLp.connect(env);
        env.connect(voiceG);
        osc.start();
        nodes.push(osc);
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
        // Wider velocity range for more expression
        const velocity = 0.32 + Math.random() * 0.62;

        // 18% chance of ornament: a quick grace note 50–80 ms before the main note
        if (Math.random() < 0.18) {
          const graceFreq = freq * (Math.random() < 0.5 ? 9/8 : 8/9); // step up or down
          const graceBuf = computeAdditiveBuffer(this.ac, graceFreq, 1.2);
          const graceS = this.ac.createBufferSource();
          graceS.buffer = graceBuf;
          const graceG = this.ac.createGain();
          graceG.gain.value = velocity * 0.38;
          graceS.connect(graceG);
          graceG.connect(destGain);
          const graceDelay = 0.055 + Math.random() * 0.025;
          graceS.start(this.ac.currentTime + graceDelay);
          graceS.stop(this.ac.currentTime + graceDelay + 1.4);
        }

        // 12% chance of double-touch: play a harmony note 35–55 ms later
        if (Math.random() < 0.12) {
          const harmFreq = freq * (Math.random() < 0.6 ? 3/2 : 4/3); // 5th or 4th
          if (harmFreq < this.ac.sampleRate * 0.45) {
            const harmBuf = computeAdditiveBuffer(this.ac, harmFreq, 3.5);
            const harmS = this.ac.createBufferSource();
            harmS.buffer = harmBuf;
            const harmG = this.ac.createGain();
            harmG.gain.value = velocity * 0.28;
            harmS.connect(harmG);
            harmG.connect(destGain);
            const harmDelay = 0.035 + Math.random() * 0.020;
            harmS.start(this.ac.currentTime + harmDelay);
            harmS.stop(this.ac.currentTime + harmDelay + 3.8);
          }
        }

        const buf = computeAdditiveBuffer(this.ac, freq, 4.5);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const noteG = this.ac.createGain();
        noteG.gain.value = velocity;
        src.connect(noteG);
        noteG.connect(destGain);
        src.start();
        src.stop(this.ac.currentTime + 4.8);
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

      // ±4% timing humanization
      const humanizedMs = beatMs * (0.96 + Math.random() * 0.08);
      const jitter = beatMs * 0.035 * (Math.random() - 0.5);
      this.schedulerTmrs.push(setTimeout(tick, humanizedMs + jitter));
    };

    this.schedulerTmrs.push(setTimeout(tick, startDelaySec * 1000));
  }

  _schedulePianoNotes(patterns, bpm, destGain, startDelaySec = 4) {
    const beatMs = (60 / bpm) * 1000;
    const maxLen = Math.max(...patterns.map(p => p.length));
    const REST   = Array(maxLen).fill(null);

    let patIdx = 0, noteIdx = 0, curPat = patterns[0];

    const tick = () => {
      if (!this.isPlaying) return;

      const freq = curPat[noteIdx];
      if (freq) {
        const velocity = 0.28 + Math.random() * 0.48;  // gentle dynamics
        const dur      = 4.8 + Math.random() * 1.2;

        const buf = computePianoBuffer(this.ac, freq, velocity, dur);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const noteG = this.ac.createGain();
        noteG.gain.value = velocity;
        src.connect(noteG);
        noteG.connect(destGain);
        src.start();
        src.stop(this.ac.currentTime + dur + 0.5);

        // Occasional soft inner pedal note (bass support), 20% chance
        if (Math.random() < 0.20 && freq > 200) {
          const bassFreq = freq / 2;
          const bassBuf  = computePianoBuffer(this.ac, bassFreq, velocity * 0.45, dur * 1.2);
          const bassS    = this.ac.createBufferSource();
          bassS.buffer   = bassBuf;
          const bassG    = this.ac.createGain();
          bassG.gain.value = velocity * 0.45;
          bassS.connect(bassG);
          bassG.connect(destGain);
          bassS.start();
          bassS.stop(this.ac.currentTime + dur * 1.2 + 0.5);
        }
      }

      noteIdx++;
      if (noteIdx >= curPat.length) {
        noteIdx = 0;
        patIdx++;
        if (patIdx >= patterns.length) patIdx = 0;
        // 12% breath rest between patterns
        if (Math.random() < 0.12) {
          curPat = REST;
        } else {
          curPat = patterns[patIdx];
        }
      }

      const humanMs = beatMs * (0.94 + Math.random() * 0.12);
      const jitter  = (Math.random() - 0.5) * beatMs * 0.04;
      this.schedulerTmrs.push(setTimeout(tick, humanMs + jitter));
    };

    this.schedulerTmrs.push(setTimeout(tick, startDelaySec * 1000));
  }

  // ── Stops only layer nodes/schedulers; keeps AudioContext alive ───────────
  // Use this for mode/situation switches — avoids re-init and re-decode cost.

  _stopLayersOnly() {
    this.isPlaying = false;

    this.schedulerTmrs.forEach(clearTimeout);
    this.schedulerTmrs = [];

    this._journeyTimers.forEach(clearTimeout);
    this._journeyTimers = [];
    this._journeyPhase = 0;
    this._updateJourneyPhaseDisplay();

    this._stopBreathGuide();

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

    const sitData = PRESETS[cat][moodId];
    const preset  = sitData.presets[this._uiPreset] || sitData.presets[0];
    this.layers = [];

    // Wait for all audio files to be decoded before building layers.
    // After the first play this resolves instantly (buffers cached).
    await this._soundsReady;
    if (!this.isPlaying) return;  // user switched again before decode finished

    preset.layers.forEach(def => {
      switch (def.type) {
        case 'binaural': {
          const b = this._makeBinauralBeat(def.base, def.beat);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: b.gainNode, nodes: [], defaultVol: def.vol, rightOsc: b.rightOsc, binauralBase: def.base });
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
        case 'cricket': {
          const cr = this._makeCrickets();
          this.layers.push({ name: def.name, icon: def.icon, gainNode: cr.gainNode, nodes: cr.nodes, defaultVol: def.vol });
          break;
        }
        case 'piano': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          g.connect(this.reverbSend);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._schedulePianoNotes(def.patterns, def.bpm, g, def.startDelay || 5);
          break;
        }
      }
    });

    // Apply saved layer volumes if available; otherwise use preset defaults
    const savedVols = this._savedLayerVols(cat, moodId, this._uiPreset);
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

    // Start organic volume breathing if sitData defines it
    if (sitData.breathe) {
      this._startVolumeBreathing(sitData.breathe, sitData.breatheInterval || 180);
    }

    this._renderLayers();
    this._updatePlayBtn(true);
    this._startVisuals(cat);

    // Start journey phases if this preset has journey:true
    const activePr = PRESETS[cat][moodId].presets[this._uiPreset];
    if (activePr && activePr.journey) {
      this._scheduleJourneyPhases(activePr.napMode === true);
    }

    // Update sleep extras panel visibility
    this._updateSleepExtras(cat);
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

  _prefsKey(cat, mood, preset = 0) { return `${cat}:${mood}:${preset}`; }

  // Save current layer volumes for this cat/mood/preset
  _saveLayerVols() {
    if (!this.currentCat && this.currentCat !== 0) return;
    const vols = this.layers.map(l => {
      const slider = document.querySelector(`.layer-slider[data-idx="${this.layers.indexOf(l)}"]`);
      return slider ? +slider.value / 100 : l.defaultVol;
    });
    const layerVols = this._loadPrefs().layerVols || {};
    layerVols[this._prefsKey(this.currentCat, this.currentMood, this._uiPreset)] = vols;
    this._savePrefs({ layerVols });
  }

  // Load saved layer volumes for this cat/mood/preset, or null if none
  _savedLayerVols(cat, mood, preset = 0) {
    const prefs = this._loadPrefs();
    return (prefs.layerVols && prefs.layerVols[this._prefsKey(cat, mood, preset)]) || null;
  }

  _renderLayers() {
    const container  = document.getElementById('layers-container');
    container.innerHTML = '';
    const savedVols  = this._savedLayerVols(this.currentCat, this.currentMood, this._uiPreset);

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

  // ── Preset selector row ───────────────────────────────────────────────────

  _renderPresetRow(cat, moodId) {
    const row = document.getElementById('preset-row');
    if (!row) return;
    row.innerHTML = '';
    const sitData = PRESETS[cat]?.[moodId];
    if (!sitData || !sitData.presets || sitData.presets.length <= 1) return;

    const pills = document.createElement('div');
    pills.className = 'preset-pills';
    sitData.presets.forEach((p, idx) => {
      const btn = document.createElement('button');
      btn.className = 'preset-pill' + (idx === this._uiPreset ? ' active' : '');
      if (this._savedLayerVols(cat, moodId, idx)) btn.classList.add('has-custom');
      btn.textContent = p.name;
      btn.addEventListener('click', () => this._selectPreset(idx));
      pills.appendChild(btn);
    });

    const saveBtn = document.createElement('button');
    saveBtn.id = 'preset-save-btn';
    saveBtn.className = 'preset-save-btn';
    saveBtn.textContent = '保存';
    saveBtn.title = '現在のバランスを保存';
    saveBtn.addEventListener('click', () => this._saveCustomPreset());

    row.appendChild(pills);
    row.appendChild(saveBtn);
  }

  _selectPreset(idx) {
    if (idx === this._uiPreset) return;
    this._uiPreset = idx;
    document.querySelectorAll('.preset-pill').forEach((b, i) => {
      b.classList.toggle('active', i === idx);
    });
    if (this.isPlaying) {
      this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.10);
      this._stopLayersOnly();
      this._startCategory(this._uiCat, this._uiMood, 1.0);
    } else {
      this._renderLayersPreview();
    }
  }

  _renderLayersPreview() {
    const container = document.getElementById('layers-container');
    container.innerHTML = '';
    const sitData = PRESETS[this._uiCat]?.[this._uiMood];
    if (!sitData) return;
    const preset = sitData.presets[this._uiPreset] || sitData.presets[0];
    const savedVols = this._savedLayerVols(this._uiCat, this._uiMood, this._uiPreset);
    preset.layers.forEach((def, idx) => {
      const initVol = (savedVols && savedVols[idx] != null) ? savedVols[idx] : def.vol;
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.innerHTML = `
        <button class="layer-toggle" data-idx="${idx}">${def.icon}</button>
        <span class="layer-name">${def.name}</span>
        <input type="range" class="layer-slider" min="0" max="100"
          value="${Math.round(initVol * 100)}" data-idx="${idx}" disabled>
      `;
      container.appendChild(row);
    });
    if (preset.layers.length === 0) {
      container.innerHTML = '<p class="layer-panel-empty">再生するとレイヤーが表示されます</p>';
    }
  }

  _saveCustomPreset() {
    if (!this.isPlaying) return;
    this._saveLayerVols();
    const btn = document.getElementById('preset-save-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ 保存済み';
      btn.classList.add('active');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('active'); }, 1800);
    }
    const activePill = document.querySelector('.preset-pill.active');
    if (activePill) activePill.classList.add('has-custom');
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
      else if (cat === 'presleep')   this._drawPresleep();
      else if (cat === 'morning')    this._drawMorning();
      else if (cat === 'relax')      this._drawRelax();
      else if (cat === 'walk')       this._drawWalk();
      else                           this._drawFocus();
      this.animFrame = requestAnimationFrame(render);
    };
    render();
  }

  // Returns current hour as float (0–24) — used for time-of-day visual adaptation
  _getHour() {
    const n = new Date();
    return n.getHours() + n.getMinutes() / 60 + n.getSeconds() / 3600;
  }

  // ── 朝の目覚め — Aurora Dawn (time-aware) ──────────────────────────────────
  _drawMorning() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.5;
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI)); // 0=night→1=noon
    const dawn = Math.max(0, 1 - Math.abs(hr - 6.5) / 2.8);     // peaks 6:30am
    const aur  = Math.max(0, 1 - day * 0.88);                    // aurora fades at day

    // Sky base — night to morning gradient shifts with hour
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    `rgb(${(7  + day*16)|0},${(5 +day*10)|0},${(22+day*44)|0})`);
    sky.addColorStop(0.40, `rgb(${(26 + day*24)|0},${(8 +day*20)|0},${(48+day*28)|0})`);
    sky.addColorStop(0.65, `rgb(${(61 + dawn*60)|0},${(16+dawn*28)|0},${(64-dawn*18)|0})`);
    sky.addColorStop(0.82, `rgb(${(122+ dawn*90)|0},${(32+dawn*32)|0},${(24+dawn*12)|0})`);
    sky.addColorStop(1,    `rgb(${(184+ dawn*55)|0},${(64+dawn*24)|0},${16})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Aurora ribbons — brightest at night/pre-dawn, vanish by midday
    if (aur > 0.03) {
      const bands = [
        { y: 0.20, amp: 0.055, freq: 2.1, spd: 0.18, rgb: [70,210,240],  a: 0.30*aur, h: 0.16 },
        { y: 0.32, amp: 0.042, freq: 1.65,spd: 0.13, rgb: [200,100,210], a: 0.24*aur, h: 0.13 },
        { y: 0.12, amp: 0.032, freq: 2.9, spd: 0.23, rgb: [255,190, 80], a: 0.18*aur, h: 0.10 },
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
        gr.addColorStop(0.30, `rgba(${r},${g},${bl},${b.a.toFixed(3)})`);
        gr.addColorStop(0.65, `rgba(${r},${g},${bl},${(b.a*0.55).toFixed(3)})`);
        gr.addColorStop(1,    `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = gr; ctx.fill();
      });
    }

    // Horizon glow — strongest at dawn, warm at day
    const horA = dawn * 0.50 + day * 0.18;
    if (horA > 0.02) {
      const hor = ctx.createRadialGradient(cx, H, 0, cx, H, H * 0.80);
      hor.addColorStop(0,    `rgba(210,90,30,${horA.toFixed(3)})`);
      hor.addColorStop(0.38, `rgba(170,45,70,${(horA*0.35).toFixed(3)})`);
      hor.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = hor; ctx.fillRect(0, 0, W, H);
    }

    // Sun — appears at hr≥5, rises and brightens
    const sunVis = Math.max(0, Math.min(1, (hr - 5) / 3));
    if (sunVis > 0.02) {
      const sunR = Math.min(W, H) * 0.068;
      // Night=just below horizon, dawn=cresting, morning=fully up
      const sunY = H * 0.98 - sunR * (0.5 + sunVis * 2.2);
      const sunG = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, sunR * 2.8);
      sunG.addColorStop(0,   `rgba(255,245,180,${(0.96*sunVis).toFixed(2)})`);
      sunG.addColorStop(0.35,`rgba(255,175,50,${(0.55*sunVis).toFixed(2)})`);
      sunG.addColorStop(1,   'rgba(255,110,20,0)');
      ctx.fillStyle = sunG; ctx.beginPath(); ctx.arc(cx, sunY, sunR * 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,252,220,${(0.95*sunVis).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(cx, sunY, sunR, 0, Math.PI * 2); ctx.fill();
    }

    // Drifting motes — warm gold at dawn, cool at night, fade at midday
    const moteColor = dawn > 0.2
      ? `255,210,90`  // warm dawn gold
      : (day > 0.5 ? `200,230,255` : `180,180,255`); // cool night/day
    const moteAlphaBase = 0.12 + dawn * 0.30 + (1-day) * 0.15;
    for (let i = 0; i < 50; i++) {
      const s  = i * 137.508;
      const px = ((Math.sin(s * 0.17) + 1) / 2) * W;
      const vy = t * 0.00055 * (0.6 + 0.4 * Math.sin(s * 0.3));
      const py = ((((Math.sin(s * 0.11) + 1) / 2) - vy) % 1 + 1) % 1 * H;
      const al = (Math.min(moteAlphaBase, 0.70) * Math.abs(Math.sin(t * 0.38 + s))).toFixed(2);
      ctx.fillStyle = `rgba(${moteColor},${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.5 + 1.6 * Math.abs(Math.sin(s * 0.44)), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── リラックス — Floating Orbs (time-aware) ───────────────────────────────
  // ゆっくりと漂う発光体: 深海の生物発光 / 水面を漂う光
  _drawRelax() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.46;
    const U  = Math.min(W, H);
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const dusk = Math.max(0, 1 - Math.abs(hr - 18) / 3.0);  // peaks 6pm

    // Background: deep teal at night, warm aqua at day, golden at dusk
    const bgNight = [3, 22, 36];
    const bgDay   = [5, 42, 65];
    const bgDusk  = [24, 28, 52];
    const bgR = (bgNight[0] + (bgDay[0]-bgNight[0])*day + (bgDusk[0]-bgNight[0])*dusk) | 0;
    const bgG = (bgNight[1] + (bgDay[1]-bgNight[1])*day + (bgDusk[1]-bgNight[1])*dusk) | 0;
    const bgB = (bgNight[2] + (bgDay[2]-bgNight[2])*day + (bgDusk[2]-bgNight[2])*dusk) | 0;
    ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`; ctx.fillRect(0, 0, W, H);

    // Ambient deep glow
    const glowRgb = dusk > 0.2 ? `80,50,180` : `0,120,130`;
    const glowG = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.55);
    glowG.addColorStop(0,   `rgba(${glowRgb},${(0.15 + day*0.08).toFixed(3)})`);
    glowG.addColorStop(1,   'transparent');
    ctx.fillStyle = glowG; ctx.fillRect(0, 0, W, H);

    // 3 large drifting orbs — slow Lissajous-like paths
    const orbs = [
      { px: cx + Math.sin(t*0.042) * W*0.26, py: cy + Math.cos(t*0.031) * H*0.18,
        rgb: dusk > 0.3 ? [140,100,240] : (day>0.5 ? [0,200,200] : [0,180,180]), r: U*0.130 },
      { px: cx + Math.sin(t*0.033 + 2.1) * W*0.22, py: cy + Math.cos(t*0.044 + 2.1) * H*0.16,
        rgb: dusk > 0.3 ? [100,60,220]  : (day>0.5 ? [40,180,210] : [30,150,200]), r: U*0.105 },
      { px: cx + Math.sin(t*0.055 + 4.3) * W*0.18, py: cy + Math.cos(t*0.038 + 4.3) * H*0.20,
        rgb: dusk > 0.3 ? [180,120,255] : (day>0.5 ? [100,220,210] : [80,200,200]), r: U*0.090 },
    ];

    orbs.forEach((o, oi) => {
      const [r, g, b] = o.rgb;
      const pulse = 0.5 + 0.5 * Math.sin(t * (0.55 + oi * 0.15) + oi * 2.1);

      // Ripple rings from each orb (2 rings per orb, offset timing)
      for (let ri = 0; ri < 2; ri++) {
        const rProg = ((t * 0.10 + oi * 0.33 + ri * 0.5) % 1);
        const rRad  = o.r * (0.9 + rProg * 3.5);
        const rAlp  = (1 - rProg) * 0.15;
        ctx.beginPath(); ctx.arc(o.px, o.py, rRad, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${rAlp.toFixed(3)})`;
        ctx.lineWidth = 1.2; ctx.stroke();
      }

      // Outer soft glow
      const gG = ctx.createRadialGradient(o.px, o.py, 0, o.px, o.py, o.r * (2.8 + pulse));
      gG.addColorStop(0,   `rgba(${r},${g},${b},${(0.18+pulse*0.10).toFixed(3)})`);
      gG.addColorStop(0.4, `rgba(${r},${g},${b},${(0.06+pulse*0.04).toFixed(3)})`);
      gG.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gG; ctx.beginPath(); ctx.arc(o.px, o.py, o.r*(2.8+pulse), 0, Math.PI*2); ctx.fill();

      // Core
      const cG = ctx.createRadialGradient(o.px, o.py, 0, o.px, o.py, o.r);
      cG.addColorStop(0,   `rgba(${Math.min(255,r+80)},${Math.min(255,g+60)},${Math.min(255,b+40)},${(0.55+pulse*0.25).toFixed(3)})`);
      cG.addColorStop(0.5, `rgba(${r},${g},${b},${(0.30+pulse*0.12).toFixed(3)})`);
      cG.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = cG; ctx.beginPath(); ctx.arc(o.px, o.py, o.r, 0, Math.PI*2); ctx.fill();
    });

    // Floating motes (slow drift)
    const moteRgb = dusk > 0.2 ? `180,140,255` : `100,220,220`;
    for (let i = 0; i < 40; i++) {
      const s  = i * 137.508;
      const px = ((Math.sin(s * 0.17) + 1) / 2) * W;
      const vy = t * 0.00035 * (0.5 + 0.5 * Math.sin(s * 0.3));
      const py = ((((Math.sin(s * 0.11) + 1) / 2) - vy) % 1 + 1) % 1 * H;
      const al = (0.08 + 0.42 * Math.abs(Math.sin(t * 0.28 + s))).toFixed(2);
      ctx.fillStyle = `rgba(${moteRgb},${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.6 + 1.4 * Math.abs(Math.sin(s * 0.44)), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── 散歩 — Outdoor Walk (time-aware) ─────────────────────────────────────
  _drawWalk() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const hr  = this._getHour();
    // Time-of-day: 0=night, 1=noon
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const eve  = Math.max(0, 1 - Math.abs(hr - 18) / 3);   // golden hour peaks 18:00
    const nite = Math.max(0, 1 - day * 1.4);

    // Sky gradient — blue day / golden evening / deep night
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    const r0 = (8  + day*52  + eve*40 - nite*4)  | 0;
    const g0 = (12 + day*88  + eve*20)            | 0;
    const b0 = (28 + day*120 - eve*60 - nite*10)  | 0;
    const r1 = (20 + day*28  + eve*80)            | 0;
    const g1 = (45 + day*80  + eve*38)            | 0;
    const b1 = (20 + day*30  - eve*20)            | 0;
    sky.addColorStop(0,    `rgb(${r0},${g0},${b0})`);
    sky.addColorStop(0.55, `rgb(${r1},${g1},${b1})`);
    sky.addColorStop(1,    `rgb(${(10+day*30+eve*50)|0},${(38+day*65+eve*30)|0},${(10+day*10)|0})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Ground plane — green at day, darker at night
    const gndA = 0.22 + day * 0.28 + eve * 0.10;
    const gnd = ctx.createLinearGradient(0, H * 0.62, 0, H);
    gnd.addColorStop(0, `rgba(30,${(80+day*40)|0},20,${gndA.toFixed(2)})`);
    gnd.addColorStop(1, `rgba(10,${(40+day*20)|0},8,${(gndA*0.4).toFixed(2)})`);
    ctx.fillStyle = gnd; ctx.fillRect(0, H * 0.62, W, H);

    // Slow-swaying trees (silhouettes)
    const treeColor = nite > 0.5
      ? `rgba(8,18,10,0.85)`
      : `rgba(${(15+day*10)|0},${(55+day*30)|0},${(12+day*8)|0},0.72)`;
    const trees = [
      { x: 0.08, h: 0.42, w: 0.10, sway: 1.8, spd: 0.22 },
      { x: 0.20, h: 0.35, w: 0.08, sway: 1.5, spd: 0.17 },
      { x: 0.78, h: 0.38, w: 0.09, sway: 1.6, spd: 0.20 },
      { x: 0.90, h: 0.44, w: 0.11, sway: 2.0, spd: 0.25 },
      { x: 0.50, h: 0.28, w: 0.07, sway: 1.2, spd: 0.14 },
    ];
    trees.forEach(tr => {
      const sway = Math.sin(t * tr.spd) * tr.sway / 100;
      const tx   = (tr.x + sway) * W;
      const ty   = (0.62 - tr.h * 0.7) * H;
      const th   = tr.h * H;
      const tw   = tr.w * W;
      // Trunk
      ctx.fillStyle = treeColor;
      ctx.fillRect(tx - tw * 0.06, ty + th * 0.55, tw * 0.12, th * 0.45);
      // Canopy (oval)
      ctx.beginPath();
      ctx.ellipse(tx, ty + th * 0.30, tw * 0.5, th * 0.42, sway * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = treeColor;
      ctx.fill();
    });

    // Drifting light motes (morning sun dust / fireflies at night)
    if (!this._walkMotes) {
      this._walkMotes = Array.from({ length: 22 }, () => ({
        x: Math.random(), y: Math.random() * 0.65 + 0.05,
        r: 0.8 + Math.random() * 2.2,
        dx: (Math.random() - 0.5) * 0.00018,
        dy: -Math.random() * 0.00012 - 0.00004,
        phase: Math.random() * Math.PI * 2,
        spd: 0.4 + Math.random() * 0.8,
      }));
    }
    this._walkMotes.forEach(m => {
      m.x += m.dx; m.y += m.dy;
      if (m.y < -0.02) { m.y = 0.70; m.x = Math.random(); }
      if (m.x < -0.02 || m.x > 1.02) m.x = Math.random();
      const pulse = 0.45 + 0.55 * Math.sin(t * m.spd + m.phase);
      const alpha = (nite > 0.3 ? 0.55 : 0.22) * pulse;
      const [mr, mg, mb] = nite > 0.3
        ? [200, 255, 160]   // firefly green-yellow at night
        : [255, 230, 100];  // golden dust at day
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${mr},${mg},${mb},${alpha.toFixed(3)})`;
      ctx.fill();
    });

    // Sun / moon disc
    const discX = W * (0.72 + Math.sin(t * 0.008) * 0.02);
    const discY = H * (nite > 0.5 ? 0.18 : Math.max(0.08, 0.42 - day * 0.30));
    if (nite > 0.5) {
      // Moon
      ctx.beginPath();
      ctx.arc(discX, discY, 14, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(220,230,255,${(nite * 0.55).toFixed(3)})`;
      ctx.fill();
    } else {
      // Sun glow
      const sunA = day * 0.45 + eve * 0.30;
      const sg = ctx.createRadialGradient(discX, discY, 0, discX, discY, H * 0.35);
      sg.addColorStop(0,    `rgba(255,${(200+eve*30)|0},${(80-eve*40)|0},${sunA.toFixed(3)})`);
      sg.addColorStop(0.15, `rgba(255,${(160+eve*40)|0},60,${(sunA*0.35).toFixed(3)})`);
      sg.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
    }

    // Horizon path glow (the "road" — a subtle bright strip)
    const pathY = H * 0.63;
    const pathG = ctx.createLinearGradient(0, pathY - 8, 0, pathY + 18);
    pathG.addColorStop(0, `rgba(${(180+day*50)|0},${(200+day*40)|0},${(100+day*30)|0},${(0.08+day*0.10).toFixed(3)})`);
    pathG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pathG;
    ctx.fillRect(0, pathY - 8, W, 26);
  }

  // ── 集中 — Lissajous Flow (time-aware) ───────────────────────────────────
  _drawFocus() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.44;
    const U  = Math.min(W, H);
    const hr  = this._getHour();
    const day = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    // Morning=cool cyan, afternoon=emerald, evening=warm teal
    const hueBase = 155 + day * 18;  // 155 (cool) → 173 (warm) at noon
    const bgAlpha = 0.10 + day * 0.04;

    ctx.fillStyle = '#010c0a'; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.52);
    bg.addColorStop(0,   `rgba(0,${(130+day*20)|0},${(95-day*10)|0},${bgAlpha.toFixed(3)})`);
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const A    = U * 0.28, B = U * 0.22;
    const fa   = 3;
    const fb   = 2 + 0.08 * Math.sin(t * 0.028);
    const dphi = t * 0.055;

    const STEPS = 220;
    for (let i = 0; i < STEPS; i++) {
      const θ   = (i / STEPS) * Math.PI * 2;
      const x   = cx + A * Math.sin(fa * θ + dphi);
      const y   = cy + B * Math.sin(fb * θ);
      const hue = hueBase + 42 * (i / STEPS);
      const al  = (0.28 + 0.52 * Math.abs(Math.sin(θ * 3.1 + t * 0.7))).toFixed(2);
      const rr  = 1.2 + 1.5 * Math.abs(Math.sin(θ * 2.2 + t * 0.4));
      ctx.fillStyle = `hsla(${hue | 0},78%,62%,${al})`;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
    }

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

    const rot = t * 0.022, R = U * 0.19;
    const gridAlpha = 0.025 + day * 0.015;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = `rgba(52,211,153,${gridAlpha.toFixed(3)})`;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rot;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, R, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    const gridStep = U * 0.088;
    ctx.strokeStyle = `rgba(52,211,153,${(gridAlpha*0.8).toFixed(3)})`; ctx.lineWidth = 0.5;
    for (let x = cx % gridStep; x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = cy % gridStep; y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
  }

  // ── 瞑想 — Breathing Mandala (time-aware) ────────────────────────────────
  _drawMeditation() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.42;
    const U  = Math.min(W, H);
    const hr   = this._getHour();
    const dusk = Math.max(0, 1 - Math.abs(hr - 18) / 3.2);  // peaks 6pm
    const night = Math.max(0, -Math.sin((hr - 6) / 12 * Math.PI)); // 1=night

    // Background: purple at night, adds warm amber at dusk
    ctx.fillStyle = '#060212'; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.60);
    bg.addColorStop(0,   `rgba(${(100+dusk*60)|0},${(28-dusk*10)|0},${(140-dusk*20)|0},${(0.26+dusk*0.08).toFixed(3)})`);
    bg.addColorStop(0.55,`rgba(70,20,110,${(0.10+dusk*0.04).toFixed(3)})`);
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Dusk horizon glow (meditation at sunset)
    if (dusk > 0.05) {
      const duskG = ctx.createLinearGradient(0, H * 0.6, 0, H);
      duskG.addColorStop(0, `rgba(200,80,20,0)`);
      duskG.addColorStop(1, `rgba(200,80,20,${(dusk * 0.22).toFixed(3)})`);
      ctx.fillStyle = duskG; ctx.fillRect(0, 0, W, H);
    }

    const ph = (t % 16) / 16;
    let ratio, label;
    if      (ph < 0.25) { ratio = ph / 0.25;              label = '吸　う'; }
    else if (ph < 0.50) { ratio = 1;                      label = '保　つ'; }
    else if (ph < 0.75) { ratio = 1 - (ph - 0.50) / 0.25; label = '吐　く'; }
    else                { ratio = 0;                      label = '　　…'; }
    const cR = U * (0.09 + 0.17 * ratio);

    // Color shifts warm at dusk: violet → rose-violet
    const rimR = (192 + dusk * 50) | 0;
    const rimG = (105 - dusk * 30) | 0;
    const rimB = (255 - dusk * 40) | 0;

    for (let i = 0; i < 6; i++) {
      const prog = ((t * 0.16 + i / 6) % 1);
      const rRip = cR + prog * U * 0.44;
      const al   = (1 - prog) * 0.22;
      if (al < 0.008) continue;
      ctx.beginPath(); ctx.arc(cx, cy, rRip, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${al.toFixed(3)})`;
      ctx.lineWidth = 1.4 * (1 - prog * 0.5); ctx.stroke();
    }

    const rotOuter = t * 0.020;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rotOuter;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * cR*0.80, cy + Math.sin(a) * cR*0.80, cR*0.72, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${(0.06+ratio*0.05).toFixed(3)})`;
      ctx.lineWidth = 0.7; ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - rotOuter * 1.4;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * cR*0.92, cy + Math.sin(a) * cR*0.92, cR*0.88, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${(0.10+ratio*0.08).toFixed(3)})`;
      ctx.lineWidth = 0.8; ctx.stroke();
    }

    for (let i = 3; i >= 1; i--) {
      const g = ctx.createRadialGradient(cx, cy, cR * 0.6, cx, cy, cR * (1 + i * 0.60));
      g.addColorStop(0, `rgba(${rimR},${(140+dusk*30)|0},255,${(0.13 / i).toFixed(3)})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cR * (1 + i * 0.60), 0, Math.PI * 2); ctx.fill();
    }
    const cG = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
    cG.addColorStop(0,    `rgba(245,${(220+dusk*20)|0},${(255-dusk*30)|0},0.62)`);
    cG.addColorStop(0.55, `rgba(${(160+dusk*40)|0},${(80-dusk*30)|0},255,0.28)`);
    cG.addColorStop(1,    'rgba(100,40,220,0.04)');
    ctx.fillStyle = cG; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${(0.32+ratio*0.38).toFixed(3)})`;
    ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI * 2); ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.font = `${(U * 0.042) | 0}px -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);

    for (let i = 0; i < 36; i++) {
      const s  = i * 137.508;
      const a  = s + t * (0.055 + 0.035 * Math.sin(s * 0.2));
      const d  = U * (0.30 + 0.14 * Math.abs(Math.sin(s * 0.4)));
      const px = cx + Math.cos(a) * d;
      const py = cy + Math.sin(a) * d * 0.86;
      const al = (0.10 + 0.48 * Math.abs(Math.sin(t * 0.26 + s))).toFixed(2);
      ctx.fillStyle = `rgba(${(220+dusk*30)|0},${(195-dusk*30)|0},255,${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.7 + 1.9 * Math.abs(Math.sin(s * 0.3)), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ── 睡眠前 — Warm Dusk / Bath (time-aware) ───────────────────────────────
  _drawPresleep() {
    const c = this.canvas, ctx = this.ctx;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      c.width = c.clientWidth; c.height = c.clientHeight;
      this._presleepMotes = null;
    }
    const W = c.width, H = c.height, t = this.t;

    const hr    = this._getHour();
    const eve   = Math.max(0, 1 - Math.abs(hr - 20.5) / 4.0);  // peaks at 8:30pm
    const warm  = Math.max(0, 1 - Math.abs(hr - 19.0) / 3.5);  // warmth at 7pm

    // ── Background: warm dusk → deep purple ──
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `rgb(${22 + Math.round(warm*30)},${10 + Math.round(warm*12)},${35 + Math.round(eve*10)})`);
    bg.addColorStop(1, `rgb(${9  + Math.round(warm*14)},${7  + Math.round(warm*6)}, ${20 + Math.round(eve*8)})`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ── Warm central glow (bath heat / candlelight) ──
    const gcx = W * 0.50, gcy = H * 0.58;
    const gr   = Math.min(W, H) * (0.58 + 0.06 * Math.sin(t * 0.019));
    const ga   = 0.11 + warm * 0.09 + 0.03 * Math.sin(t * 0.023);
    const grd  = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, gr);
    grd.addColorStop(0,   `rgba(210,100,30,${ga})`);
    grd.addColorStop(0.45,`rgba(160,50,70,${ga * 0.55})`);
    grd.addColorStop(1,   `rgba(50,15,70,0)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // ── Soft aurora ribbons in warm tones ──
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let r = 0; r < 3; r++) {
      const y0  = H * (0.18 + r * 0.10 + 0.03 * Math.sin(t * 0.013 + r * 2.1));
      const amp = H * (0.035 + 0.015 * Math.sin(t * 0.010 + r * 1.8));
      const numP = 20;
      const pts = [];
      for (let i = 0; i <= numP; i++) {
        pts.push([
          (i / numP) * W,
          y0 + amp * Math.sin(i * 0.5 + t * 0.008 + r * 0.9),
        ]);
      }
      const hue = 18 + r * 22 + 12 * Math.sin(t * 0.006 + r);
      const al  = (0.036 + warm * 0.032) * (1 + 0.25 * Math.sin(t * 0.017 + r));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1] + H * 0.055);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue},72%,62%,${al})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // ── Steam wisps: soft radial-gradient blobs along a rising bezier ──
    for (let w = 0; w < 3; w++) {
      const ph   = t * 0.012 + w * 2.09;
      const sx   = W * (0.28 + w * 0.22) + Math.sin(ph * 0.7) * W * 0.04;
      const baseY = H * 0.86;
      const cp1x = sx + Math.sin(ph + 0.5) * W * 0.05;
      const cp1y = baseY - H * 0.22;
      const cp2x = sx + Math.sin(ph + 1.2) * W * 0.07;
      const cp2y = baseY - H * 0.46;
      const ex   = sx + Math.sin(ph + 0.3) * W * 0.03;
      const ey   = baseY - H * 0.66;
      const steps = 10;
      for (let s = 0; s < steps; s++) {
        const tn  = s / (steps - 1);
        const mt  = 1 - tn;
        const bx  = mt*mt*mt*sx + 3*mt*mt*tn*cp1x + 3*mt*tn*tn*cp2x + tn*tn*tn*ex;
        const by  = mt*mt*mt*baseY + 3*mt*mt*tn*cp1y + 3*mt*tn*tn*cp2y + tn*tn*tn*ey;
        const rad = 9 + tn * 18;
        const al  = 0.038 * (1 - tn) * (0.7 + 0.3 * Math.sin(ph * 2.5));
        const sg  = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
        sg.addColorStop(0,  `rgba(215,175,145,${al})`);
        sg.addColorStop(1,  `rgba(215,175,145,0)`);
        ctx.fillStyle = sg;
        ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
      }
    }

    // ── Slow warm motes (like floating candle sparks) ──
    if (!this._presleepMotes) {
      this._presleepMotes = Array.from({ length: 26 }, () => ({
        x: Math.random(), y: Math.random(),
        r: 0.7 + Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 0.00008,
        vy: -(0.00005 + Math.random() * 0.00007),
        ph: Math.random() * Math.PI * 2,
      }));
    }
    this._presleepMotes.forEach(m => {
      m.x = (m.x + m.vx + 1) % 1;
      m.y += m.vy;
      if (m.y < 0) { m.y = 1.0; m.x = Math.random(); }
      const al = 0.22 + 0.14 * Math.sin(t * 0.016 + m.ph);
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(235,165,90,${al})`;
      ctx.fill();
    });

    this.t++;
  }

  // ── 睡眠 — Aurora Night (time-aware) ─────────────────────────────────────
  _drawSleep() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const hr    = this._getHour();
    const night = Math.max(0, 1 - Math.max(0, Math.sin((hr - 6) / 12 * Math.PI))); // 1=night
    const deep  = Math.max(0, 1 - Math.abs(hr - 0) / 4); // deepest at midnight

    // Sky — deeper at actual night, slightly lighter if daytime
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    `rgb(${(1 +night*0)|0},${(7+night*0)|0},${(16+night*0)|0})`);
    sky.addColorStop(0.45, `rgb(3,${(12+night*0)|0},${(28-night*2)|0})`);
    sky.addColorStop(0.85, `rgb(5,${(15+night*0)|0},${(34-night*4)|0})`);
    sky.addColorStop(1,    `rgb(4,13,${(26-night*2)|0})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Aurora curtains — brightest at actual night
    const auroraAlpha = 0.10 + night * 0.14;
    const curtains = [
      { xR: 0.25, wR: 0.32, spd: 0.080, ph: 0.0, rgb: [0,  195, 155], a: auroraAlpha },
      { xR: 0.58, wR: 0.28, spd: 0.065, ph: 2.1, rgb: [70, 120, 220], a: auroraAlpha * 0.80 },
      { xR: 0.76, wR: 0.22, spd: 0.100, ph: 4.4, rgb: [140, 55, 200], a: auroraAlpha * 0.62 },
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
      gr.addColorStop(0.12, `rgba(${r},${g},${b},${c.a.toFixed(3)})`);
      gr.addColorStop(0.65, `rgba(${r},${g},${b},${(c.a * 0.52).toFixed(3)})`);
      gr.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr; ctx.fill();
    });

    // Stars — brighter at actual night
    const starBrightness = 0.12 + night * 0.55;
    for (let i = 0; i < 80; i++) {
      const s  = i * 127.1;
      const sx = ((Math.sin(s * 0.11) + 1) / 2) * W;
      const sy = ((Math.sin(s * 0.073) + 1) / 2) * H * 0.78;
      const tw = starBrightness * Math.abs(Math.sin(t * (0.0003 + (i % 7) * 0.00005) * 5000 + s));
      const sr = 0.35 + 1.4 * Math.abs(Math.sin(s * 0.29));
      ctx.fillStyle = `rgba(200,225,255,${tw.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }

    // Moon — always visible, halo brightens at night
    const mx = W * 0.74, my = H * 0.17;
    const mr = Math.min(W, H) * 0.064;
    const mhG = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 3.2);
    mhG.addColorStop(0,   `rgba(195,215,255,${(0.06+night*0.09).toFixed(3)})`);
    mhG.addColorStop(1,   'transparent');
    ctx.fillStyle = mhG; ctx.beginPath(); ctx.arc(mx, my, mr * 3.2, 0, Math.PI * 2); ctx.fill();
    const mG = ctx.createRadialGradient(mx - mr * 0.18, my - mr * 0.18, 0, mx, my, mr);
    mG.addColorStop(0,   'rgba(242,238,215,0.95)');
    mG.addColorStop(0.7, 'rgba(212,205,175,0.90)');
    mG.addColorStop(1,   'rgba(190,182,148,0.35)');
    ctx.fillStyle = mG; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();

    // Ocean waves — always present
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

  // ── Journey phase system ──────────────────────────────────────────────────

  _scheduleJourneyPhases(isNap = false) {
    this._journeyTimers.forEach(clearTimeout);
    this._journeyTimers = [];
    this._journeyPhase = 1;
    this._updateJourneyPhaseDisplay();

    if (isNap) {
      // Nap mode: just 1 phase, auto-sets 20min timer suggestion
      return;
    }

    // Phase 2 at 20 min: show ドリフト
    this._journeyTimers.push(setTimeout(() => {
      if (!this.isPlaying) return;
      this._journeyPhase = 2;
      this._updateJourneyPhaseDisplay();
      // Gently reduce nature layer volumes
      this.layers.forEach((l) => {
        if (!l.rightOsc) { // non-binaural layers
          const now = this.ac.currentTime;
          const cur = l.gainNode.gain.value;
          l.gainNode.gain.setTargetAtTime(cur * 0.85, now, 120);
        }
      });
    }, 20 * 60 * 1000));

    // Phase 3 at 60 min: show 深い眠り
    this._journeyTimers.push(setTimeout(() => {
      if (!this.isPlaying) return;
      this._journeyPhase = 3;
      this._updateJourneyPhaseDisplay();
      // Further reduce non-binaural layers
      this.layers.forEach((l) => {
        if (!l.rightOsc) {
          const now = this.ac.currentTime;
          const cur = l.gainNode.gain.value;
          l.gainNode.gain.setTargetAtTime(cur * 0.70, now, 180);
        }
      });
    }, 60 * 60 * 1000));
  }

  _updateJourneyPhaseDisplay() {
    const badge = document.getElementById('journey-phase-badge');
    if (!badge) return;
    const labels = ['', '🌙 入眠フェーズ', '✨ ドリフト中', '💫 深い眠り'];
    if (this._journeyPhase > 0) {
      badge.textContent = labels[this._journeyPhase] || '';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // ── Breathing Guide ───────────────────────────────────────────────────────

  _toggleBreathGuide() {
    if (this._breathGuideActive) {
      this._stopBreathGuide();
    } else {
      this._startBreathGuide(5);
    }
    const btn = document.getElementById('breath-btn');
    if (btn) btn.classList.toggle('active', this._breathGuideActive);
  }

  _startBreathGuide(cycles = 5) {
    this._breathGuideActive = true;
    this._breathTimers.forEach(clearTimeout);
    this._breathTimers = [];

    const guide  = document.getElementById('breath-guide');
    const ring   = document.getElementById('breath-ring');
    const text   = document.getElementById('breath-text');
    const countEl = document.getElementById('breath-count');
    if (!guide) return;

    guide.classList.add('active');
    let cyclesDone = 0;

    const runCycle = () => {
      if (!this._breathGuideActive || cyclesDone >= cycles) {
        this._stopBreathGuide();
        return;
      }
      cyclesDone++;
      if (countEl) countEl.textContent = `あと ${cycles - cyclesDone + 1} 回`;

      // Inhale 4s
      if (ring) ring.className = 'breath-ring inhale';
      if (text) text.textContent = '息を吸って';

      this._breathTimers.push(setTimeout(() => {
        if (!this._breathGuideActive) return;
        // Hold 7s
        if (ring) ring.className = 'breath-ring hold';
        if (text) text.textContent = '止める';

        this._breathTimers.push(setTimeout(() => {
          if (!this._breathGuideActive) return;
          // Exhale 8s
          if (ring) ring.className = 'breath-ring exhale';
          if (text) text.textContent = '吐いて';
          this._breathTimers.push(setTimeout(runCycle, 8000));
        }, 7000));
      }, 4000));
    };

    runCycle();
  }

  _stopBreathGuide() {
    this._breathGuideActive = false;
    this._breathTimers.forEach(clearTimeout);
    this._breathTimers = [];
    const guide = document.getElementById('breath-guide');
    if (guide) guide.classList.remove('active');
    const ring  = document.getElementById('breath-ring');
    if (ring)  ring.className = 'breath-ring';
    const btn = document.getElementById('breath-btn');
    if (btn)   btn.classList.remove('active');
    this._updateJourneyPhaseDisplay(); // restore journey display if active
  }

  // ── Sleep extras panel ───────────────────────────────────────────────────

  _updateSleepExtras(cat) {
    const el = document.getElementById('sleep-extras');
    if (!el) return;
    if (cat === 'sleep') {
      el.classList.remove('hidden');
      // Wire up buttons once
      const journeyBtn = document.getElementById('journey-btn');
      if (journeyBtn && !journeyBtn._listenerAdded) {
        journeyBtn._listenerAdded = true;
        journeyBtn.addEventListener('click', () => {
          const isJourney = this._uiPreset === 3;
          this._uiPreset = isJourney ? 1 : 3;
          this._renderPresetRow(this._uiCat, this._uiMood);
          journeyBtn.classList.toggle('active', !isJourney);
          if (this.isPlaying) {
            this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.10);
            this._stopLayersOnly();
            this._startCategory(this._uiCat, this._uiMood, 1.0);
          }
        });
      }
      const breathBtn = document.getElementById('breath-btn');
      if (breathBtn && !breathBtn._listenerAdded) {
        breathBtn._listenerAdded = true;
        breathBtn.addEventListener('click', () => this._toggleBreathGuide());
      }
    } else {
      el.classList.add('hidden');
      if (this._breathGuideActive) this._stopBreathGuide();
      // Reset journey phase badge
      const badge = document.getElementById('journey-phase-badge');
      if (badge) badge.classList.add('hidden');
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
    // Pre-warm: start audio decoding on first UI interaction so play is instant
    if (!this.ac || this.ac.state === 'closed') {
      this._initAudio();
    }

    if (cat === this._uiCat && !this.isPlaying) return;

    const wasPlaying = this.isPlaying;
    this._uiCat    = cat;
    this._uiMood   = 0;
    this._uiPreset = 0;

    // Update tab UI instantly
    document.querySelectorAll('.mode-tab').forEach(t => {
      const active = t.dataset.cat === cat;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this._renderSitChips();
    this._renderModeTagline();
    this._renderTimerBtns(cat);
    this._renderPresetRow(cat, 0);
    this._updateSleepExtras(cat);
    if (!wasPlaying) this._renderLayersPreview();

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
    // Pre-warm: start audio decoding on first UI interaction so play is instant
    if (!this.ac || this.ac.state === 'closed') {
      this._initAudio();
    }

    if (idx === this._uiMood) return;
    const wasPlaying = this.isPlaying;
    this._uiMood   = idx;
    this._uiPreset = 0;

    document.querySelectorAll('.sit-chip').forEach(c => {
      c.classList.toggle('active', +c.dataset.idx === idx);
    });
    this._renderPresetRow(this._uiCat, idx);
    if (!wasPlaying) this._renderLayersPreview();

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
    const moods = cat === 'sleep' ? SLEEP_MOODS : cat === 'presleep' ? PRESLEEP_MOODS : cat === 'walk' ? WALK_MOODS : MOOD_LABELS;
    moods.forEach((mood, idx) => {
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
      relax:     'α波でゆっくりリラックス',
      focus:     'α波でフロー状態へ',
      meditation:'θ波で深い瞑想状態へ',
      sleep:     'δ波で深い眠りへ',
      presleep: 'お風呂から眠りへ、体と心をほどいていく',
      walk: '自然の音に包まれて、一歩一歩をリフレッシュ',
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
    this._renderPresetRow(this._uiCat, this._uiMood);
    this._updateSleepExtras(this._uiCat);
    this._renderLayersPreview();

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

    // ── Show initial canvas animation for the selected mode ──
    this._startVisuals(this._uiCat);
  }
}

document.addEventListener('DOMContentLoaded', () => { new HealingApp(); });
