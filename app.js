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
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const dawn = Math.max(0, 1 - Math.abs(hr - 6.5) / 2.8);
    const aur  = Math.max(0, 1 - day * 0.88);

    // Rich sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    `rgb(${(7  + day*16)|0},${(5 +day*10)|0},${(22+day*44)|0})`);
    sky.addColorStop(0.35, `rgb(${(20 + day*30 + dawn*30)|0},${(8 +day*18+dawn*10)|0},${(42+day*28)|0})`);
    sky.addColorStop(0.60, `rgb(${(55 + dawn*80)|0},${(14+dawn*32)|0},${(62-dawn*20)|0})`);
    sky.addColorStop(0.80, `rgb(${(110+ dawn*110)|0},${(28+dawn*40)|0},${(20+dawn*14)|0})`);
    sky.addColorStop(1,    `rgb(${(175+ dawn*65)|0},${(60+dawn*28)|0},${14})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Aurora ribbons — wide, vivid, multiple colors
    if (aur > 0.02) {
      const bands = [
        { y:0.18, amp:0.060, freq:2.0, spd:0.17, rgb:[40,220,255],  a:0.38*aur, h:0.18 },
        { y:0.30, amp:0.048, freq:1.6, spd:0.12, rgb:[190,80,230],  a:0.30*aur, h:0.15 },
        { y:0.10, amp:0.034, freq:2.8, spd:0.22, rgb:[255,180,60],  a:0.22*aur, h:0.11 },
        { y:0.22, amp:0.028, freq:3.2, spd:0.28, rgb:[80,255,160],  a:0.16*aur, h:0.09 },
      ];
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      bands.forEach(b => {
        const yM = b.y * H, hH = b.h * H;
        const [r, g, bl] = b.rgb;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 3) {
          const w = Math.sin(x / W * Math.PI * b.freq + t * b.spd) * b.amp * H;
          x === 0 ? ctx.moveTo(x, yM+w-hH) : ctx.lineTo(x, yM+w-hH);
        }
        for (let x = W; x >= 0; x -= 3) {
          const w = Math.sin(x / W * Math.PI * b.freq + t * b.spd) * b.amp * H;
          ctx.lineTo(x, yM+w+hH);
        }
        ctx.closePath();
        const gr = ctx.createLinearGradient(0, yM-hH, 0, yM+hH*1.6);
        gr.addColorStop(0,    `rgba(${r},${g},${bl},0)`);
        gr.addColorStop(0.28, `rgba(${r},${g},${bl},${b.a.toFixed(3)})`);
        gr.addColorStop(0.70, `rgba(${r},${g},${bl},${(b.a*0.45).toFixed(3)})`);
        gr.addColorStop(1,    `rgba(${r},${g},${bl},0)`);
        ctx.fillStyle = gr; ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over'; ctx.restore();
    }

    // Horizon glow
    const horA = dawn * 0.60 + day * 0.20;
    if (horA > 0.02) {
      const hor = ctx.createRadialGradient(cx, H, 0, cx, H, H * 0.85);
      hor.addColorStop(0,    `rgba(220,85,25,${horA.toFixed(3)})`);
      hor.addColorStop(0.28, `rgba(175,40,65,${(horA*0.42).toFixed(3)})`);
      hor.addColorStop(0.65, `rgba(90,20,110,${(horA*0.12).toFixed(3)})`);
      hor.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = hor; ctx.fillRect(0, 0, W, H);
    }

    // Sun disc with rays
    const sunVis = Math.max(0, Math.min(1, (hr - 5) / 3));
    if (sunVis > 0.02) {
      const sunR = Math.min(W, H) * 0.072;
      const sunY = H * 0.98 - sunR * (0.5 + sunVis * 2.4);
      // Light shaft bloom
      const bloom = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, H * 0.55);
      bloom.addColorStop(0,    `rgba(255,235,140,${(0.22*sunVis).toFixed(3)})`);
      bloom.addColorStop(0.12, `rgba(255,160,40,${(0.12*sunVis).toFixed(3)})`);
      bloom.addColorStop(0.40, `rgba(255,100,20,${(0.05*sunVis).toFixed(3)})`);
      bloom.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = bloom; ctx.fillRect(0, 0, W, H);
      // Sun disc
      const sunG = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, sunR * 3.2);
      sunG.addColorStop(0,    `rgba(255,252,210,${(0.98*sunVis).toFixed(2)})`);
      sunG.addColorStop(0.32, `rgba(255,185,55,${(0.60*sunVis).toFixed(2)})`);
      sunG.addColorStop(1,    'rgba(255,100,15,0)');
      ctx.fillStyle = sunG; ctx.beginPath(); ctx.arc(cx, sunY, sunR*3.2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = `rgba(255,252,225,${(0.97*sunVis).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(cx, sunY, sunR, 0, Math.PI*2); ctx.fill();
    }

    // Drifting clouds (slow, layered)
    if (!this._mornClouds) {
      this._mornClouds = Array.from({length:5}, (_, i) => ({
        x: (i / 5) * W + Math.random() * W * 0.2,
        y: H * (0.15 + Math.random() * 0.30),
        w: W * (0.18 + Math.random() * 0.22),
        h: H * (0.045 + Math.random() * 0.040),
        spd: 0.00006 + Math.random() * 0.00005,
        a: 0.06 + Math.random() * 0.10,
      }));
    }
    this._mornClouds.forEach(cl => {
      cl.x = (cl.x + cl.spd * W + W) % (W * 1.4) - W * 0.2;
      const cg = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.w * 0.55);
      const ca = (cl.a * (dawn * 0.7 + day * 0.5 + 0.2)).toFixed(3);
      const cr = (220 + dawn * 35) | 0, cg2 = (170 + dawn * 30) | 0, cb = (200 - dawn * 60) | 0;
      cg.addColorStop(0, `rgba(${cr},${cg2},${cb},${ca})`);
      cg.addColorStop(1, `rgba(${cr},${cg2},${cb},0)`);
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.ellipse(cl.x, cl.y, cl.w*0.55, cl.h, 0, 0, Math.PI*2); ctx.fill();
    });

    // Bird silhouettes at dawn
    if (!this._mornBirds) {
      this._mornBirds = Array.from({length:8}, (_, i) => ({
        x: Math.random() * W, y: H * (0.12 + Math.random() * 0.30),
        spd: 0.00025 + Math.random() * 0.00030,
        flapPhase: Math.random() * Math.PI * 2,
        size: 3.5 + Math.random() * 4,
      }));
    }
    const birdA = Math.max(0, dawn * 0.55 + day * 0.25);
    if (birdA > 0.03) {
      ctx.fillStyle = `rgba(20,8,15,${birdA.toFixed(3)})`;
      this._mornBirds.forEach(b => {
        b.x = (b.x + b.spd * W + W * 1.2) % (W * 1.4) - W * 0.1;
        const flap = Math.sin(t * 3.5 + b.flapPhase) * b.size * 0.45;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.bezierCurveTo(b.x - b.size*1.2, b.y - flap, b.x - b.size*2.4, b.y - flap*0.3, b.x - b.size*3, b.y);
        ctx.bezierCurveTo(b.x - b.size*1.2, b.y + flap*0.2, b.x - b.size*0.3, b.y + flap*0.1, b.x, b.y);
        ctx.bezierCurveTo(b.x + b.size*0.3,  b.y + flap*0.1, b.x + b.size*1.2, b.y + flap*0.2, b.x + b.size*3, b.y);
        ctx.bezierCurveTo(b.x + b.size*2.4, b.y - flap*0.3, b.x + b.size*1.2, b.y - flap, b.x, b.y);
        ctx.fill();
      });
    }

    // Warm motes
    const moteColor = dawn > 0.2 ? `255,210,90` : (day > 0.5 ? `200,230,255` : `180,180,255`);
    const moteAlpha = 0.10 + dawn * 0.28 + (1-day) * 0.14;
    for (let i = 0; i < 55; i++) {
      const s = i * 137.508;
      const px = ((Math.sin(s*0.17)+1)/2)*W;
      const vy = t*0.00055*(0.6+0.4*Math.sin(s*0.3));
      const py = ((((Math.sin(s*0.11)+1)/2) - vy) % 1 + 1) % 1 * H;
      const al = (Math.min(moteAlpha,0.70)*Math.abs(Math.sin(t*0.38+s))).toFixed(2);
      ctx.fillStyle = `rgba(${moteColor},${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.5+1.6*Math.abs(Math.sin(s*0.44)), 0, Math.PI*2); ctx.fill();
    }
  }

  // ── リラックス — Floating Orbs (time-aware) ───────────────────────────────
  // ゆっくりと漂う発光体: 深海の生物発光 / 水面を漂う光
  _drawRelax() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.44;
    const U  = Math.min(W, H);
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const dusk = Math.max(0, 1 - Math.abs(hr - 18) / 3.0);

    // Background
    const bgR = (3  + day*5  + dusk*22) | 0;
    const bgG = (22 + day*20 + dusk*10) | 0;
    const bgB = (36 + day*28 - dusk*14) | 0;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0,   `rgb(${bgR},${bgG},${bgB})`);
    bg.addColorStop(0.5, `rgb(${(bgR+3)|0},${(bgG+8)|0},${(bgB+12)|0})`);
    bg.addColorStop(1,   `rgb(${(bgR+6)|0},${(bgG+15)|0},${(bgB+22)|0})`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Caustic light ripples on the "surface"
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let ci = 0; ci < 6; ci++) {
      const cx2 = W * (0.1 + ci * 0.16 + Math.sin(t*0.04+ci)*0.06);
      const cy2 = H * (0.15 + Math.sin(t*0.028+ci*1.1)*0.08);
      const cr  = U * (0.12 + 0.06 * Math.sin(t*0.055+ci));
      const al  = (0.04 + 0.03 * Math.sin(t*0.08+ci)) * (1 + dusk*0.3);
      const caus = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, cr);
      const [cR,cG,cB] = dusk > 0.3 ? [140,100,240] : [0,200,210];
      caus.addColorStop(0,   `rgba(${cR},${cG},${cB},${al.toFixed(3)})`);
      caus.addColorStop(0.5, `rgba(${cR},${cG},${cB},${(al*0.3).toFixed(3)})`);
      caus.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = caus; ctx.beginPath(); ctx.arc(cx2, cy2, cr, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.restore();

    // Deep ambient glow
    const glowRgb = dusk > 0.2 ? `80,50,180` : `0,120,130`;
    const glowG = ctx.createRadialGradient(cx, cy, 0, cx, cy, U * 0.58);
    glowG.addColorStop(0,   `rgba(${glowRgb},${(0.18 + day*0.08).toFixed(3)})`);
    glowG.addColorStop(1,   'transparent');
    ctx.fillStyle = glowG; ctx.fillRect(0, 0, W, H);

    // 4 large drifting orbs
    const orbs = [
      { px: cx + Math.sin(t*0.042)*W*0.28, py: cy + Math.cos(t*0.031)*H*0.20,
        rgb: dusk>0.3?[140,90,240]:(day>0.5?[0,205,205]:[0,180,180]), r: U*0.135 },
      { px: cx + Math.sin(t*0.033+2.1)*W*0.24, py: cy + Math.cos(t*0.044+2.1)*H*0.17,
        rgb: dusk>0.3?[100,55,225]:(day>0.5?[35,185,215]:[30,150,200]), r: U*0.108 },
      { px: cx + Math.sin(t*0.055+4.3)*W*0.19, py: cy + Math.cos(t*0.038+4.3)*H*0.22,
        rgb: dusk>0.3?[185,115,255]:(day>0.5?[100,225,210]:[80,200,200]), r: U*0.092 },
      { px: cx + Math.sin(t*0.026+1.5)*W*0.34, py: cy + Math.cos(t*0.060+1.5)*H*0.14,
        rgb: dusk>0.3?[60,80,210]:(day>0.5?[15,160,230]:[20,130,210]), r: U*0.068 },
    ];

    orbs.forEach((o, oi) => {
      const [r, g, b] = o.rgb;
      const pulse = 0.5 + 0.5 * Math.sin(t*(0.55+oi*0.15)+oi*2.1);

      // Ripple rings (3 per orb)
      for (let ri = 0; ri < 3; ri++) {
        const rProg = ((t*0.09 + oi*0.33 + ri*0.33) % 1);
        const rRad  = o.r * (0.85 + rProg * 4.2);
        const rAlp  = (1 - rProg) * 0.18;
        ctx.beginPath(); ctx.arc(o.px, o.py, rRad, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${rAlp.toFixed(3)})`;
        ctx.lineWidth = 1.0; ctx.stroke();
      }
      // Outer glow
      const gG = ctx.createRadialGradient(o.px, o.py, 0, o.px, o.py, o.r*(3.0+pulse));
      gG.addColorStop(0,   `rgba(${r},${g},${b},${(0.20+pulse*0.12).toFixed(3)})`);
      gG.addColorStop(0.4, `rgba(${r},${g},${b},${(0.07+pulse*0.04).toFixed(3)})`);
      gG.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gG; ctx.beginPath(); ctx.arc(o.px, o.py, o.r*(3.0+pulse), 0, Math.PI*2); ctx.fill();
      // Core
      const cG = ctx.createRadialGradient(o.px, o.py, 0, o.px, o.py, o.r);
      cG.addColorStop(0,   `rgba(${Math.min(255,r+90)},${Math.min(255,g+70)},${Math.min(255,b+50)},${(0.60+pulse*0.28).toFixed(3)})`);
      cG.addColorStop(0.5, `rgba(${r},${g},${b},${(0.32+pulse*0.14).toFixed(3)})`);
      cG.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = cG; ctx.beginPath(); ctx.arc(o.px, o.py, o.r, 0, Math.PI*2); ctx.fill();
    });

    // Water surface shimmer at bottom
    const waveY = H * 0.82;
    ctx.save(); ctx.globalAlpha = 0.12 + day*0.06;
    for (let wi = 0; wi < 5; wi++) {
      const wy = waveY + wi * 6 + Math.sin(t*0.12+wi)*4;
      ctx.beginPath();
      ctx.moveTo(0, wy);
      for (let x = 0; x <= W; x += 8) {
        ctx.lineTo(x, wy + Math.sin(x/W*Math.PI*5 + t*0.18+wi*0.6)*3);
      }
      ctx.strokeStyle = dusk > 0.2 ? 'rgba(180,140,255,0.6)' : 'rgba(100,220,220,0.5)';
      ctx.lineWidth = 0.8; ctx.stroke();
    }
    ctx.restore();

    // Floating motes
    const moteRgb = dusk > 0.2 ? `180,140,255` : `100,220,220`;
    for (let i = 0; i < 48; i++) {
      const s  = i * 137.508;
      const px = ((Math.sin(s*0.17)+1)/2)*W;
      const vy = t*0.00032*(0.5+0.5*Math.sin(s*0.3));
      const py = ((((Math.sin(s*0.11)+1)/2)-vy)%1+1)%1*H;
      const al = (0.08+0.44*Math.abs(Math.sin(t*0.28+s))).toFixed(2);
      ctx.fillStyle = `rgba(${moteRgb},${al})`;
      ctx.beginPath(); ctx.arc(px, py, 0.6+1.5*Math.abs(Math.sin(s*0.44)), 0, Math.PI*2); ctx.fill();
    }
  }

  // ── 散歩 — Outdoor Walk (time-aware) ─────────────────────────────────────
  _drawWalk() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const eve  = Math.max(0, 1 - Math.abs(hr - 18) / 3);
    const nite = Math.max(0, 1 - day * 1.4);
    const dawn = Math.max(0, 1 - Math.abs(hr - 6) / 2.5);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    if (nite > 0.6) {
      sky.addColorStop(0, `rgb(${(4+dawn*8)|0},${(6+dawn*10)|0},${(18+dawn*20)|0})`);
      sky.addColorStop(0.5, `rgb(${(6+dawn*12)|0},${(8+dawn*14)|0},${(22+dawn*22)|0})`);
      sky.addColorStop(1,   `rgb(${(8+dawn*18)|0},${(16+dawn*20)|0},${(14+dawn*10)|0})`);
    } else if (eve > 0.3) {
      sky.addColorStop(0,   'rgb(18,12,48)');
      sky.addColorStop(0.35,'rgb(80,30,80)');
      sky.addColorStop(0.65,'rgb(180,60,40)');
      sky.addColorStop(1,   'rgb(220,100,30)');
    } else {
      sky.addColorStop(0,   `rgb(${(30+day*80)|0},${(90+day*90)|0},${(170+day*55)|0})`);
      sky.addColorStop(0.55,`rgb(${(60+day*50)|0},${(130+day*60)|0},${(180+day*20)|0})`);
      sky.addColorStop(1,   `rgb(${(40+day*60)|0},${(100+day*80)|0},${(50+day*30)|0})`);
    }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Sun or Moon
    if (nite < 0.6) {
      const sunX = W * 0.68, sunY = H * (0.38 - day*0.25 + eve*0.10);
      if (eve > 0.3) {
        // Golden hour sun disc
        const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H*0.40);
        sg.addColorStop(0,    `rgba(255,200,60,${(0.90).toFixed(2)})`);
        sg.addColorStop(0.04, `rgba(255,160,30,0.80)`);
        sg.addColorStop(0.18, `rgba(255,100,20,${(eve*0.45).toFixed(3)})`);
        sg.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.fillRect(0,0,W,H);
        ctx.fillStyle = 'rgba(255,220,80,0.96)';
        ctx.beginPath(); ctx.arc(sunX, sunY, H*0.030, 0, Math.PI*2); ctx.fill();
      } else if (day > 0.1) {
        const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, H*0.30);
        sg.addColorStop(0,    `rgba(255,248,200,${(day*0.85).toFixed(2)})`);
        sg.addColorStop(0.08, `rgba(255,210,80,${(day*0.35).toFixed(2)})`);
        sg.addColorStop(1,    'rgba(0,0,0,0)');
        ctx.fillStyle = sg; ctx.fillRect(0,0,W,H);
        ctx.fillStyle = `rgba(255,252,220,${(day*0.95).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(sunX, sunY, H*0.028, 0, Math.PI*2); ctx.fill();
      }
    } else {
      // Moon
      const moonX = W*0.72, moonY = H*0.18;
      const moonG = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, H*0.15);
      moonG.addColorStop(0,    `rgba(220,225,255,${(nite*0.50).toFixed(3)})`);
      moonG.addColorStop(0.08, `rgba(200,210,255,${(nite*0.18).toFixed(3)})`);
      moonG.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.fillStyle = moonG; ctx.fillRect(0,0,W,H);
      ctx.fillStyle = `rgba(230,235,255,${(nite*0.88).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(moonX, moonY, H*0.024, 0, Math.PI*2); ctx.fill();
    }

    // Stars at night
    if (nite > 0.25) {
      for (let i = 0; i < 60; i++) {
        const s = i * 127.1;
        const sx = ((Math.sin(s*0.11)+1)/2)*W;
        const sy = ((Math.sin(s*0.073)+1)/2)*H*0.65;
        const sa = nite * 0.55 * Math.abs(Math.sin(t*0.5+s));
        ctx.fillStyle = `rgba(220,225,255,${sa.toFixed(2)})`;
        ctx.beginPath(); ctx.arc(sx, sy, 0.5+Math.abs(Math.sin(s*0.44)), 0, Math.PI*2); ctx.fill();
      }
    }

    // Drifting clouds
    if (!this._walkClouds) {
      this._walkClouds = Array.from({length:4}, (_,i) => ({
        x: (i/4)*W*1.2, y: H*(0.12+i*0.06),
        w: W*(0.20+i*0.04), h: H*0.040,
        spd: 0.00004+i*0.00002, a: 0.07+i*0.02,
      }));
    }
    if (nite < 0.7) {
      this._walkClouds.forEach(cl => {
        cl.x = (cl.x + cl.spd*W + W*1.3) % (W*1.5) - W*0.2;
        const cg = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.w*0.55);
        const ca = (cl.a * (1-nite*0.8) * (eve>0.3?0.6:1.0)).toFixed(3);
        const [cr,cg2,cb] = eve>0.3 ? [240,180,140] : [220,225,235];
        cg.addColorStop(0,  `rgba(${cr},${cg2},${cb},${ca})`);
        cg.addColorStop(1,  `rgba(${cr},${cg2},${cb},0)`);
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.ellipse(cl.x, cl.y, cl.w*0.55, cl.h, 0, 0, Math.PI*2); ctx.fill();
      });
    }

    // Horizon soft fog / ground haze
    const fogY = H * 0.60;
    const fog = ctx.createLinearGradient(0, fogY-20, 0, fogY+40);
    const fogC = eve > 0.3 ? [200,140,80] : nite > 0.5 ? [30,40,50] : [160,195,160];
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(0.5, `rgba(${fogC[0]},${fogC[1]},${fogC[2]},${(0.08+day*0.06+eve*0.10).toFixed(3)})`);
    fog.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fog; ctx.fillRect(0, fogY-20, W, 60);

    // Ground — layered green/brown
    const gndY = H * 0.62;
    const gnd = ctx.createLinearGradient(0, gndY, 0, H);
    if (eve > 0.3) {
      gnd.addColorStop(0, `rgba(${(60+eve*40)|0},${(35+eve*20)|0},10,0.90)`);
      gnd.addColorStop(1, `rgba(30,15,5,0.95)`);
    } else if (nite > 0.5) {
      gnd.addColorStop(0, `rgba(10,22,12,0.92)`);
      gnd.addColorStop(1, `rgba(5,10,6,0.96)`);
    } else {
      gnd.addColorStop(0, `rgba(${(30+day*40)|0},${(75+day*55)|0},${(18+day*20)|0},0.88)`);
      gnd.addColorStop(1, `rgba(${(12+day*18)|0},${(38+day*28)|0},${(8+day*10)|0},0.95)`);
    }
    ctx.fillStyle = gnd; ctx.fillRect(0, gndY, W, H-gndY);

    // Path perspective (two converging lines to horizon vanishing point)
    const vx = W * 0.50, vy = gndY + (H - gndY) * 0.05;
    const pathAlpha = (0.08 + day*0.10 + eve*0.08).toFixed(3);
    const pathC = eve > 0.3 ? [200,150,80] : nite > 0.5 ? [80,90,100] : [180,195,140];
    ctx.save();
    const pathGrd = ctx.createLinearGradient(0, vy, 0, H);
    pathGrd.addColorStop(0, `rgba(${pathC[0]},${pathC[1]},${pathC[2]},0)`);
    pathGrd.addColorStop(0.3, `rgba(${pathC[0]},${pathC[1]},${pathC[2]},${pathAlpha})`);
    pathGrd.addColorStop(1, `rgba(${pathC[0]},${pathC[1]},${pathC[2]},${pathAlpha})`);
    ctx.fillStyle = pathGrd;
    ctx.beginPath();
    ctx.moveTo(vx - 8, vy);
    ctx.lineTo(W * 0.22, H);
    ctx.lineTo(W * 0.78, H);
    ctx.lineTo(vx + 8, vy);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Background trees (small, lighter, far away)
    const bgTreeC = nite > 0.5
      ? `rgba(12,20,14,0.60)` : eve > 0.3
      ? `rgba(55,28,12,0.55)` : `rgba(${(35+day*15)|0},${(75+day*30)|0},${(20+day*15)|0},0.50)`;
    for (let i = 0; i < 12; i++) {
      const bx = W * (i / 12 + 0.04);
      const bh = H * (0.12 + (i%3)*0.04);
      const bw = W * 0.04;
      const sway = Math.sin(t*0.15 + i*0.8) * 0.008 * W;
      ctx.fillStyle = bgTreeC;
      ctx.beginPath();
      ctx.ellipse(bx+sway, gndY - bh*0.55, bw*0.45, bh*0.55, sway*0.02, 0, Math.PI*2);
      ctx.fill();
      ctx.fillRect(bx+sway - bw*0.06, gndY - bh*0.18, bw*0.12, bh*0.20);
    }

    // Foreground trees (large, dark, close)
    const fgTreeC = nite > 0.5
      ? `rgba(6,14,8,0.92)` : eve > 0.3
      ? `rgba(30,14,6,0.85)` : `rgba(${(15+day*12)|0},${(50+day*25)|0},${(12+day*10)|0},0.80)`;
    const fgTrees = [
      {x:0.06,h:0.50,w:0.11,s:1.8,sp:0.18},{x:0.16,h:0.40,w:0.09,s:1.5,sp:0.15},
      {x:0.82,h:0.45,w:0.10,s:1.6,sp:0.20},{x:0.93,h:0.52,w:0.12,s:2.0,sp:0.22},
    ];
    fgTrees.forEach(tr => {
      const sway = Math.sin(t*tr.sp)*tr.s/100;
      const tx   = (tr.x+sway)*W;
      const th   = tr.h*H, tw = tr.w*W;
      ctx.fillStyle = fgTreeC;
      ctx.fillRect(tx - tw*0.055, gndY - th*0.30, tw*0.11, th*0.32);
      ctx.beginPath();
      ctx.ellipse(tx, gndY - th*0.60, tw*0.48, th*0.48, sway*0.4, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(tx + tw*0.12, gndY - th*0.48, tw*0.34, th*0.35, sway*0.3, 0, Math.PI*2);
      ctx.fill();
    });

    // Grass blades at bottom edge
    ctx.save(); ctx.globalAlpha = 0.55 + day*0.20;
    const grassC = eve > 0.3 ? 'rgba(120,70,20,1)' : nite > 0.5 ? 'rgba(20,35,18,1)' : `rgba(${(50+day*30)|0},${(110+day*50)|0},${(25+day*20)|0},1)`;
    for (let i = 0; i < 35; i++) {
      const gx = W * (i/35) + Math.sin(i*2.3)*8;
      const gh = H*(0.038+0.024*Math.sin(i*1.7));
      const bend = Math.sin(t*0.20+i*0.9)*0.018*W;
      ctx.beginPath(); ctx.moveTo(gx, H);
      ctx.quadraticCurveTo(gx + bend, H - gh*0.5, gx + bend*1.6, H - gh);
      ctx.lineWidth = 1.2; ctx.strokeStyle = grassC; ctx.stroke();
    }
    ctx.restore();

    // Animated flying birds (V formation, moves across sky)
    if (!this._walkBirds) {
      this._walkBirds = { x: -0.1, y: 0.20, spd: 0.00020 };
    }
    const wb = this._walkBirds;
    wb.x = (wb.x + wb.spd) % 1.2;
    if (wb.x > 1.15) { wb.y = 0.08 + Math.random()*0.30; }
    const birdAlpha = (0.35 + day*0.35 + dawn*0.20) * (1-nite*0.7);
    if (birdAlpha > 0.04) {
      const bCol = eve > 0.3 ? `rgba(60,30,10,${birdAlpha.toFixed(3)})` : `rgba(15,10,20,${birdAlpha.toFixed(3)})`;
      ctx.fillStyle = bCol;
      const formation = [{dx:0,dy:0},{dx:-18,dy:-7},{dx:18,dy:-7},{dx:-34,dy:-16},{dx:34,dy:-16}];
      formation.forEach((pos, fi) => {
        const bx = wb.x*W + pos.dx;
        const by = wb.y*H + pos.dy;
        const flap = Math.sin(t*4 + fi*0.8) * 4;
        const bs = 3.5 - fi*0.3;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.bezierCurveTo(bx-bs*1.2, by-flap, bx-bs*2.5, by-flap*0.3, bx-bs*3, by);
        ctx.bezierCurveTo(bx-bs*1.2, by+flap*0.2, bx-bs*0.3, by+flap*0.1, bx, by);
        ctx.bezierCurveTo(bx+bs*0.3, by+flap*0.1, bx+bs*1.2, by+flap*0.2, bx+bs*3, by);
        ctx.bezierCurveTo(bx+bs*2.5, by-flap*0.3, bx+bs*1.2, by-flap, bx, by);
        ctx.fill();
      });
    }

    // Fireflies / light motes
    if (!this._walkMotes) {
      this._walkMotes = Array.from({length:24}, () => ({
        x:Math.random(), y:0.05+Math.random()*0.75,
        r:0.8+Math.random()*2.2, dx:(Math.random()-0.5)*0.00016,
        dy:-Math.random()*0.00010-0.00003,
        phase:Math.random()*Math.PI*2, spd:0.4+Math.random()*0.8,
      }));
    }
    this._walkMotes.forEach(m => {
      m.x += m.dx; m.y += m.dy;
      if (m.y < -0.02) { m.y = 0.80; m.x = Math.random(); }
      if (m.x < -0.02 || m.x > 1.02) m.x = Math.random();
      const pulse = 0.40 + 0.60*Math.sin(t*m.spd+m.phase);
      const alpha = (nite>0.3 ? 0.65 : 0.20)*pulse;
      const [mr,mg,mb] = nite>0.3 ? [190,255,150] : eve>0.3 ? [255,210,80] : [255,235,120];
      ctx.beginPath(); ctx.arc(m.x*W, m.y*H, m.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(${mr},${mg},${mb},${alpha.toFixed(3)})`; ctx.fill();
    });
  }

  // ── 集中 — Lissajous Flow (time-aware) ───────────────────────────────────
  _drawFocus() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H * 0.44;
    const U  = Math.min(W, H);
    const hr  = this._getHour();
    const day = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const hueBase = 155 + day * 18;

    ctx.fillStyle = '#010c0a'; ctx.fillRect(0, 0, W, H);

    // Radial bg glow
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, U*0.56);
    bg.addColorStop(0,   `rgba(0,${(135+day*22)|0},${(98-day*10)|0},${(0.12+day*0.04).toFixed(3)})`);
    bg.addColorStop(0.6, `rgba(0,60,45,0.04)`);
    bg.addColorStop(1,   'transparent');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Outer hex grid (faint)
    const gridAlpha = 0.018 + day*0.012;
    const rot = t*0.022, R = U*0.19;
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(52,211,153,${gridAlpha.toFixed(3)})`;
    for (let i = 0; i < 6; i++) {
      const a = (i/6)*Math.PI*2 + rot;
      ctx.beginPath(); ctx.arc(cx+Math.cos(a)*R, cy+Math.sin(a)*R, R, 0, Math.PI*2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.stroke();

    // Grid lines
    const gridStep = U*0.088;
    ctx.strokeStyle = `rgba(52,211,153,${(gridAlpha*0.75).toFixed(3)})`; ctx.lineWidth = 0.4;
    for (let x = cx%gridStep; x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = cy%gridStep; y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Lissajous curve with trail effect
    const A = U*0.30, B = U*0.23;
    const fa = 3, fb = 2 + 0.08*Math.sin(t*0.028);
    const dphi = t*0.055;
    const STEPS = 260;

    // Trail: draw thin line first
    ctx.beginPath();
    for (let i = 0; i < STEPS; i++) {
      const θ = (i/STEPS)*Math.PI*2;
      const x = cx + A*Math.sin(fa*θ+dphi);
      const y = cy + B*Math.sin(fb*θ);
      i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(52,211,153,0.08)`; ctx.lineWidth = 1.2; ctx.stroke();

    // Glowing dots along curve
    for (let i = 0; i < STEPS; i++) {
      const θ = (i/STEPS)*Math.PI*2;
      const x = cx + A*Math.sin(fa*θ+dphi);
      const y = cy + B*Math.sin(fb*θ);
      const hue = hueBase + 44*(i/STEPS);
      const al  = (0.22 + 0.56*Math.abs(Math.sin(θ*3.1+t*0.7))).toFixed(2);
      const rr  = 1.0 + 1.8*Math.abs(Math.sin(θ*2.2+t*0.4));
      ctx.fillStyle = `hsla(${hue|0},80%,65%,${al})`;
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI*2); ctx.fill();
    }

    // 3 orbiting bright nodes with glow trails
    for (let k = 0; k < 3; k++) {
      const θ = (t*0.72 + k*Math.PI*2/3) % (Math.PI*2);
      const x = cx + A*Math.sin(fa*θ+dphi);
      const y = cy + B*Math.sin(fb*θ);
      // Trail
      for (let tr = 1; tr <= 8; tr++) {
        const θt = θ - tr*0.04;
        const xt = cx + A*Math.sin(fa*θt+dphi);
        const yt = cy + B*Math.sin(fb*θt);
        ctx.fillStyle = `rgba(52,211,153,${(0.06*(1-tr/8)).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(xt, yt, U*0.018*(1-tr/10), 0, Math.PI*2); ctx.fill();
      }
      // Node glow
      const dotG = ctx.createRadialGradient(x, y, 0, x, y, U*0.060);
      dotG.addColorStop(0,   'rgba(140,255,200,0.92)');
      dotG.addColorStop(0.4, 'rgba(52,211,153,0.38)');
      dotG.addColorStop(1,   'transparent');
      ctx.fillStyle = dotG; ctx.beginPath(); ctx.arc(x, y, U*0.060, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(210,255,235,0.98)';
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI*2); ctx.fill();
    }

    // Central pulsing ring
    const cPulse = 0.5 + 0.5*Math.sin(t*1.2);
    const cRing = ctx.createRadialGradient(cx, cy, U*0.02, cx, cy, U*(0.08+cPulse*0.04));
    cRing.addColorStop(0,   `rgba(100,255,190,${(0.12+cPulse*0.12).toFixed(3)})`);
    cRing.addColorStop(0.6, `rgba(52,211,153,${(0.04+cPulse*0.04).toFixed(3)})`);
    cRing.addColorStop(1,   'transparent');
    ctx.fillStyle = cRing; ctx.beginPath(); ctx.arc(cx, cy, U*(0.08+cPulse*0.04), 0, Math.PI*2); ctx.fill();
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

    // Background — purple to deep violet
    ctx.fillStyle = '#060212'; ctx.fillRect(0, 0, W, H);

    // Background nebula layers
    for (let ni = 0; ni < 3; ni++) {
      const nx = cx + Math.sin(t*0.008+ni*2.1)*W*0.12;
      const ny = cy + Math.cos(t*0.006+ni*2.1)*H*0.08;
      const nr = U*(0.55-ni*0.10);
      const nb = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
      const [nr2,ng,nb2] = ni===0 ? [90,25,140] : ni===1 ? [60,15,110] : [110,40,160];
      nb.addColorStop(0,   `rgba(${nr2+dusk*50},${ng},${nb2},${(0.14+dusk*0.06).toFixed(3)})`);
      nb.addColorStop(0.5, `rgba(${nr2},${ng},${nb2},0.05)`);
      nb.addColorStop(1,   'transparent');
      ctx.fillStyle = nb; ctx.fillRect(0, 0, W, H);
    }

    if (dusk > 0.05) {
      const duskG = ctx.createLinearGradient(0, H*0.6, 0, H);
      duskG.addColorStop(0, 'rgba(200,80,20,0)');
      duskG.addColorStop(1, `rgba(200,80,20,${(dusk*0.22).toFixed(3)})`);
      ctx.fillStyle = duskG; ctx.fillRect(0, 0, W, H);
    }

    const ph = (t % 16) / 16;
    let ratio, label;
    if      (ph < 0.25) { ratio = ph/0.25;           label = '吸　う'; }
    else if (ph < 0.50) { ratio = 1;                  label = '保　つ'; }
    else if (ph < 0.75) { ratio = 1-(ph-0.50)/0.25;  label = '吐　く'; }
    else                { ratio = 0;                  label = '　　…'; }
    const cR = U*(0.09 + 0.17*ratio);

    const rimR = (195 + dusk*50) | 0;
    const rimG = (105 - dusk*30) | 0;
    const rimB = (255 - dusk*40) | 0;

    // Outer ripple rings (more of them)
    for (let i = 0; i < 9; i++) {
      const prog = ((t*0.14 + i/9) % 1);
      const rRip = cR + prog*U*0.52;
      const al   = (1-prog)*0.18;
      if (al < 0.006) continue;
      ctx.beginPath(); ctx.arc(cx, cy, rRip, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${al.toFixed(3)})`;
      ctx.lineWidth = 1.2*(1-prog*0.6); ctx.stroke();
    }

    // Lotus petals (8 petals around center)
    const petalCount = 8;
    const rotOuter = t*0.018;
    for (let i = 0; i < petalCount; i++) {
      const a = (i/petalCount)*Math.PI*2 + rotOuter;
      const pd = cR * 1.65;
      const pr = cR * 0.70;
      const px = cx + Math.cos(a)*pd;
      const py = cy + Math.sin(a)*pd;
      const petalG = ctx.createRadialGradient(px, py, 0, px, py, pr);
      petalG.addColorStop(0,   `rgba(${rimR},${rimG},${rimB},${(0.10+ratio*0.10).toFixed(3)})`);
      petalG.addColorStop(0.5, `rgba(${rimR},${rimG},${rimB},${(0.04+ratio*0.04).toFixed(3)})`);
      petalG.addColorStop(1,   'transparent');
      ctx.fillStyle = petalG;
      ctx.beginPath(); ctx.ellipse(px, py, pr*0.55, pr, a, 0, Math.PI*2); ctx.fill();
    }

    // Inner mandala rings
    for (let i = 0; i < 12; i++) {
      const a = (i/12)*Math.PI*2 + rotOuter;
      ctx.beginPath(); ctx.arc(cx+Math.cos(a)*cR*0.80, cy+Math.sin(a)*cR*0.80, cR*0.72, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${(0.06+ratio*0.06).toFixed(3)})`;
      ctx.lineWidth = 0.7; ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const a = (i/6)*Math.PI*2 - rotOuter*1.5;
      ctx.beginPath(); ctx.arc(cx+Math.cos(a)*cR*0.92, cy+Math.sin(a)*cR*0.92, cR*0.90, 0, Math.PI*2);
      ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${(0.10+ratio*0.08).toFixed(3)})`;
      ctx.lineWidth = 0.9; ctx.stroke();
    }

    // Glow layers
    for (let i = 3; i >= 1; i--) {
      const g = ctx.createRadialGradient(cx, cy, cR*0.6, cx, cy, cR*(1+i*0.65));
      g.addColorStop(0, `rgba(${rimR},${(145+dusk*30)|0},255,${(0.14/i).toFixed(3)})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, cR*(1+i*0.65), 0, Math.PI*2); ctx.fill();
    }

    // Core disc
    const cG = ctx.createRadialGradient(cx, cy, 0, cx, cy, cR);
    cG.addColorStop(0,    `rgba(250,${(228+dusk*20)|0},${(255-dusk*30)|0},0.68)`);
    cG.addColorStop(0.50, `rgba(${(165+dusk*40)|0},${(82-dusk*30)|0},255,0.30)`);
    cG.addColorStop(1,    'rgba(100,40,220,0.04)');
    ctx.fillStyle = cG; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = `rgba(${rimR},${rimG},${rimB},${(0.35+ratio*0.40).toFixed(3)})`;
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(cx, cy, cR, 0, Math.PI*2); ctx.stroke();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = `${(U*0.042)|0}px -apple-system,sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);

    // Stardust particles — more, denser
    for (let i = 0; i < 50; i++) {
      const s  = i*137.508;
      const a  = s + t*(0.050 + 0.032*Math.sin(s*0.2));
      const d  = U*(0.28 + 0.18*Math.abs(Math.sin(s*0.4)));
      const px = cx + Math.cos(a)*d;
      const py = cy + Math.sin(a)*d*0.88;
      const al = (0.08 + 0.52*Math.abs(Math.sin(t*0.25+s))).toFixed(2);
      const pr = 0.6 + 2.0*Math.abs(Math.sin(s*0.3));
      ctx.fillStyle = `rgba(${(225+dusk*28)|0},${(195-dusk*30)|0},255,${al})`;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI*2); ctx.fill();
      // Occasional twinkle cross
      if (Math.abs(Math.sin(t*0.4+s)) > 0.88) {
        ctx.strokeStyle = `rgba(255,245,255,${(al*0.5)})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(px-pr*2,py); ctx.lineTo(px+pr*2,py); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px,py-pr*2); ctx.lineTo(px,py+pr*2); ctx.stroke();
      }
    }
  }

  // ── 睡眠前 — Warm Dusk / Bath (time-aware) ───────────────────────────────
  _drawPresleep() {
    const c = this.canvas, ctx = this.ctx;
    if (c.width !== c.clientWidth || c.height !== c.clientHeight) {
      c.width = c.clientWidth; c.height = c.clientHeight;
      this._presleepMotes = null; this._presleepFlame = null;
    }
    const W = c.width, H = c.height, t = this.t;
    const hr   = this._getHour();
    const eve  = Math.max(0, 1 - Math.abs(hr - 20.5) / 4.0);
    const warm = Math.max(0, 1 - Math.abs(hr - 19.0) / 3.5);

    // Rich warm background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, `rgb(${22+Math.round(warm*34)},${10+Math.round(warm*14)},${38+Math.round(eve*12)})`);
    bg.addColorStop(0.5,`rgb(${15+Math.round(warm*22)},${8+Math.round(warm*10)},${28+Math.round(eve*8)})`);
    bg.addColorStop(1,  `rgb(${8+Math.round(warm*14)}, ${6+Math.round(warm*6)}, ${18+Math.round(eve*6)})`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Central bath glow
    const gcx = W*0.50, gcy = H*0.60;
    const gr  = Math.min(W,H)*(0.62+0.07*Math.sin(t*0.018));
    const ga  = 0.13 + warm*0.10 + 0.04*Math.sin(t*0.022);
    const grd = ctx.createRadialGradient(gcx, gcy, 0, gcx, gcy, gr);
    grd.addColorStop(0,    `rgba(215,95,28,${ga})`);
    grd.addColorStop(0.30, `rgba(160,50,70,${ga*0.55})`);
    grd.addColorStop(0.65, `rgba(80,20,90,${ga*0.20})`);
    grd.addColorStop(1,    'rgba(40,10,60,0)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);

    // Aurora ribbons (warm tones)
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    for (let r = 0; r < 4; r++) {
      const y0  = H*(0.14 + r*0.09 + 0.03*Math.sin(t*0.012+r*2.1));
      const amp = H*(0.030 + 0.012*Math.sin(t*0.009+r*1.8));
      const numP = 22, pts = [];
      for (let i = 0; i <= numP; i++) {
        pts.push([(i/numP)*W, y0+amp*Math.sin(i*0.48+t*0.007+r*0.9)]);
      }
      const hue = 16+r*18 + 10*Math.sin(t*0.005+r);
      const al  = (0.030 + warm*0.025)*(1+0.30*Math.sin(t*0.016+r));
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      for (let i = pts.length-1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][1]+H*0.060);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue},75%,65%,${al})`; ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.restore();

    // Candle flame (teardrop shape)
    const candleX = W*0.78, candleBaseY = H*0.75;
    const flicker = Math.sin(t*0.31)*0.6 + Math.sin(t*0.57)*0.3 + Math.sin(t*0.11)*0.1;
    const fh = H*0.065*(1 + flicker*0.18);
    const fw = W*0.018*(1 + Math.abs(flicker)*0.12);
    // Candle wax
    ctx.fillStyle = 'rgba(240,225,190,0.65)';
    ctx.fillRect(candleX - fw*1.2, candleBaseY, fw*2.4, H*0.12);
    // Flame glow
    const flameG = ctx.createRadialGradient(candleX, candleBaseY-fh*0.5, 0, candleX, candleBaseY, fh*2.2);
    flameG.addColorStop(0,    `rgba(255,210,80,${(0.40+warm*0.15).toFixed(3)})`);
    flameG.addColorStop(0.30, `rgba(255,130,20,${(0.18+warm*0.08).toFixed(3)})`);
    flameG.addColorStop(0.65, `rgba(200,60,0,${(0.06+warm*0.04).toFixed(3)})`);
    flameG.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = flameG; ctx.fillRect(0, 0, W, H);
    // Flame body
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(candleX, candleBaseY);
    ctx.bezierCurveTo(
      candleX+fw, candleBaseY-fh*0.35,
      candleX+fw*(0.8+flicker*0.15), candleBaseY-fh*0.75,
      candleX, candleBaseY-fh
    );
    ctx.bezierCurveTo(
      candleX-fw*(0.8+flicker*0.15), candleBaseY-fh*0.75,
      candleX-fw, candleBaseY-fh*0.35,
      candleX, candleBaseY
    );
    const fG = ctx.createLinearGradient(candleX, candleBaseY, candleX, candleBaseY-fh);
    fG.addColorStop(0,    'rgba(255,200,30,0.95)');
    fG.addColorStop(0.35, 'rgba(255,130,15,0.88)');
    fG.addColorStop(0.70, 'rgba(255,80,10,0.75)');
    fG.addColorStop(1,    'rgba(200,50,5,0.30)');
    ctx.fillStyle = fG; ctx.fill();
    ctx.restore();

    // Steam wisps
    for (let w = 0; w < 4; w++) {
      const ph   = t*0.011 + w*1.57;
      const sx   = W*(0.22+w*0.19) + Math.sin(ph*0.7)*W*0.04;
      const baseY = H*0.84;
      const cp1x = sx + Math.sin(ph+0.5)*W*0.05;
      const cp1y = baseY - H*0.22;
      const cp2x = sx + Math.sin(ph+1.2)*W*0.07;
      const cp2y = baseY - H*0.48;
      const ex   = sx + Math.sin(ph+0.3)*W*0.03;
      const ey   = baseY - H*0.70;
      const steps = 12;
      for (let s = 0; s < steps; s++) {
        const tn  = s/(steps-1);
        const mt  = 1-tn;
        const bx  = mt*mt*mt*sx + 3*mt*mt*tn*cp1x + 3*mt*tn*tn*cp2x + tn*tn*tn*ex;
        const by  = mt*mt*mt*baseY + 3*mt*mt*tn*cp1y + 3*mt*tn*tn*cp2y + tn*tn*tn*ey;
        const rad = 8+tn*22;
        const al  = 0.032*(1-tn)*(0.7+0.3*Math.sin(ph*2.5));
        const sg  = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
        sg.addColorStop(0, `rgba(218,178,148,${al})`);
        sg.addColorStop(1, `rgba(218,178,148,0)`);
        ctx.fillStyle = sg; ctx.fillRect(bx-rad, by-rad, rad*2, rad*2);
      }
    }

    // Floating warm motes / sparks
    if (!this._presleepMotes) {
      this._presleepMotes = Array.from({length:32}, () => ({
        x: Math.random(), y: Math.random(),
        r: 0.6+Math.random()*1.8,
        vx: (Math.random()-0.5)*0.00008,
        vy: -(0.00004+Math.random()*0.00007),
        ph: Math.random()*Math.PI*2,
      }));
    }
    this._presleepMotes.forEach(m => {
      m.x = (m.x+m.vx+1)%1; m.y += m.vy;
      if (m.y < 0) { m.y = 1.0; m.x = Math.random(); }
      const al = 0.20 + 0.16*Math.sin(t*0.015+m.ph);
      ctx.beginPath(); ctx.arc(m.x*W, m.y*H, m.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(238,168,88,${al})`; ctx.fill();
    });

    this.t++;
  }

  // ── 睡眠 — Aurora Night (time-aware) ─────────────────────────────────────
  _drawSleep() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const hr    = this._getHour();
    const night = Math.max(0, 1 - Math.max(0, Math.sin((hr-6)/12*Math.PI)));
    const deep  = Math.max(0, 1 - Math.abs(hr-0)/4);

    // Deep sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0,    `rgb(${(1+night*0)|0},${(7+night*0)|0},${(16+night*0)|0})`);
    sky.addColorStop(0.45, `rgb(3,${(12+night*0)|0},${(28-night*2)|0})`);
    sky.addColorStop(0.85, `rgb(5,${(15+night*0)|0},${(34-night*4)|0})`);
    sky.addColorStop(1,    `rgb(4,13,${(26-night*2)|0})`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Moon with halo
    const moonX = W*0.72, moonY = H*0.20;
    // Halo layers
    for (let h = 3; h >= 1; h--) {
      const haloR = H*(0.08 + h*0.06);
      const haloG = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, haloR);
      haloG.addColorStop(0,   `rgba(180,200,255,${(0.04*night/h).toFixed(3)})`);
      haloG.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = haloG; ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = `rgba(228,235,255,${(night*0.92).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(moonX, moonY, H*0.028, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = `rgba(245,248,255,${(night*0.70).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(moonX-H*0.006, moonY-H*0.004, H*0.026, 0, Math.PI*2); ctx.fill();

    // Aurora curtains (richer colors)
    const auroraAlpha = 0.12 + night*0.18;
    const curtains = [
      { xR:0.22, wR:0.35, spd:0.075, ph:0.0, rgb:[0,210,160],   a:auroraAlpha },
      { xR:0.55, wR:0.30, spd:0.060, ph:2.1, rgb:[60,110,230],  a:auroraAlpha*0.85 },
      { xR:0.78, wR:0.24, spd:0.095, ph:4.4, rgb:[150,50,210],  a:auroraAlpha*0.65 },
      { xR:0.40, wR:0.20, spd:0.110, ph:1.2, rgb:[0,180,120],   a:auroraAlpha*0.45 },
    ];
    curtains.forEach(cu => {
      const xC = (cu.xR + Math.sin(t*cu.spd+cu.ph)*0.07)*W;
      const wW = cu.wR*W;
      const [r, g, b] = cu.rgb;
      ctx.beginPath();
      const S = 48;
      for (let s = 0; s <= S; s++) {
        const y  = (s/S)*H*0.88;
        const wo = Math.sin(y/H*Math.PI*3.5 + t*0.11 + cu.ph)*wW*0.24;
        s===0 ? ctx.moveTo(xC-wW*0.5+wo, y) : ctx.lineTo(xC-wW*0.5+wo, y);
      }
      for (let s = S; s >= 0; s--) {
        const y  = (s/S)*H*0.88;
        const wo = Math.sin(y/H*Math.PI*3.5 + t*0.11 + cu.ph)*wW*0.24;
        ctx.lineTo(xC+wW*0.5+wo, y);
      }
      ctx.closePath();
      const gr = ctx.createLinearGradient(0, 0, 0, H*0.88);
      gr.addColorStop(0,    `rgba(${r},${g},${b},0)`);
      gr.addColorStop(0.10, `rgba(${r},${g},${b},${cu.a.toFixed(3)})`);
      gr.addColorStop(0.62, `rgba(${r},${g},${b},${(cu.a*0.48).toFixed(3)})`);
      gr.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr; ctx.fill();
    });

    // Stars — more, with size variation and twinkle
    const starBrightness = 0.14 + night*0.60;
    for (let i = 0; i < 100; i++) {
      const s  = i*127.1;
      const sx = ((Math.sin(s*0.11)+1)/2)*W;
      const sy = ((Math.sin(s*0.073)+1)/2)*H*0.80;
      const tw = starBrightness * Math.abs(Math.sin(t*(0.0003+(i%7)*0.00005)*5000+s));
      const sr = 0.4 + 1.2*Math.abs(Math.sin(s*0.31));
      if (tw < 0.02) continue;
      ctx.fillStyle = `rgba(220,228,255,${tw.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI*2); ctx.fill();
      // Bright star cross
      if (sr > 1.0 && tw > 0.40) {
        ctx.strokeStyle = `rgba(220,228,255,${(tw*0.35).toFixed(3)})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(sx-sr*3,sy); ctx.lineTo(sx+sr*3,sy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx,sy-sr*3); ctx.lineTo(sx,sy+sr*3); ctx.stroke();
      }
    }

    // Shooting stars
    if (!this._shootingStars) this._shootingStars = [];
    if (Math.random() < 0.003 && this._shootingStars.length < 3) {
      this._shootingStars.push({
        x: Math.random()*W*0.7, y: Math.random()*H*0.30,
        vx: 2.8+Math.random()*3.5, vy: 1.2+Math.random()*1.8,
        life: 0, maxLife: 0.55+Math.random()*0.45,
      });
    }
    this._shootingStars = this._shootingStars.filter(ss => ss.life < ss.maxLife);
    this._shootingStars.forEach(ss => {
      ss.life += 0.016;
      ss.x += ss.vx; ss.y += ss.vy;
      const prog = ss.life/ss.maxLife;
      const al = Math.sin(prog*Math.PI)*0.85*night;
      const len = 60+ss.vx*8;
      const grad = ctx.createLinearGradient(ss.x, ss.y, ss.x-ss.vx*len*0.12, ss.y-ss.vy*len*0.12);
      grad.addColorStop(0,   `rgba(220,230,255,${al.toFixed(3)})`);
      grad.addColorStop(1,   'rgba(220,230,255,0)');
      ctx.beginPath(); ctx.moveTo(ss.x, ss.y);
      ctx.lineTo(ss.x-ss.vx*len*0.12, ss.y-ss.vy*len*0.12);
      ctx.strokeStyle = grad; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = `rgba(240,245,255,${al.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(ss.x, ss.y, 1.2, 0, Math.PI*2); ctx.fill();
    });

    // Ground horizon faint glow
    const hor = ctx.createLinearGradient(0, H*0.80, 0, H);
    hor.addColorStop(0, 'rgba(0,40,30,0)');
    hor.addColorStop(1, `rgba(0,${(40+deep*20)|0},${(30+deep*15)|0},${(0.12+night*0.08).toFixed(3)})`);
    ctx.fillStyle = hor; ctx.fillRect(0, H*0.80, W, H*0.20);
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
