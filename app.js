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

  // ── Pre-compute values for overtone enrichment ──────────────────────────
  // Real piano hammers strike 2–3 slightly detuned unison strings per note.
  // The slow beating between them (~1–3 Hz) is the core of piano's warm shimmer.
  const fDet1 = freq * 1.001039;   // +1.8 cents  (string 2)
  const fDet2 = freq * 0.999423;   // −1.0 cent   (string 3, softer)
  // Upper air harmonics: add "breath" and bell-shimmer at the moment of attack
  const f9    = freq * 9;
  const f11   = freq * 11;
  const f13   = freq * 13;
  const f9ok  = f9  < sr * 0.45;
  const f11ok = f11 < sr * 0.45;
  const f13ok = f13 < sr * 0.45;

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

    // Detuned unison voices — string 2 (+1.8¢) and string 3 (−1.0¢)
    // These create the slow interference beating that makes piano sound alive
    const envFund = 0.45 * Math.exp(-0.62 * t) + 0.55 * Math.exp(-0.057 * t);
    s += 0.18 * envFund * Math.sin(2 * Math.PI * fDet1 * t + phi * 1.83);
    s += 0.10 * envFund * Math.sin(2 * Math.PI * fDet2 * t + phi * 2.61);

    // Upper harmonics: air, shimmer, and gentle bell-tone (fast decay → only at attack)
    if (f9ok)  s += 0.0040 * Math.exp(-22 * t) * Math.sin(2 * Math.PI * f9  * t + phi * 2.1);
    if (f11ok) s += 0.0022 * Math.exp(-28 * t) * Math.sin(2 * Math.PI * f11 * t + phi * 3.7);
    if (f13ok) s += 0.0012 * Math.exp(-35 * t) * Math.sin(2 * Math.PI * f13 * t + phi * 5.2);

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

// 鉄琴 (Glockenspiel / Metallophone) — free-free metal bar, hard mallet
// Used in Radiohead "No Surprises": bright, clear, bell-like tone with medium sustain.
// Physical model: empirical overtone ratios for a uniform free-free metal bar.
// Hard mallet → strong attack transient + boosted 2nd/3rd modes at onset.
function computeGlockBuffer(ac, freq, velocity = 0.7, durationSec = 3.8) {
  const sr  = ac.sampleRate;
  const len = Math.round(sr * durationSec);
  const buf = ac.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  // Free-free bar overtone ratios [ratio, amp, decay_1/s]
  // Hard mallet boosts upper modes at attack → characteristic bright "ping"
  const modes = [
    [1.000,  0.65, 0.18],   // fundamental   — clear, medium sustain
    [2.756,  0.28, 1.40],   // 2nd mode      — prominent metallic brightness (hard mallet)
    [5.404,  0.10, 4.80],   // 3rd mode      — crisp bite at attack
    [8.933,  0.03, 11.0],   // 4th mode      — high shimmer at the strike moment
    [13.344, 0.008, 22.0],  // 5th mode      — barely audible "air" at impact
  ];

  const phi    = Math.random() * Math.PI * 2;
  const atkLen = Math.round(sr * 0.006);  // 6 ms hard-mallet transient (longer than soft)

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;

    modes.forEach(([ratio, amp, dc], mi) => {
      const f = freq * ratio;
      if (f >= sr * 0.45) return;
      s += amp * Math.exp(-dc * t) * Math.sin(2 * Math.PI * f * t + phi * (mi + 1) * 0.58);
    });

    // Hard mallet impact — louder and longer than soft mallet, the "knock" of metal on metal
    if (i < atkLen) {
      const atkNorm = i / atkLen;
      s += (Math.random() * 2 - 1) * 0.055 * velocity * Math.exp(-atkNorm * 10);
    }

    d[i] = s * velocity;
  }

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.01) {
    const fo = Math.min(sr * 0.50, len);
    for (let i = 0; i < len; i++) {
      d[i] = d[i] / peak * 0.68;
      if (i > len - fo) d[i] *= (len - i) / fo;
    }
  }
  return buf;
}

// Music box (オルゴール) — cantilever beam tine, plucked by a rotating pin
// Cantilever overtone ratios: 1.000, 6.267, 17.55 (far more inharmonic than glockenspiel)
// Result: mostly fundamental sustain; overtones vanish in milliseconds → delicate, intimate
function computeOrgolBuffer(ac, freq, velocity = 0.7, durationSec = 2.8) {
  const sr  = ac.sampleRate;
  const len = Math.round(sr * durationSec);
  const buf = ac.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  // Cantilever beam modes — empirical ratios for a fixed-free metal tine
  const modes = [
    [1.000,  0.80, 0.26],   // fundamental — present throughout, gentle decay
    [6.267,  0.13, 11.0],   // 2nd mode — brief metallic click at attack
    [17.55,  0.03, 32.0],   // 3rd mode — sub-millisecond shimmer only
  ];

  const phi  = Math.random() * Math.PI * 2;
  // Slight detuned voice (+1.0 ¢) simulates mechanical imperfection of the tine
  const fDet = freq * 1.000579;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;

    modes.forEach(([ratio, amp, dc], mi) => {
      const f = freq * ratio;
      if (f >= sr * 0.45) return;
      s += amp * Math.exp(-dc * t) * Math.sin(2 * Math.PI * f * t + phi * (mi + 1) * 0.5);
    });

    // Detuned tine: soft beating creates the delicate "living" quality of a real music box
    const envFund = Math.exp(-0.28 * t);
    s += 0.14 * envFund * Math.sin(2 * Math.PI * fDet * t + phi * 2.3);

    // Pin pluck transient: crisp but very soft (no hammer — just a gentle pin catch)
    if (i < Math.round(sr * 0.003)) {
      const atkNorm = i / Math.round(sr * 0.003);
      s += (Math.random() * 2 - 1) * 0.012 * velocity * Math.exp(-atkNorm * 22);
    }

    d[i] = s * velocity;
  }

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.01) {
    const fo = Math.min(sr * 0.35, len);
    for (let i = 0; i < len; i++) {
      d[i] = d[i] / peak * 0.60;
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
              [132, null, 198, null, null],
              [null, 132, null, 198, null],
              [132, null, 165, null, null],
              [null, 132, null, 220, null],
            ], bpm:15, startDelay:7, vol:0.36 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [_.E3, _.G3, null, null, _.C4, null, null, null],
              [_.C4, null, _.E4, null, _.G4, null, null, null],
              [_.G4, null, null, null, _.C5, null, null, null],
              [null, _.E4, null, _.C4, null, _.G3, null, _.E3],
            ], bpm:7, startDelay:10, vol:0.30 },
          { type:'bowl',      name:'チベタンボウル',     icon:'🔔', interval:28000, vol:0.36 },
          { type:'guitar',    name:'アコギアルペジオ',   icon:'🎸',
            // Fix You-inspired: circular waterfall patterns, peak→descent→return.
            // G3 removed — its 3rd harmonic (594Hz) clashes with solfeggio C5 (528Hz).
            // All patterns use only C4/E4/G4 so any simultaneous glock note is consonant.
            patterns:[
              [_.G4, _.E4, _.C4, _.E4, _.G4, _.E4, _.G4, _.C4],  // P1: peak→fall→rise (Fix You verse)
              [_.C4, _.G4, _.E4, _.C4, _.E4, _.C4, _.G4, _.E4],  // P2: root anchor reaching to G4
              [_.G4, _.E4, _.C4, _.G4, _.C4, _.E4, _.C4, _.G4],  // P3: G4↔C4 dialogue
              [_.E4, _.C4, _.E4, _.G4, _.E4, _.G4, _.C4, _.E4],  // P4: E4-center, climbing to G4
            ], bpm:77, startDelay:8, vol:0.28 },
          { type:'glock',     name:'鉄琴',         icon:'🎵',
            // Simplified to root (C4), perfect-5th (G4), and upper octave (C5=solfeggio).
            // These 3 notes are ALWAYS consonant with any C/E/G guitar note,
            // eliminating harmonic clashes regardless of BPM drift between instruments.
            patterns:[
              [_.G4, null, _.C4, null, _.G4, null, _.C4, null],  // P1: G4-C4 alternation
              [_.C4, null, _.G4, null, _.C4, null, _.G4, null],  // P2: C4-G4 alternation
              [_.G4, null, _.C5, null, _.G4, null, _.C4, null],  // P3: C5 sparkle (solfeggio)
              [_.C4, null, _.G4, null, _.C5, null, _.G4, null],  // P4: ascending C4→G4→C5
            ], bpm:77, startDelay:16, vol:0.20 },
          { type:'orgol',     name:'オルゴール',         icon:'🎶',
            // E5=660Hz removed: glock's 2nd inharmonic mode of C4 (264×2.756=727Hz)
            // sits only 67Hz from E5, inside the critical bandwidth → roughness.
            // Keeping only C5 (solfeggio root) and G4 (perfect 5th): always consonant.
            patterns:[
              [_.C5, null, null, null, _.G4, null, null, null],  // P1: C5 then G4
              [null, _.G4, null, null, null, _.C5, null, null],  // P2: G4 then C5
              [_.G4, null, null, _.C5, null, null, _.G4, null],  // P3: G4-C5 dialogue
              [_.C5, null, null, null, null, null, _.G4, null],  // P4: sparse
            ], bpm:60, startDelay:26, vol:0.17 },
        ]},
        { name:'ディープ', layers: [
          { type:'binaural',  name:'バイノーラル θ→δ',  icon:'〜', base:264, beat:7, driftTo:1.5, driftDuration:2700, vol:0.50 },
          { type:'organ',     name:'オルガン',           icon:'🎹', baseFreq:99.0, vol:0.52 },
          { type:'solfeggio', name:'528Hz ソルフェジオ', icon:'✦',  vol:0.54 },
          { type:'harp',      name:'ハープ',             icon:'🪕',
            patterns:[
              [132, null, 198, null, null],
              [null, 132, null, 198, null],
              [132, null, 165, null, null],
              [null, 132, null, 220, null],
            ], bpm:15, startDelay:7, vol:0.36 },
          { type:'piano', name:'ソフトピアノ', icon:'🎹',
            patterns:[
              [_.E3, _.G3, null, null, _.C4, null, null, null],
              [_.C4, null, _.E4, null, _.G4, null, null, null],
              [_.G4, null, null, null, _.C5, null, null, null],
              [null, _.E4, null, _.C4, null, _.G3, null, _.E3],
            ], bpm:7, startDelay:10, vol:0.30 },
          { type:'bowl',      name:'チベタンボウル',      icon:'🔔', interval:28000, vol:0.36 },
          { type:'guitar',    name:'アコギアルペジオ',    icon:'🎸',
            patterns:[
              [_.G4, _.E4, _.C4, _.E4, _.G4, _.E4, _.G4, _.C4],
              [_.C4, _.G4, _.E4, _.C4, _.E4, _.C4, _.G4, _.E4],
              [_.G4, _.E4, _.C4, _.G4, _.C4, _.E4, _.C4, _.G4],
              [_.E4, _.C4, _.E4, _.G4, _.E4, _.G4, _.C4, _.E4],
            ], bpm:77, startDelay:8, vol:0.28 },
          { type:'glock',     name:'鉄琴',          icon:'🎵',
            patterns:[
              [_.G4, null, _.C4, null, _.G4, null, _.C4, null],
              [_.C4, null, _.G4, null, _.C4, null, _.G4, null],
              [_.G4, null, _.C5, null, _.G4, null, _.C4, null],
              [_.C4, null, _.G4, null, _.C5, null, _.G4, null],
            ], bpm:77, startDelay:16, vol:0.20 },
          { type:'orgol',     name:'オルゴール',          icon:'🎶',
            patterns:[
              [_.C5, null, null, null, _.G4, null, null, null],
              [null, _.G4, null, null, null, _.C5, null, null],
              [_.G4, null, null, _.C5, null, null, _.G4, null],
              [_.C5, null, null, null, null, null, _.G4, null],
            ], bpm:60, startDelay:26, vol:0.17 },
          { type:'wind',      name:'風の音',              icon:'🍃', vol:0.16 },
        ]},
        { name: 'ジャーニー', journey: true, layers: [
          { type:'binaural', name:'バイノーラル α→δ旅', icon:'〜', base:264, beat:8, driftTo:1.0, driftDuration:3600, vol:0.52 },
          { type:'organ',    name:'オルガン',            icon:'🎹', baseFreq:98.0, vol:0.40 },
          { type:'noise',    name:'ブラウンノイズ',       icon:'🌫️', noiseType:'brown', vol:0.28 },
          { type:'harp',     name:'ハープ',              icon:'🪕',
            patterns:[
              [132, null, 198, null, null],
              [null, 132, null, 198, null],
              [132, null, 165, null, null],
              [null, 132, null, 220, null],
            ], bpm:10, startDelay:10, vol:0.26 },
          { type:'guitar',   name:'アコギアルペジオ',    icon:'🎸',
            patterns:[
              [_.G4, _.E4, _.C4, _.E4, _.G4, _.E4, _.G4, _.C4],
              [_.C4, _.G4, _.E4, _.C4, _.E4, _.C4, _.G4, _.E4],
              [_.G4, _.E4, _.C4, _.G4, _.C4, _.E4, _.C4, _.G4],
              [_.E4, _.C4, _.E4, _.G4, _.E4, _.G4, _.C4, _.E4],
            ], bpm:77, startDelay:12, vol:0.24 },
          { type:'glock',    name:'鉄琴',           icon:'🎵',
            patterns:[
              [_.G4, null, _.C4, null, _.G4, null, _.C4, null],
              [_.C4, null, _.G4, null, _.C4, null, _.G4, null],
              [_.G4, null, _.C5, null, _.G4, null, _.C4, null],
              [_.C4, null, _.G4, null, _.C5, null, _.G4, null],
            ], bpm:77, startDelay:20, vol:0.20 },
          { type:'orgol',    name:'オルゴール',            icon:'🎶',
            patterns:[
              [_.C5, null, null, null, _.G4, null, null, null],
              [null, _.G4, null, null, null, _.C5, null, null],
              [_.G4, null, null, _.C5, null, null, _.G4, null],
              [_.C5, null, null, null, null, null, _.G4, null],
            ], bpm:60, startDelay:32, vol:0.16 },
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

// Acoustic guitar additive synthesis — plucked string with body resonance
function computeGuitarBuffer(ac, freq, velocity = 0.7, durationSec = 3.5) {
  const sr  = ac.sampleRate;
  const len = Math.round(sr * durationSec);
  const buf = ac.createBuffer(1, len, sr);
  const d   = buf.getChannelData(0);

  // Guitar: bright pluck → fast high-partial decay, warm fundamental sustain
  const partials = [
    [1, 0.58, 0.70,  0.038],  // [n, amp, fastDecay/s, slowDecay/s]
    [2, 0.26, 2.00,  0.160],
    [3, 0.13, 4.80,  0.420],
    [4, 0.07, 8.00,  0.800],
    [5, 0.035,12.50, 1.300],
    [6, 0.015,18.00, 2.000],
  ];

  const B   = 0.00018 * Math.max(1, freq / 220);  // slight inharmonicity
  const phi = Math.random() * Math.PI * 2;
  const atk = Math.round(sr * 0.001);              // 1 ms crisp attack

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    partials.forEach(([n, amp, fd, sd]) => {
      const f = freq * n * Math.sqrt(1 + B * n * n);
      if (f >= sr * 0.45) return;
      s += amp * (0.52 * Math.exp(-fd * t) + 0.48 * Math.exp(-sd * t))
               * Math.sin(2 * Math.PI * f * t + phi * n * 0.03);
    });
    // Pluck body click (very brief transient)
    if (i < Math.round(sr * 0.010)) {
      const norm = i / Math.round(sr * 0.010);
      s += (Math.random() * 2 - 1) * 0.10 * velocity * Math.exp(-norm * 15);
    }
    if (i < atk) s *= i / atk;
    d[i] = s * velocity;
  }

  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0.01) {
    const fo = Math.min(sr * 0.4, len);
    for (let i = 0; i < len; i++) {
      d[i] = d[i] / peak * 0.68;
      if (i > len - fo) d[i] *= (len - i) / fo;
    }
  }
  return buf;
}

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

    // Melody ON/OFF
    this._melodyOn          = false;
    this._weatherCategory   = 'clear';   // 'clear' | 'cloudy' | 'rainy'
    this._weatherFetchedAt  = 0;

    // Sunrise / Sunset (for icon color)
    this._sunriseHour       = 6.0;   // default until geo fetch
    this._sunsetHour        = 18.0;
    this._iconBrightTimer   = null;

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
    const ac       = this.ac;
    const gainNode = ac.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.dryBus);
    gainNode.connect(this.reverbSend);

    const nodes = [];
    const buf   = this.soundBuffers['ocean'];
    if (buf) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop   = true;

      // ── 波の寄せ/引き — slow swell envelope ──────────────────────────────
      // Real ocean swells: 8–18 s per cycle.  We pick 11–16 s at random so
      // successive waves feel natural rather than metronomic.
      const swellGain = ac.createGain();
      swellGain.gain.value = 0.76;          // centre amplitude (LFO adds ±0.22)
      // → actual range [0.54 … 0.98]: wave receding → wave breaking

      const swellPeriod = 11 + Math.random() * 5;   // 11–16 s
      const lfo         = ac.createOscillator();
      lfo.type          = 'sine';
      lfo.frequency.value = 1 / swellPeriod;

      // Start LFO at a random phase so playback doesn't always begin at wave-peak
      const phaseOffset = Math.random() * Math.PI * 2;
      lfo.frequency.setValueAtTime(1 / swellPeriod, ac.currentTime);

      const lfoDepth = ac.createGain();
      lfoDepth.gain.value = 0.22;

      lfo.connect(lfoDepth);
      lfoDepth.connect(swellGain.gain);   // modulate the swell amplitude
      lfo.start(ac.currentTime);

      src.connect(swellGain);
      swellGain.connect(gainNode);
      src.start();
      nodes.push(src, lfo);
    }
    return { gainNode, nodes };
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
      env.gain.linearRampToValueAtTime(0.52, now + 0.18);
      env.gain.setTargetAtTime(0.0001, now + 1.5, 4.2);
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
      const amp = 0.10 * Math.pow(0.42, i);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(amp, now + 0.8);
      env.gain.setTargetAtTime(0.0001, now + 2.0, 2.2);
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
        // Only allow intervals that land on C-major triad tones to avoid dissonance
        if (Math.random() < 0.12) {
          const TRIAD = [66, 82.5, 99, 132, 165, 198, 264, 330, 396, 528, 660, 792];
          const isTriad = (hz) => TRIAD.some(t => Math.abs(hz / t - 1) < 0.006);
          const ratio = Math.random() < 0.6 ? 3/2 : 4/3; // perfect 5th or 4th
          const harmFreq = freq * ratio;
          if (harmFreq < this.ac.sampleRate * 0.45 && isTriad(harmFreq)) {
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

  _schedulePianoNotes(patterns, bpm, destGain, startDelaySec = 4, addChords = true) {
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

        if (addChords) {
          // ── Harmonic chord voicing — C major triad filter ─────────────────
          // Only add interval tones whose frequency lands on a C-major triad note
          // (C, E, or G in any octave).  This prevents E→G# or G→B additions
          // that would clash with the tonic drone layers.
          // JI triad Hz: C2=66, E2=82.5, G2=99, C3=132, E3=165, G3=198,
          //              C4=264, E4=330, G4=396, C5=528, E5=660, G5=792
          const TRIAD  = [66, 82.5, 99, 132, 165, 198, 264, 330, 396, 528, 660, 792];
          const isTriad = (hz) => TRIAD.some(t => Math.abs(hz / t - 1) < 0.006);

          // Bass octave (freq/2): always a pure octave — 55% when above G3
          if (Math.random() < 0.55 && freq > 198) {
            const bassFreq = freq / 2;
            const bassBuf  = computePianoBuffer(this.ac, bassFreq, velocity * 0.30, dur * 1.3);
            const bassS    = this.ac.createBufferSource();
            bassS.buffer   = bassBuf;
            const bassG    = this.ac.createGain();
            bassG.gain.value = velocity * 0.30;
            bassS.connect(bassG);
            bassG.connect(destGain);
            bassS.start();
            bassS.stop(this.ac.currentTime + dur * 1.3 + 0.5);
          }

          // Major 3rd (×5/4): C→E ✓  E→G# ✗  G→B ✗ — filtered by isTriad
          // Cap at G4=396 Hz — no chord note above G4 in healing/calm context
          const thirdFreq = freq * 5 / 4;
          if (Math.random() < 0.42 && isTriad(thirdFreq) && thirdFreq <= 396) {
            const thirdBuf = computePianoBuffer(this.ac, thirdFreq, velocity * 0.24, dur * 0.88);
            const thirdS   = this.ac.createBufferSource();
            thirdS.buffer  = thirdBuf;
            const thirdG   = this.ac.createGain();
            thirdG.gain.value = velocity * 0.24;
            thirdS.connect(thirdG);
            thirdG.connect(destGain);
            thirdS.start();
            thirdS.stop(this.ac.currentTime + dur * 0.88 + 0.5);
          }

          // Perfect 5th (×3/2): C→G ✓  E→B ✗  G→D ✗ — filtered by isTriad
          // Cap at G4=396 Hz — no chord note above G4 in healing/calm context
          const fifthFreq = freq * 3 / 2;
          if (Math.random() < 0.26 && isTriad(fifthFreq) && fifthFreq <= 396) {
            const fifthBuf = computePianoBuffer(this.ac, fifthFreq, velocity * 0.17, dur * 0.82);
            const fifthS   = this.ac.createBufferSource();
            fifthS.buffer  = fifthBuf;
            const fifthG   = this.ac.createGain();
            fifthG.gain.value = velocity * 0.17;
            fifthS.connect(fifthG);
            fifthG.connect(destGain);
            fifthS.start();
            fifthS.stop(this.ac.currentTime + dur * 0.82 + 0.5);
          }
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

  _scheduleOrgolNotes(patterns, bpm, destGain, startDelaySec = 20) {
    const beatMs = (60 / bpm) * 1000;
    const maxLen = Math.max(...patterns.map(p => p.length));
    const REST   = Array(maxLen).fill(null);
    let patIdx = 0, noteIdx = 0, curPat = patterns[0];

    const tick = () => {
      if (!this.isPlaying) return;
      const freq = curPat[noteIdx];
      if (freq) {
        const velocity = 0.24 + Math.random() * 0.28;  // very soft, intimate
        const dur      = 2.5 + Math.random() * 0.5;
        const buf = computeOrgolBuffer(this.ac, freq, velocity, dur);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const nG = this.ac.createGain();
        nG.gain.value = velocity;
        src.connect(nG);
        nG.connect(destGain);
        src.start();
        src.stop(this.ac.currentTime + dur + 0.3);
      }
      noteIdx++;
      if (noteIdx >= curPat.length) {
        noteIdx = 0;
        patIdx  = (patIdx + 1) % patterns.length;
        // 18% chance of extra silence between patterns — music boxes sometimes stutter
        curPat  = Math.random() < 0.18 ? REST : patterns[patIdx];
      }
      // Music boxes have slightly uneven timing from the pin drum rotation
      const humanMs = beatMs * (0.94 + Math.random() * 0.12);
      this.schedulerTmrs.push(setTimeout(tick, humanMs));
    };
    this.schedulerTmrs.push(setTimeout(tick, startDelaySec * 1000));
  }

  _scheduleGlockNotes(patterns, bpm, destGain, startDelaySec = 8) {
    const beatMs = (60 / bpm) * 1000;
    const maxLen = Math.max(...patterns.map(p => p.length));
    const REST   = Array(maxLen).fill(null);
    let patIdx = 0, noteIdx = 0, curPat = patterns[0];

    const tick = () => {
      if (!this.isPlaying) return;
      const freq = curPat[noteIdx];
      if (freq) {
        const velocity = 0.30 + Math.random() * 0.34;
        const dur      = 2.5 + Math.random() * 0.6;
        const buf = computeGlockBuffer(this.ac, freq, velocity, dur);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const nG = this.ac.createGain();
        nG.gain.value = velocity;
        src.connect(nG);
        nG.connect(destGain);
        src.start();
        src.stop(this.ac.currentTime + dur + 0.4);
      }
      noteIdx++;
      if (noteIdx >= curPat.length) {
        noteIdx = 0;
        patIdx  = (patIdx + 1) % patterns.length;
        curPat  = Math.random() < 0.12 ? REST : patterns[patIdx];
      }
      const humanMs = beatMs * (0.97 + Math.random() * 0.06);
      this.schedulerTmrs.push(setTimeout(tick, humanMs));
    };
    this.schedulerTmrs.push(setTimeout(tick, startDelaySec * 1000));
  }

  _scheduleGuitarArp(patterns, bpm, destGain, startDelaySec = 6) {
    const beatMs = (60 / bpm) * 1000;
    const maxLen = Math.max(...patterns.map(p => p.length));
    const REST   = Array(maxLen).fill(null);
    let patIdx = 0, noteIdx = 0, curPat = patterns[0];

    const tick = () => {
      if (!this.isPlaying) return;

      const freq = curPat[noteIdx];
      if (freq) {
        const velocity = 0.28 + Math.random() * 0.38;
        // 1.6–2.2s: notes overlap ~1.5 beats at BPM 77, creating the lush
        // ringing chord quality of Fix You without muddying (all notes are C/E/G)
        const dur      = 1.6 + Math.random() * 0.6;
        const buf = computeGuitarBuffer(this.ac, freq, velocity, dur);
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const nG = this.ac.createGain();
        nG.gain.value = velocity;
        src.connect(nG);
        nG.connect(destGain);
        src.start();
        src.stop(this.ac.currentTime + dur + 0.3);
      }

      noteIdx++;
      if (noteIdx >= curPat.length) {
        noteIdx = 0;
        patIdx  = (patIdx + 1) % patterns.length;
        // 8% chance of a brief silent rest between patterns
        curPat = Math.random() < 0.08 ? REST : patterns[patIdx];
      }

      // Subtle human timing variation (tighter than piano — guitar is more rhythmic)
      const humanMs = beatMs * (0.97 + Math.random() * 0.06);
      this.schedulerTmrs.push(setTimeout(tick, humanMs));
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

    // NOTE: _stopTimer() is intentionally NOT called here.
    // The countdown timer is independent of which layers are playing —
    // it must survive preset/mode/melody switches so the scheduled
    // auto-stop still fires at the correct time.
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
      // AudioContext is alive — restore masterGain to target volume immediately.
      // If the countdown timer is inside its final 90-second fade window,
      // restore only to the already-reduced timer-proportional level (not full vol)
      // so the fade-out is not reset by a preset/mode switch.
      const fullVol = +document.getElementById('master-vol').value / 100;
      const timerVol = (this.timerInterval && this.timerRemaining > 0 && this.timerRemaining <= 90)
        ? fullVol * (this.timerRemaining / 90)
        : fullVol;
      this.masterGain.gain.cancelScheduledValues(this.ac.currentTime);
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ac.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(timerVol, this.ac.currentTime + 0.05);
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
        case 'guitar': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          g.connect(this.reverbSend);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._scheduleGuitarArp(def.patterns, def.bpm, g, def.startDelay || 6);
          break;
        }
        case 'glock': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          g.connect(this.reverbSend);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._scheduleGlockNotes(def.patterns, def.bpm, g, def.startDelay || 8);
          break;
        }
        case 'orgol': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          g.connect(this.reverbSend);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          this._scheduleOrgolNotes(def.patterns, def.bpm, g, def.startDelay || 20);
          break;
        }
        case 'piano': {
          const g = this.ac.createGain();
          g.gain.value = 0;
          g.connect(this.dryBus);
          g.connect(this.reverbSend);
          this.layers.push({ name: def.name, icon: def.icon, gainNode: g, nodes: [], defaultVol: def.vol });
          if (this._melodyOn) {
            const hour = this._getHour();
            const { patterns: mPat, bpm: mBpm } = this._getMelodyPianoPatterns(cat, hour, this._weatherCategory);
            this._schedulePianoNotes(mPat, mBpm, g, def.startDelay || 5, false);
          } else {
            this._schedulePianoNotes(def.patterns, def.bpm, g, def.startDelay || 5, true);
          }
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
        // Gentle fade-out: exponential decay with 4s time constant → ~98% gone in 20s
        if (this.masterGain) this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 4);
        // Stop all audio 20s after timer expiry (gives 4-time-constants of fade)
        setTimeout(() => { this._stopAll(); this._showHome(); }, 20000);
      } else if (this.timerRemaining <= 90 && this.masterGain) {
        // Last 90 seconds: gradually reduce volume so the ending feels natural
        const vol = document.getElementById('master-vol').value / 100;
        const targetVol = vol * (this.timerRemaining / 90);
        this.masterGain.gain.cancelScheduledValues(this.ac.currentTime);
        this.masterGain.gain.setTargetAtTime(targetVol, this.ac.currentTime, 2);
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

    // Melody toggle button
    const melodyBtn = document.createElement('button');
    melodyBtn.id = 'melody-btn';
    melodyBtn.className = 'melody-btn' + (this._melodyOn ? ' active' : '');
    melodyBtn.title = this._melodyOn ? '旋律ON' : '旋律OFF';
    melodyBtn.innerHTML = '🎵';
    melodyBtn.addEventListener('click', () => this._toggleMelody());

    row.appendChild(pills);
    row.appendChild(melodyBtn);
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

  // ── Melody ON/OFF ─────────────────────────────────────────────────────────

  _toggleMelody() {
    this._melodyOn = !this._melodyOn;
    this._updateMelodyBtnLabel();
    // Fetch weather immediately when turning on
    if (this._melodyOn) this._fetchWeather();
    // Restart audio with new melody mode
    if (this.isPlaying) {
      this.masterGain.gain.setTargetAtTime(0, this.ac.currentTime, 0.10);
      this._stopLayersOnly();
      this._startCategory(this._uiCat, this._uiMood, 1.0);
    }
  }

  _updateMelodyBtnLabel() {
    const btn = document.getElementById('melody-btn');
    if (!btn) return;
    btn.classList.toggle('active', this._melodyOn);
    if (this._melodyOn) {
      const emoji = { clear: '☀️', cloudy: '☁️', rainy: '🌧️' }[this._weatherCategory] || '';
      btn.innerHTML = `🎵${emoji}`;
      btn.title = `旋律ON — ${emoji} ${this._weatherCategory === 'clear' ? '晴れ' : this._weatherCategory === 'cloudy' ? '曇り' : '雨'}`;
    } else {
      btn.innerHTML = '🎵';
      btn.title = '旋律OFF';
    }
  }

  async _fetchWeather() {
    // Cache 30 minutes
    if (Date.now() - this._weatherFetchedAt < 30 * 60 * 1000) return;
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('no geolocation')); return; }
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 300000 });
      });
      const { latitude: lat, longitude: lon } = pos.coords;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=weather_code&daily=sunrise,sunset&timezone=auto`;
      const res  = await fetch(url);
      const data = await res.json();

      // Weather code → category
      const code = data.current?.weather_code ?? 0;
      if      (code <= 1)  this._weatherCategory = 'clear';
      else if (code <= 48) this._weatherCategory = 'cloudy';
      else                 this._weatherCategory = 'rainy';

      // Sunrise / Sunset → store as decimal hours
      if (data.daily?.sunrise?.[0]) {
        const d = new Date(data.daily.sunrise[0]);
        this._sunriseHour = d.getHours() + d.getMinutes() / 60;
      }
      if (data.daily?.sunset?.[0]) {
        const d = new Date(data.daily.sunset[0]);
        this._sunsetHour = d.getHours() + d.getMinutes() / 60;
      }

      this._weatherFetchedAt = Date.now();
    } catch (_) {
      // Fallback: rough time-of-day guess (morning tends clear)
      const h = this._getHour();
      this._weatherCategory = (h >= 6 && h < 18) ? 'clear' : 'cloudy';
    }
    this._updateMelodyBtnLabel();
    this._applyIconBrightness();
  }

  // ── Icon brightness: sunrise/sunset aware ─────────────────────────────────

  // Smoothly interpolate CSS filter on .mode-tab-icon by time of day
  _applyIconBrightness() {
    const hour = this._getHour();
    const f    = this._getIconFilter(hour, this._sunriseHour, this._sunsetHour);
    const filterStr = `brightness(${f.b.toFixed(2)}) sepia(${f.s.toFixed(2)}) hue-rotate(${f.h.toFixed(0)}deg) saturate(${f.sat.toFixed(2)})`;
    document.querySelectorAll('.mode-tab-icon').forEach(el => {
      el.style.transition = 'filter 90s linear';
      el.style.filter     = filterStr;
    });
  }

  // Returns { b:brightness, s:sepia, h:hue-rotate, sat:saturate } for given hour
  _getIconFilter(hour, rise, set) {
    // Lerp helper
    const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));

    // Keyframes: [hour, brightness, sepia, hueRotate, saturate]
    // hue-rotate shifts warm→cool: 0=natural, 340-360=warm orange, 200-230=cool blue
    const kf = [
      [0,           0.30, 0.20, 215, 0.70],   // midnight       — dim, cold blue
      [rise - 1.5,  0.35, 0.28, 225, 0.75],   // pre-dawn       — dark blue-purple
      [rise - 0.4,  0.55, 0.50, 355, 1.10],   // civil twilight — warm pink glow
      [rise + 0.5,  0.75, 0.35, 350, 1.20],   // sunrise        — golden orange
      [rise + 2.0,  0.90, 0.12, 352, 1.10],   // morning        — warm gold fading
      [(rise+set)/2,1.00, 0.00,   0, 1.00],   // solar noon     — natural, full
      [set - 2.0,   0.92, 0.10, 350, 1.05],   // afternoon      — slightly warm
      [set - 0.4,   0.75, 0.42, 348, 1.15],   // sunset         — amber glow
      [set + 0.5,   0.52, 0.32, 355, 0.90],   // dusk           — warm purple
      [set + 1.5,   0.35, 0.22, 220, 0.75],   // early night    — cool, dim
      [24,          0.30, 0.20, 215, 0.70],   // midnight (wrap)
    ];

    // Find surrounding keyframes
    let p = kf[0], n = kf[kf.length - 1];
    for (let i = 0; i < kf.length - 1; i++) {
      if (hour >= kf[i][0] && hour <= kf[i + 1][0]) {
        p = kf[i]; n = kf[i + 1]; break;
      }
    }
    const t = (n[0] - p[0]) > 0 ? (hour - p[0]) / (n[0] - p[0]) : 0;
    // Smooth-step easing
    const ease = t * t * (3 - 2 * t);

    return {
      b:   lerp(p[1], n[1], ease),
      s:   lerp(p[2], n[2], ease),
      h:   lerp(p[3], n[3], ease),
      sat: lerp(p[4], n[4], ease),
    };
  }

  // Generate time-of-day + weather adaptive piano patterns
  _getMelodyPianoPatterns(cat, hour, weather) {
    // ── Time segment → BPM ──
    let seg, bpm;
    if      (hour <  5) { seg = 0; bpm = 4;  }   // predawn   — sparse, minimal
    else if (hour < 10) { seg = 1; bpm = 9;  }   // morning   — ascending, hopeful
    else if (hour < 17) { seg = 2; bpm = 10; }   // day       — balanced, clear
    else if (hour < 21) { seg = 3; bpm = 7;  }   // evening   — descending, warm
    else                { seg = 4; bpm = 5;  }   // night     — sparse, intimate

    if (weather === 'clear') bpm = Math.round(bpm * 1.10);
    if (weather === 'rainy') bpm = Math.max(3, Math.round(bpm * 0.85));

    // ── Calm-category constraints ────────────────────────────────────────────
    // Relaxation / sleep categories need slower tempo, narrower range, and fewer notes.
    // Goal: ambient texture that calms, not a melody that engages attention.
    const calmCats = new Set(['relax','meditation','presleep','sleep']);
    const isCalm = calmCats.has(cat);
    if (isCalm) bpm = Math.min(bpm, 7);  // never faster than 7 bpm for calm contexts

    // ── Pure C-major pentatonic (C D E G A) across 3 octaves ──
    // F and B are excluded — they create minor-2nd clashes with sustained piano decay
    const PENTA = [
      _.C3, _.D3, _.E3, _.G3, _.A3,   // idx 0–4
      _.C4, _.D4, _.E4, _.G4, _.A4,   // idx 5–9
      _.C5, _.D5, _.E5, _.G5, _.A5,   // idx 10–14
    ];

    // ── Category: usable note pools (pure pentatonic) ──
    // Calm categories (relax / meditation / presleep / sleep) are capped at C5=528Hz
    // — the solfeggio root — so no note ever sounds "jarringly high" during rest.
    const pools = {
      morning:    { low:[_.C3,_.E3,_.G3],      mid:[_.C4,_.E4,_.G4,_.A4],  high:[_.C5,_.E5,_.G5]  },
      relax:      { low:[_.C3,_.G3,_.A3],       mid:[_.C4,_.G4,_.A4],       high:[_.C5]             },
      meditation: { low:[_.C3,_.G3,_.A3],       mid:[_.C4,_.E4,_.G4,_.A4],  high:[_.C5]             },
      focus:      { low:[_.C3,_.E3,_.G3],       mid:[_.C4,_.E4,_.G4],       high:[_.C5,_.E5,_.G5]  },
      presleep:   { low:[_.C3,_.G3,_.A3],       mid:[_.C4,_.G4,_.A4],       high:[_.C5]             },
      sleep:      { low:[_.C3,_.G3],            mid:[_.C4,_.E4,_.G4],       high:[_.C5]             },
      walk:       { low:[_.C3,_.E3,_.G3,_.A3],  mid:[_.C4,_.E4,_.G4],       high:[_.C5,_.E5]        },
    };
    const catPool = pools[cat] || pools.relax;
    const PENTA_FILTERED = [...catPool.low, ...catPool.mid, ...catPool.high];
    let rMin = 0, rMax = PENTA_FILTERED.length - 1;

    // Time: predawn/night pull lower; morning pulls higher
    // For calm categories, suppress the upward shift so the register stays low
    const segShift = isCalm ? [-2, 0, 0, -1, -2][seg] : [-2, 1, 0, -1, -2][seg];
    rMin = Math.max(0,            rMin + segShift);
    rMax = Math.min(PENTA_FILTERED.length - 1, rMax + segShift);

    // Weather: clear → up 1 step, rainy → down 1 step
    // For calm categories, halve the upward push so sunny weather doesn't push too high
    const wShift = weather === 'clear' ? (isCalm ? 0 : 1) : weather === 'rainy' ? -1 : 0;
    rMin = Math.max(0,            rMin + wShift);
    rMax = Math.min(PENTA_FILTERED.length - 1, rMax + wShift);
    if (rMin >= rMax) rMax = Math.min(PENTA_FILTERED.length - 1, rMin + 3);

    // ── Density ──
    const baseDensity = [0.25, 0.50, 0.45, 0.38, 0.22][seg];
    // Calm categories: 20% sparser — more silence, more breath between notes
    const density = Math.min(0.65, baseDensity
      * (weather === 'rainy' ? 0.80 : weather === 'clear' ? 1.05 : 1.0)
      * (isCalm ? 0.80 : 1.0));

    // ── Seeded RNG ──
    const catIdx = ['morning','relax','meditation','focus','presleep','sleep','walk'].indexOf(cat);
    const wIdx   = { clear: 0, cloudy: 1, rainy: 2 }[weather] || 1;
    let seed = (catIdx * 1000 + seg * 100 + wIdx * 10 + 7) | 0;
    const rng = () => {
      seed = ((seed * 1664525 + 1013904223) & 0x7fffffff) >>> 0;
      return seed / 0x7fffffff;
    };

    // ── Build 4 patterns with melodic contour ──
    // Key idea: move STEPWISE (±1 or ±2 in PENTA) — never random-jump across octaves.
    // Piano notes sustain 4-5 s, so consecutive notes overlap → must be consonant.
    const patterns = [];
    let pos = Math.round(rMin + rng() * (rMax - rMin));  // starting position

    for (let p = 0; p < 4; p++) {
      // Choose shape for this 8-beat pattern
      const shapeR = rng();
      // ascend / descend / arch(up then down) / valley(down then up) / meander
      // Calm categories: strongly prefer descend / valley / meander (settling shapes)
      // and almost never use pure ascend (which creates tension and expectation).
      const shape = isCalm
        ? (shapeR < 0.08 ? 'ascend'    //  8% — very rarely climb
         : shapeR < 0.36 ? 'descend'   // 28% — prefer downward (settling)
         : shapeR < 0.54 ? 'arch'      // 18% — peak then resolve
         : shapeR < 0.78 ? 'valley'    // 24% — cradle motion (down, then soft rise)
         : 'meander')                  // 22% — gentle wandering
        : (shapeR < 0.22 ? 'ascend'
         : shapeR < 0.44 ? 'descend'
         : shapeR < 0.62 ? 'arch'
         : shapeR < 0.80 ? 'valley'
         : 'meander');

      const pat = [];
      for (let n = 0; n < 8; n++) {
        if (rng() >= density) { pat.push(null); continue; }

        // Stepwise delta: bias determined by shape
        let delta;
        switch (shape) {
          case 'ascend':  delta = rng() < 0.70 ? 1 : 0;  break;
          case 'descend': delta = rng() < 0.70 ? -1 : 0; break;
          case 'arch':    delta = n < 4 ? (rng() < 0.65 ? 1 : 0) : (rng() < 0.65 ? -1 : 0); break;
          case 'valley':  delta = n < 4 ? (rng() < 0.65 ? -1 : 0) : (rng() < 0.65 ? 1 : 0); break;
          default:        delta = Math.round((rng() - 0.5) * 2); break;  // −1, 0, +1
        }
        // Occasionally a ±2 leap (pentatonic = consonant skip-3rd)
        // Calm categories: halve leap frequency to keep motion smooth and unhurried
        if (rng() < (isCalm ? 0.08 : 0.18)) delta *= 2;

        pos = Math.max(rMin, Math.min(rMax, pos + delta));
        pat.push(PENTA_FILTERED[pos]);
      }

      // Guarantee at least one sounding note per pattern
      if (!pat.some(Boolean)) {
        const gi = Math.floor(rng() * 8);
        pat[gi] = PENTA_FILTERED[pos];
      }

      patterns.push(pat);

      // Between patterns: small register reset (±0 or ±2 steps, always stays in range)
      const jump = [-2, -1, 0, 0, 1, 2][Math.floor(rng() * 6)];
      pos = Math.max(rMin, Math.min(rMax, pos + jump));
    }

    return { patterns, bpm };
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

  _addFilmGrain(ctx, W, H, t, alpha = 0.028) {
    const frame = Math.floor(t * 3);
    ctx.save(); ctx.globalAlpha = alpha;
    for (let gn = 0; gn < 700; gn++) {
      let seed = ((gn * 1664525 + frame * 22695477 + 1013904223) & 0x7fffffff) >>> 0;
      const gx = (seed % (W | 0));
      seed = ((seed * 1664525 + 1013904223) & 0x7fffffff) >>> 0;
      const gy = (seed % (H | 0));
      seed = ((seed * 1664525 + 1013904223) & 0x7fffffff) >>> 0;
      const gv = seed & 0xff;
      ctx.fillStyle = `rgb(${gv},${gv},${gv})`;
      ctx.fillRect(gx, gy, 1, 1);
    }
    ctx.restore();
  }

  // ── 朝の目覚め — Aurora Dawn (time-aware) ──────────────────────────────────
  _drawMorning() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W * 0.5;
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr - 6) / 12 * Math.PI));
    const dawn = Math.max(0, 1 - Math.abs(hr - 6.5) / 2.8);

    // Physically-based sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    if (dawn > 0.25) {
      sky.addColorStop(0,    `rgb(${(8+dawn*20)|0},${(4+dawn*8)|0},${(22+dawn*22)|0})`);
      sky.addColorStop(0.30, `rgb(${(18+dawn*35)|0},${(8+dawn*14)|0},${(40+dawn*18)|0})`);
      sky.addColorStop(0.55, `rgb(${(50+dawn*95)|0},${(13+dawn*30)|0},${(48-dawn*28)|0})`);
      sky.addColorStop(0.75, `rgb(${(135+dawn*95)|0},${(36+dawn*48)|0},${(18+dawn*10)|0})`);
      sky.addColorStop(0.90, `rgb(${(205+dawn*45)|0},${(92+dawn*42)|0},${(22+dawn*8)|0})`);
      sky.addColorStop(1,    `rgb(${(225+dawn*28)|0},${(135+dawn*18)|0},${30})`);
    } else if (day > 0.3) {
      sky.addColorStop(0,    `rgb(${(22+day*30)|0},${(45+day*70)|0},${(95+day*100)|0})`);
      sky.addColorStop(0.45, `rgb(${(42+day*42)|0},${(85+day*82)|0},${(145+day*58)|0})`);
      sky.addColorStop(1,    `rgb(${(125+day*42)|0},${(165+day*32)|0},${(145+day*8)|0})`);
    } else {
      sky.addColorStop(0, 'rgb(3,5,16)'); sky.addColorStop(0.5, 'rgb(7,9,28)'); sky.addColorStop(1, 'rgb(10,14,22)');
    }
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // Stars pre-dawn
    if (day < 0.35) {
      const starA = Math.max(0, 1 - day * 3.5);
      for (let i = 0; i < 80; i++) {
        const s = i * 127.1;
        const sx = ((Math.sin(s*0.11)+1)/2)*W, sy = ((Math.sin(s*0.073)+1)/2)*H*0.72;
        const sa = starA * Math.abs(Math.sin(t*0.4+s));
        if (sa < 0.01) continue;
        ctx.fillStyle = `rgba(218,224,255,${sa.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(sx, sy, 0.5+Math.abs(Math.sin(s*0.44)), 0, Math.PI*2); ctx.fill();
      }
    }

    // Pre-dawn aurora
    if (day < 0.22) {
      const aurA = Math.max(0, 1 - day * 5) * 0.22;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      [[0.22,0.14,[30,200,155]],[0.58,0.12,[70,100,225]],[0.78,0.09,[155,55,200]]].forEach(([xR,wR,rgb],i) => {
        const bx = xR*W, bw = wR*W;
        const g = ctx.createLinearGradient(bx-bw,0,bx+bw,0);
        g.addColorStop(0,'rgba(0,0,0,0)');
        g.addColorStop(0.5,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(aurA*(0.9-i*0.2)).toFixed(3)})`);
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H*0.52);
      });
      ctx.restore();
    }

    // Sun position
    const sunVis = Math.max(0, Math.min(1, (hr - 5) / 3.5));
    const sunX = cx, sunY = H * (0.96 - sunVis * 0.76);

    if (sunVis > 0.01) {
      // Multi-layer physical bloom
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      [[H*1.1,0.032],[H*0.58,0.060],[H*0.28,0.120],[H*0.12,0.260],[H*0.055,0.520]].forEach(([r,a]) => {
        const g = ctx.createRadialGradient(sunX,sunY,0,sunX,sunY,r*sunVis);
        g.addColorStop(0,   `rgba(255,220,110,${a})`);
        g.addColorStop(0.18,`rgba(255,185,65,${a*0.38})`);
        g.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      });
      ctx.restore();

      // Crepuscular god rays
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const numRays = 24;
      for (let ri = 0; ri < numRays; ri++) {
        const angle = (ri/numRays)*Math.PI*2 + t*0.0018;
        const rayLen = Math.max(W,H)*2.4;
        const half = (Math.PI*2/numRays)*0.32;
        const br = (0.010 + 0.007*Math.sin(ri*2.1+t*0.055)) * sunVis;
        ctx.beginPath();
        ctx.moveTo(sunX, sunY);
        ctx.lineTo(sunX+Math.cos(angle-half)*rayLen, sunY+Math.sin(angle-half)*rayLen);
        ctx.lineTo(sunX+Math.cos(angle+half)*rayLen, sunY+Math.sin(angle+half)*rayLen);
        ctx.closePath();
        const rg = ctx.createLinearGradient(sunX,sunY,sunX+Math.cos(angle)*rayLen*0.45,sunY+Math.sin(angle)*rayLen*0.45);
        rg.addColorStop(0,  `rgba(255,235,145,${br.toFixed(4)})`);
        rg.addColorStop(0.3,`rgba(255,195,90,${(br*0.35).toFixed(4)})`);
        rg.addColorStop(1,  'rgba(255,170,50,0)');
        ctx.fillStyle = rg; ctx.fill();
      }
      ctx.restore();

      // Lens flare rings
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const flares = [{d:0.32,r:H*0.024,a:0.07,c:[255,195,80]},{d:0.54,r:H*0.042,a:0.04,c:[175,115,255]},{d:0.76,r:H*0.016,a:0.09,c:[90,200,255]},{d:0.92,r:H*0.030,a:0.03,c:[255,155,55]}];
      flares.forEach(f => {
        const fx = sunX+(cx-sunX)*f.d, fy = sunY+(H*0.5-sunY)*f.d;
        const fg = ctx.createRadialGradient(fx,fy,0,fx,fy,f.r);
        fg.addColorStop(0,  `rgba(${f.c[0]},${f.c[1]},${f.c[2]},${(f.a*sunVis).toFixed(3)})`);
        fg.addColorStop(0.5,`rgba(${f.c[0]},${f.c[1]},${f.c[2]},${(f.a*sunVis*0.25).toFixed(3)})`);
        fg.addColorStop(1,  'rgba(0,0,0,0)');
        ctx.fillStyle = fg; ctx.fillRect(0,0,W,H);
      });
      ctx.restore();

      // Sun disc
      ctx.fillStyle = `rgba(255,252,228,${(0.96*sunVis).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(sunX, sunY, H*0.021, 0, Math.PI*2); ctx.fill();
    }

    // Horizon atmospheric haze
    const hazeY = H*0.76;
    const haze = ctx.createLinearGradient(0,hazeY-30,0,H);
    const hc = dawn>0.3?[198,125,55]:day>0.4?[175,205,195]:[75,95,135];
    haze.addColorStop(0,'rgba(0,0,0,0)');
    haze.addColorStop(0.4,`rgba(${hc[0]},${hc[1]},${hc[2]},${(0.10+dawn*0.14).toFixed(3)})`);
    haze.addColorStop(1,`rgba(${hc[0]},${hc[1]},${hc[2]},${(0.24+dawn*0.20).toFixed(3)})`);
    ctx.fillStyle = haze; ctx.fillRect(0,hazeY-30,W,H-hazeY+30);

    // Atmospheric dust in light shafts
    for (let i = 0; i < 140; i++) {
      const s = i*137.508;
      const px = ((Math.sin(s*0.17)+1)/2)*W;
      const vy = t*0.00040*(0.5+0.5*Math.sin(s*0.3));
      const py = ((((Math.sin(s*0.11)+1)/2)-vy)%1+1)%1*H;
      const dx = px-sunX, dy = py-sunY;
      const prox = Math.max(0, 1-Math.sqrt(dx*dx+dy*dy)/(H*0.85));
      const al = ((0.06+0.24*Math.abs(Math.sin(t*0.33+s)))*(0.25+prox*0.75)*(0.4+dawn*0.6+day*0.3)).toFixed(3);
      const dc = dawn>0.2?[255,212,95]:[198,218,255];
      ctx.fillStyle = `rgba(${dc[0]},${dc[1]},${dc[2]},${al})`;
      ctx.beginPath(); ctx.arc(px,py,0.35+0.9*Math.abs(Math.sin(s*0.44)),0,Math.PI*2); ctx.fill();
    }

    this._addFilmGrain(ctx, W, H, t, 0.030);
  }

  // ── リラックス — Floating Orbs (time-aware) ───────────────────────────────
  // ゆっくりと漂う発光体: 深海の生物発光 / 水面を漂う光
  _drawRelax() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W/2, cy = H*0.42;
    const U  = Math.min(W,H);
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr-6)/12*Math.PI));
    const dusk = Math.max(0, 1-Math.abs(hr-18)/3.0);

    // Abyssal dark water
    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0,   `rgb(${(2+day*4+dusk*10)|0},${(8+day*14+dusk*6)|0},${(18+day*18-dusk*4)|0})`);
    bg.addColorStop(0.5, `rgb(${(3+day*5)|0},${(12+day*10)|0},${(24+day*14)|0})`);
    bg.addColorStop(1,   `rgb(${(4+day*6)|0},${(16+day*12)|0},${(28+day*16)|0})`);
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

    // Surface light shafts from above (underwater god rays)
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const shafts = [
      {x:0.25,w:0.13,drift:0.035,a:0.07},{x:0.60,w:0.10,drift:0.042,a:0.055},{x:0.82,w:0.08,drift:0.028,a:0.045},
    ];
    shafts.forEach((sh,si) => {
      const sx = (sh.x+Math.sin(t*sh.drift+si*1.1)*0.04)*W;
      const topW = sh.w*W*0.5, botW = sh.w*W*2.2, botY = H*(0.62+Math.sin(t*0.018+si)*0.06);
      ctx.beginPath();
      ctx.moveTo(sx-topW/2,0); ctx.lineTo(sx+topW/2,0);
      ctx.lineTo(sx+botW/2,botY); ctx.lineTo(sx-botW/2,botY);
      ctx.closePath();
      const sg = ctx.createLinearGradient(sx,0,sx,botY);
      const sc = dusk>0.3?[140,100,240]:[0,200,225];
      sg.addColorStop(0,  `rgba(${sc[0]},${sc[1]},${sc[2]},${sh.a})`);
      sg.addColorStop(0.5,`rgba(${sc[0]},${sc[1]},${sc[2]},${sh.a*0.55})`);
      sg.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fill();
    });
    ctx.restore();

    // Caustic interference light pattern (floor)
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.06+day*0.03;
    const causticY = H*0.72;
    for (let ci = 0; ci < 8; ci++) {
      const ca = (ci/8)*Math.PI*2;
      const cr = U*(0.08+0.04*Math.sin(t*0.08+ci));
      const cxc = cx+Math.cos(ca+t*0.022)*W*0.30, cyc = causticY+Math.sin(ca+t*0.018)*H*0.08;
      const cg = ctx.createRadialGradient(cxc,cyc,0,cxc,cyc,cr);
      const cc = dusk>0.3?[130,90,255]:[0,200,220];
      cg.addColorStop(0,`rgba(${cc[0]},${cc[1]},${cc[2]},0.55)`);
      cg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cxc,cyc,cr,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // Deep ambient glow
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    const gc = dusk>0.2?[70,45,175]:[0,115,128];
    const gg = ctx.createRadialGradient(cx,cy,0,cx,cy,U*0.60);
    gg.addColorStop(0,  `rgba(${gc[0]},${gc[1]},${gc[2]},${(0.20+day*0.08).toFixed(3)})`);
    gg.addColorStop(1,  'rgba(0,0,0,0)');
    ctx.fillStyle = gg; ctx.fillRect(0,0,W,H);
    ctx.restore();

    // Bioluminescent jellyfish entities (large glowing blobs)
    const jellies = [
      {px:cx+Math.sin(t*0.038)*W*0.30, py:cy+Math.cos(t*0.028)*H*0.22, r:U*0.14, rgb:dusk>0.3?[130,85,245]:[0,200,210]},
      {px:cx+Math.sin(t*0.029+2.1)*W*0.25,py:cy+Math.cos(t*0.041+2.1)*H*0.18,r:U*0.10,rgb:dusk>0.3?[95,52,225]:[30,175,215]},
      {px:cx+Math.sin(t*0.051+4.2)*W*0.20,py:cy+Math.cos(t*0.035+4.2)*H*0.24,r:U*0.08,rgb:dusk>0.3?[175,110,255]:[95,220,210]},
    ];
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    jellies.forEach((j,ji) => {
      const pulse = 0.5+0.5*Math.sin(t*(0.50+ji*0.14)+ji*2.1);
      const [r,g,b] = j.rgb;
      for (let ri = 0; ri < 4; ri++) {
        const rp = ((t*0.08+ji*0.33+ri*0.25)%1);
        const rr = j.r*(0.8+rp*4.5);
        ctx.beginPath(); ctx.arc(j.px,j.py,rr,0,Math.PI*2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${((1-rp)*0.14).toFixed(3)})`;
        ctx.lineWidth = 0.9; ctx.stroke();
      }
      const jg = ctx.createRadialGradient(j.px,j.py,0,j.px,j.py,j.r*(3.2+pulse));
      jg.addColorStop(0,  `rgba(${r},${g},${b},${(0.22+pulse*0.14).toFixed(3)})`);
      jg.addColorStop(0.4,`rgba(${r},${g},${b},${(0.08+pulse*0.05).toFixed(3)})`);
      jg.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle = jg; ctx.beginPath(); ctx.arc(j.px,j.py,j.r*(3.2+pulse),0,Math.PI*2); ctx.fill();
      const cg = ctx.createRadialGradient(j.px,j.py,0,j.px,j.py,j.r);
      cg.addColorStop(0,  `rgba(${Math.min(255,r+90)},${Math.min(255,g+70)},${Math.min(255,b+50)},${(0.65+pulse*0.28).toFixed(3)})`);
      cg.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(j.px,j.py,j.r,0,Math.PI*2); ctx.fill();
    });
    ctx.restore();

    // Dense bioluminescent particle field
    const pRgb = dusk>0.2?`175,135,255`:`85,215,220`;
    for (let i = 0; i < 180; i++) {
      const s = i*137.508;
      const px = ((Math.sin(s*0.17)+1)/2)*W;
      const vy = t*0.00028*(0.5+0.5*Math.sin(s*0.3));
      const py = ((((Math.sin(s*0.11)+1)/2)-vy)%1+1)%1*H;
      const al = (0.06+0.48*Math.abs(Math.sin(t*0.26+s))).toFixed(2);
      ctx.fillStyle = `rgba(${pRgb},${al})`;
      ctx.beginPath(); ctx.arc(px,py,0.4+1.2*Math.abs(Math.sin(s*0.44)),0,Math.PI*2); ctx.fill();
    }

    this._addFilmGrain(ctx, W, H, t, 0.025);
  }

  // ── 散歩 — Outdoor Walk (time-aware) ─────────────────────────────────────
  _drawWalk() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const hr   = this._getHour();
    const day  = Math.max(0, Math.sin((hr-6)/12*Math.PI));
    const eve  = Math.max(0, 1-Math.abs(hr-18)/3);
    const nite = Math.max(0, 1-day*1.4);
    const dawn = Math.max(0, 1-Math.abs(hr-6)/2.5);

    // Sky
    const sky = ctx.createLinearGradient(0,0,0,H);
    if (nite>0.55) {
      sky.addColorStop(0,'rgb(3,5,14)'); sky.addColorStop(1,'rgb(6,10,18)');
    } else if (eve>0.35) {
      sky.addColorStop(0,'rgb(16,10,44)'); sky.addColorStop(0.38,'rgb(75,28,72)');
      sky.addColorStop(0.68,'rgb(185,58,38)'); sky.addColorStop(1,'rgb(218,98,28)');
    } else {
      sky.addColorStop(0,  `rgb(${(28+day*82)|0},${(88+day*92)|0},${(168+day*58)|0})`);
      sky.addColorStop(0.6,`rgb(${(58+day*52)|0},${(128+day*62)|0},${(178+day*22)|0})`);
      sky.addColorStop(1,  `rgb(${(38+day*62)|0},${(98+day*82)|0},${(48+day*32)|0})`);
    }
    ctx.fillStyle = sky; ctx.fillRect(0,0,W,H);

    // Night stars
    if (nite>0.25) {
      for (let i=0;i<70;i++) {
        const s=i*127.1, sx=((Math.sin(s*0.11)+1)/2)*W, sy=((Math.sin(s*0.073)+1)/2)*H*0.62;
        const sa=nite*0.60*Math.abs(Math.sin(t*0.45+s));
        if (sa<0.01) continue;
        ctx.fillStyle=`rgba(215,222,255,${sa.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(sx,sy,0.4+Math.abs(Math.sin(s*0.44)),0,Math.PI*2); ctx.fill();
      }
    }

    // Sun / Moon bloom
    const sunX=W*0.68, sunY=H*(eve>0.4?0.55:nite>0.5?0.16:Math.max(0.06,0.40-day*0.28));
    ctx.save(); ctx.globalCompositeOperation='screen';
    if (nite>0.50) {
      const mg=ctx.createRadialGradient(sunX,sunY,0,sunX,sunY,H*0.22);
      mg.addColorStop(0,`rgba(200,210,255,${(nite*0.18).toFixed(3)})`); mg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=mg; ctx.fillRect(0,0,W,H);
    } else {
      const lightA = eve>0.4?0.55:day*0.48;
      const lc=eve>0.4?[255,160,30]:[255,230,120];
      [[H*0.80,lightA*0.06],[H*0.40,lightA*0.14],[H*0.18,lightA*0.30],[H*0.07,lightA*0.55]].forEach(([r,a])=>{
        const g=ctx.createRadialGradient(sunX,sunY,0,sunX,sunY,r);
        g.addColorStop(0,`rgba(${lc[0]},${lc[1]},${lc[2]},${a})`);
        g.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
      });
    }
    ctx.restore();

    // Sun/Moon disc
    if (nite>0.50) {
      ctx.fillStyle=`rgba(228,235,255,${(nite*0.88).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(sunX,sunY,H*0.022,0,Math.PI*2); ctx.fill();
    } else if (day>0.08) {
      ctx.fillStyle=`rgba(255,252,225,${(day*0.94+eve*0.20).toFixed(2)})`;
      ctx.beginPath(); ctx.arc(sunX,sunY,H*0.020,0,Math.PI*2); ctx.fill();
    }

    // Ground fog layers
    const gndY=H*0.62;
    for (let fi=0;fi<5;fi++) {
      const fy=gndY+fi*(H-gndY)*0.18+Math.sin(t*0.06+fi)*4;
      const fog=ctx.createLinearGradient(0,fy-12,0,fy+22);
      const fc=eve>0.3?[190,130,70]:nite>0.5?[28,38,48]:[145,180,145];
      fog.addColorStop(0,'rgba(0,0,0,0)');
      fog.addColorStop(0.5,`rgba(${fc[0]},${fc[1]},${fc[2]},${(0.06+day*0.04+eve*0.06).toFixed(3)})`);
      fog.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=fog; ctx.fillRect(0,fy-12,W,34);
    }

    // Forest silhouette treeline
    const treeY=gndY;
    const treeFill=nite>0.5?'rgba(4,8,6,0.96)':eve>0.3?'rgba(18,8,4,0.90)':`rgba(${(8+day*10)|0},${(22+day*20)|0},${(6+day*8)|0},0.88)`;

    // Background trees (small)
    for (let i=0;i<16;i++) {
      const bx=W*(i/16+0.03), bh=H*(0.10+((i*7)%5)*0.02), bw=W*0.038;
      const sway=Math.sin(t*0.12+i*0.9)*0.006*W;
      ctx.fillStyle=treeFill;
      ctx.beginPath(); ctx.ellipse(bx+sway,treeY-bh*0.52,bw*0.44,bh*0.54,sway*0.02,0,Math.PI*2); ctx.fill();
      ctx.fillRect(bx+sway-bw*0.055,treeY-bh*0.16,bw*0.11,bh*0.18);
    }

    // God rays through forest (cinematic shafts)
    ctx.save(); ctx.globalCompositeOperation='screen';
    const rayA=(eve>0.4?0.042:day*0.030);
    if (rayA>0.005) {
      const rayOriginX=sunX, rayOriginY=sunY;
      for (let ri=0;ri<14;ri++) {
        const angle=(ri/14)*Math.PI*2+t*0.0015;
        const rLen=Math.max(W,H)*2.2, half=(Math.PI*2/14)*0.28;
        const br=rayA*(0.8+0.5*Math.sin(ri*1.7+t*0.04));
        ctx.beginPath();
        ctx.moveTo(rayOriginX,rayOriginY);
        ctx.lineTo(rayOriginX+Math.cos(angle-half)*rLen,rayOriginY+Math.sin(angle-half)*rLen);
        ctx.lineTo(rayOriginX+Math.cos(angle+half)*rLen,rayOriginY+Math.sin(angle+half)*rLen);
        ctx.closePath();
        const rg=ctx.createLinearGradient(rayOriginX,rayOriginY,rayOriginX+Math.cos(angle)*rLen*0.40,rayOriginY+Math.sin(angle)*rLen*0.40);
        const rc=eve>0.4?[255,175,60]:[255,230,130];
        rg.addColorStop(0,`rgba(${rc[0]},${rc[1]},${rc[2]},${br.toFixed(4)})`);
        rg.addColorStop(0.4,`rgba(${rc[0]},${rc[1]},${rc[2]},${(br*0.28).toFixed(4)})`);
        rg.addColorStop(1,'rgba(0,0,0,0)');
        ctx.fillStyle=rg; ctx.fill();
      }
    }
    ctx.restore();

    // Foreground trees (large, dark)
    [{x:0.05,h:0.52,w:0.12,s:1.9,sp:0.18},{x:0.15,h:0.42,w:0.10,s:1.5,sp:0.15},
     {x:0.84,h:0.47,w:0.11,s:1.7,sp:0.20},{x:0.94,h:0.54,w:0.13,s:2.1,sp:0.23}].forEach(tr=>{
      const sw=Math.sin(t*tr.sp)*tr.s/100, tx=(tr.x+sw)*W, th=tr.h*H, tw=tr.w*W;
      ctx.fillStyle=treeFill;
      ctx.fillRect(tx-tw*0.052,gndY-th*0.28,tw*0.104,th*0.30);
      ctx.beginPath(); ctx.ellipse(tx,gndY-th*0.58,tw*0.50,th*0.50,sw*0.35,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(tx+tw*0.10,gndY-th*0.46,tw*0.36,th*0.36,sw*0.25,0,Math.PI*2); ctx.fill();
    });

    // Ground
    const gnd=ctx.createLinearGradient(0,gndY,0,H);
    gnd.addColorStop(0,eve>0.3?`rgba(50,28,8,0.92)`:nite>0.5?`rgba(8,18,10,0.94)`:`rgba(${(25+day*38)|0},${(68+day*52)|0},${(15+day*18)|0},0.90)`);
    gnd.addColorStop(1,eve>0.3?`rgba(22,10,3,0.98)`:nite>0.5?`rgba(3,7,4,0.98)`:`rgba(${(10+day*16)|0},${(32+day*26)|0},${(6+day*8)|0},0.98)`);
    ctx.fillStyle=gnd; ctx.fillRect(0,gndY,W,H-gndY);

    // Bokeh depth-of-field orbs (background)
    if (!this._walkBokeh) {
      this._walkBokeh=Array.from({length:28},()=>({x:Math.random(),y:0.05+Math.random()*0.70,r:4+Math.random()*14,phase:Math.random()*Math.PI*2,spd:0.12+Math.random()*0.18}));
    }
    this._walkBokeh.forEach(b=>{
      const pulse=0.30+0.70*Math.abs(Math.sin(t*b.spd+b.phase));
      const ba=nite>0.4?0.18:eve>0.3?0.12:0.08;
      const bc=nite>0.4?[180,240,150]:eve>0.3?[255,200,80]:[220,240,180];
      const bg=ctx.createRadialGradient(b.x*W,b.y*H,0,b.x*W,b.y*H,b.r*(1+pulse*0.5));
      bg.addColorStop(0,`rgba(${bc[0]},${bc[1]},${bc[2]},${(ba*pulse).toFixed(3)})`);
      bg.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=bg; ctx.beginPath(); ctx.arc(b.x*W,b.y*H,b.r*(1+pulse*0.5),0,Math.PI*2); ctx.fill();
    });

    // Fireflies / motes
    if (!this._walkMotes) {
      this._walkMotes=Array.from({length:24},()=>({x:Math.random(),y:0.05+Math.random()*0.75,r:0.7+Math.random()*2.0,dx:(Math.random()-0.5)*0.00015,dy:-Math.random()*0.00009-0.00003,phase:Math.random()*Math.PI*2,spd:0.4+Math.random()*0.8}));
    }
    this._walkMotes.forEach(m=>{
      m.x+=m.dx; m.y+=m.dy;
      if(m.y<-0.02){m.y=0.82;m.x=Math.random();}
      if(m.x<-0.02||m.x>1.02)m.x=Math.random();
      const pulse=0.38+0.62*Math.sin(t*m.spd+m.phase);
      const al=(nite>0.3?0.68:eve>0.3?0.32:0.18)*pulse;
      const mc=nite>0.3?[185,255,145]:eve>0.3?[255,215,85]:[255,238,125];
      ctx.beginPath(); ctx.arc(m.x*W,m.y*H,m.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(${mc[0]},${mc[1]},${mc[2]},${al.toFixed(3)})`; ctx.fill();
    });

    this._addFilmGrain(ctx,W,H,t,0.028);
  }

  // ── 集中 — Lissajous Flow (time-aware) ───────────────────────────────────
  _drawFocus() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W/2, cy = H*0.44;
    const U  = Math.min(W,H);

    ctx.fillStyle='#000508'; ctx.fillRect(0,0,W,H);

    // Deep void glow
    const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,U*0.60);
    bg.addColorStop(0,  'rgba(0,30,22,0.18)');
    bg.addColorStop(0.6,'rgba(0,14,10,0.06)');
    bg.addColorStop(1,  'transparent');
    ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

    // Initialize network nodes
    if (!this._focusNodes||this._focusW!==W||this._focusH!==H) {
      this._focusW=W; this._focusH=H;
      this._focusNodes=Array.from({length:52},()=>({
        x:W*0.05+Math.random()*W*0.90, y:H*0.05+Math.random()*H*0.90,
        r:1.2+Math.random()*3.0, phase:Math.random()*Math.PI*2,
        spd:0.25+Math.random()*0.75, vx:(Math.random()-0.5)*0.18, vy:(Math.random()-0.5)*0.18,
      }));
    }
    this._focusNodes.forEach(n=>{
      n.x+=n.vx; n.y+=n.vy;
      if(n.x<W*0.03||n.x>W*0.97)n.vx*=-1;
      if(n.y<H*0.03||n.y>H*0.97)n.vy*=-1;
    });

    // Connections
    const maxDist=U*0.26;
    ctx.save(); ctx.globalCompositeOperation='screen';
    for (let i=0;i<this._focusNodes.length;i++) {
      for (let j=i+1;j<this._focusNodes.length;j++) {
        const ni=this._focusNodes[i],nj=this._focusNodes[j];
        const dx=ni.x-nj.x,dy=ni.y-nj.y,dist=Math.sqrt(dx*dx+dy*dy);
        if(dist>=maxDist)continue;
        const str=1-dist/maxDist;
        const pulse=Math.abs(Math.sin(t*1.0+i*0.4+j*0.3));
        ctx.strokeStyle=`rgba(42,200,138,${(str*0.12+pulse*str*0.12).toFixed(3)})`;
        ctx.lineWidth=0.4+str*0.9;
        ctx.beginPath(); ctx.moveTo(ni.x,ni.y); ctx.lineTo(nj.x,nj.y); ctx.stroke();
        // Electric pulse dot
        if (pulse>0.85&&str>0.5) {
          const pd=((t*1.0+i*0.4)%1);
          const px=ni.x+dx*pd*(-1),py=ni.y+dy*pd*(-1);
          ctx.fillStyle=`rgba(140,255,200,${(str*0.70).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(px,py,1.5,0,Math.PI*2); ctx.fill();
        }
      }
    }
    ctx.restore();

    // Nodes
    ctx.save(); ctx.globalCompositeOperation='screen';
    this._focusNodes.forEach(n=>{
      const pulse=0.5+0.5*Math.sin(t*n.spd+n.phase);
      const ng=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r*(2.8+pulse*2.0));
      ng.addColorStop(0,  `rgba(90,255,185,${(0.60+pulse*0.28).toFixed(3)})`);
      ng.addColorStop(0.35,`rgba(42,200,138,${(0.18+pulse*0.12).toFixed(3)})`);
      ng.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle=ng; ctx.beginPath(); ctx.arc(n.x,n.y,n.r*(2.8+pulse*2.0),0,Math.PI*2); ctx.fill();
    });
    ctx.restore();
    this._focusNodes.forEach(n=>{
      ctx.fillStyle='rgba(190,255,225,0.92)';
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r*0.55,0,Math.PI*2); ctx.fill();
    });

    // Central Lissajous trace
    const A=U*0.28,B=U*0.21,fa=3,fb=2+0.08*Math.sin(t*0.028),dphi=t*0.055;
    ctx.save(); ctx.globalCompositeOperation='screen';
    ctx.beginPath();
    for (let i=0;i<220;i++) {
      const θ=(i/220)*Math.PI*2;
      const x=cx+A*Math.sin(fa*θ+dphi), y=cy+B*Math.sin(fb*θ);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.strokeStyle='rgba(42,200,138,0.07)'; ctx.lineWidth=1.0; ctx.stroke();
    for (let i=0;i<220;i++) {
      const θ=(i/220)*Math.PI*2;
      const x=cx+A*Math.sin(fa*θ+dphi), y=cy+B*Math.sin(fb*θ);
      const al=(0.18+0.48*Math.abs(Math.sin(θ*3.0+t*0.7))).toFixed(2);
      const hue=155+40*(i/220);
      ctx.fillStyle=`hsla(${hue|0},82%,65%,${al})`;
      ctx.beginPath(); ctx.arc(x,y,0.8+1.4*Math.abs(Math.sin(θ*2.2+t*0.4)),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    this._addFilmGrain(ctx,W,H,t,0.022);
  }

  // ── 瞑想 — Breathing Mandala (time-aware) ────────────────────────────────
  _drawMeditation() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const cx = W/2, cy = H*0.42;
    const U  = Math.min(W,H);
    const hr   = this._getHour();
    const dusk = Math.max(0, 1-Math.abs(hr-18)/3.2);

    // Cosmic deep space
    ctx.fillStyle='#03010e'; ctx.fillRect(0,0,W,H);

    // Nebula clouds (screen composited)
    ctx.save(); ctx.globalCompositeOperation='screen';
    const nebulae=[
      {x:cx+Math.sin(t*0.006)*W*0.10,y:cy-H*0.05,r:U*0.62,c:[75,20,130],a:0.18+dusk*0.06},
      {x:cx-W*0.15+Math.cos(t*0.005)*W*0.08,y:cy+H*0.08,r:U*0.48,c:[50,12,110],a:0.14+dusk*0.04},
      {x:cx+W*0.18,y:cy-H*0.12,r:U*0.38,c:[110,35,160],a:0.12},
      {x:cx-W*0.08,y:cy+H*0.18,r:U*0.42,c:[30,8,90],a:0.10},
    ];
    nebulae.forEach(n=>{
      const ng=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,n.r);
      ng.addColorStop(0,  `rgba(${n.c[0]+dusk*45|0},${n.c[1]},${n.c[2]},${n.a.toFixed(3)})`);
      ng.addColorStop(0.45,`rgba(${n.c[0]},${n.c[1]},${n.c[2]},${(n.a*0.38).toFixed(3)})`);
      ng.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle=ng; ctx.fillRect(0,0,W,H);
    });
    ctx.restore();

    // Star field (150 stars)
    for (let i=0;i<150;i++) {
      const s=i*127.1;
      const sx=((Math.sin(s*0.11)+1)/2)*W, sy=((Math.sin(s*0.073)+1)/2)*H;
      const sa=0.10+0.55*Math.abs(Math.sin(t*0.35+s));
      const sr=0.3+0.9*Math.abs(Math.sin(s*0.44));
      ctx.fillStyle=`rgba(215,205,255,${sa.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2); ctx.fill();
    }

    // Galaxy spiral
    ctx.save(); ctx.globalCompositeOperation='screen';
    const arms=2, twist=3.8;
    for (let i=0;i<200;i++) {
      const pct=i/200, arm=i%arms;
      const r=pct*U*0.40;
      const angle=(arm/arms)*Math.PI*2+pct*twist*Math.PI+t*0.012*(1-pct*0.6);
      const scatter=r*0.14;
      const px=cx+r*Math.cos(angle)+(Math.sin(i*73.1)*scatter);
      const py=cy+r*Math.sin(angle)*0.72+(Math.cos(i*37.3)*scatter);
      const br=(1-pct*0.65)*(0.12+0.28*Math.abs(Math.sin(t*0.28+i*0.1)));
      const hue=260+pct*85+dusk*30;
      ctx.fillStyle=`hsla(${hue|0},80%,72%,${br.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(px,py,0.3+(1-pct)*1.4,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // Breathing mandala (cosmic version)
    const ph=(t%16)/16;
    let ratio,label;
    if      (ph<0.25){ratio=ph/0.25;label='吸　う';}
    else if (ph<0.50){ratio=1;label='保　つ';}
    else if (ph<0.75){ratio=1-(ph-0.50)/0.25;label='吐　く';}
    else             {ratio=0;label='　　…';}
    const cR=U*(0.08+0.16*ratio);
    const rimR=(190+dusk*55)|0, rimG=(100-dusk*32)|0, rimB=(255-dusk*42)|0;

    // Ripple rings
    for (let i=0;i<10;i++) {
      const prog=((t*0.13+i/10)%1);
      const rRip=cR+prog*U*0.56;
      const al=(1-prog)*0.20;
      if(al<0.005)continue;
      ctx.beginPath(); ctx.arc(cx,cy,rRip,0,Math.PI*2);
      ctx.strokeStyle=`rgba(${rimR},${rimG},${rimB},${al.toFixed(3)})`;
      ctx.lineWidth=1.1*(1-prog*0.55); ctx.stroke();
    }

    // Lotus petals
    const rotOuter=t*0.016;
    for (let i=0;i<8;i++) {
      const a=(i/8)*Math.PI*2+rotOuter;
      const pd=cR*1.70, pr=cR*0.72;
      const px2=cx+Math.cos(a)*pd, py2=cy+Math.sin(a)*pd;
      const pg=ctx.createRadialGradient(px2,py2,0,px2,py2,pr);
      pg.addColorStop(0,  `rgba(${rimR},${rimG},${rimB},${(0.12+ratio*0.12).toFixed(3)})`);
      pg.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle=pg;
      ctx.beginPath(); ctx.ellipse(px2,py2,pr*0.52,pr,a,0,Math.PI*2); ctx.fill();
    }

    // Core glow
    ctx.save(); ctx.globalCompositeOperation='screen';
    [3,2,1].forEach(i=>{
      const g=ctx.createRadialGradient(cx,cy,cR*0.5,cx,cy,cR*(1+i*0.68));
      g.addColorStop(0,`rgba(${rimR},${(148+dusk*28)|0},255,${(0.15/i).toFixed(3)})`);
      g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,cR*(1+i*0.68),0,Math.PI*2); ctx.fill();
    });
    ctx.restore();
    const cG=ctx.createRadialGradient(cx,cy,0,cx,cy,cR);
    cG.addColorStop(0,`rgba(248,${(225+dusk*22)|0},${(255-dusk*32)|0},0.70)`);
    cG.addColorStop(0.5,`rgba(${(162+dusk*42)|0},${(78-dusk*32)|0},255,0.32)`);
    cG.addColorStop(1,'rgba(90,36,210,0.04)');
    ctx.fillStyle=cG; ctx.beginPath(); ctx.arc(cx,cy,cR,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=`rgba(${rimR},${rimG},${rimB},${(0.38+ratio*0.42).toFixed(3)})`;
    ctx.lineWidth=1.6; ctx.beginPath(); ctx.arc(cx,cy,cR,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.90)';
    ctx.font=`${(U*0.040)|0}px -apple-system,sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(label,cx,cy);

    // Stardust
    for (let i=0;i<52;i++) {
      const s=i*137.508, a=s+t*(0.048+0.030*Math.sin(s*0.2));
      const d=U*(0.26+0.20*Math.abs(Math.sin(s*0.4)));
      const px2=cx+Math.cos(a)*d, py2=cy+Math.sin(a)*d*0.88;
      const al=(0.06+0.55*Math.abs(Math.sin(t*0.24+s))).toFixed(2);
      ctx.fillStyle=`rgba(${(222+dusk*30)|0},${(192-dusk*30)|0},255,${al})`;
      ctx.beginPath(); ctx.arc(px2,py2,0.5+1.8*Math.abs(Math.sin(s*0.3)),0,Math.PI*2); ctx.fill();
    }

    this._addFilmGrain(ctx,W,H,t,0.020);
  }

  // ── 睡眠前 — Warm Dusk / Bath (time-aware) ───────────────────────────────
  _drawPresleep() {
    const c=this.canvas, ctx=this.ctx;
    if(c.width!==c.clientWidth||c.height!==c.clientHeight){
      c.width=c.clientWidth; c.height=c.clientHeight;
      this._presleepMotes=null;
    }
    const W=c.width,H=c.height,t=this.t;
    const hr=this._getHour();
    const eve=Math.max(0,1-Math.abs(hr-20.5)/4.0);
    const warm=Math.max(0,1-Math.abs(hr-19.0)/3.5);

    // Near-total darkness — chiaroscuro void
    ctx.fillStyle=`rgb(${(4+warm*8)|0},${(2+warm*4)|0},${(6+warm*6)|0})`;
    ctx.fillRect(0,0,W,H);

    // Candle position
    const candleX=W*0.50, candleBaseY=H*0.72;
    const flicker=Math.sin(t*0.028)*0.6+Math.sin(t*0.051)*0.3+Math.sin(t*0.010)*0.1;

    // Volumetric candlelight — 1/r² physical falloff (5 layers)
    ctx.save(); ctx.globalCompositeOperation='screen';
    [[H*1.0,0.038+warm*0.018],[H*0.55,0.075+warm*0.030],[H*0.28,0.150+warm*0.050],[H*0.12,0.320],[H*0.045,0.600]].forEach(([r,a])=>{
      const rr=r*(1+flicker*0.06);
      const g=ctx.createRadialGradient(candleX,candleBaseY,0,candleX,candleBaseY,rr);
      g.addColorStop(0,  `rgba(255,${(170+warm*20)|0},${(50+warm*10)|0},${a.toFixed(3)})`);
      g.addColorStop(0.22,`rgba(220,${(110+warm*15)|0},25,${(a*0.40).toFixed(3)})`);
      g.addColorStop(0.55,`rgba(160,55,8,${(a*0.12).toFixed(3)})`);
      g.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    });
    ctx.restore();

    // Candle wax
    ctx.fillStyle='rgba(235,218,185,0.62)';
    ctx.fillRect(candleX-W*0.012,candleBaseY,W*0.024,H*0.14);
    // Wick
    ctx.strokeStyle='rgba(40,20,8,0.80)'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(candleX,candleBaseY); ctx.lineTo(candleX+flicker*1.5,candleBaseY-H*0.012); ctx.stroke();

    // Flame body (teardrop bezier)
    const fh=H*0.060*(1+flicker*0.16), fw=W*0.016*(1+Math.abs(flicker)*0.10);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(candleX,candleBaseY);
    ctx.bezierCurveTo(candleX+fw,candleBaseY-fh*0.32,candleX+fw*(0.85+flicker*0.12),candleBaseY-fh*0.72,candleX,candleBaseY-fh);
    ctx.bezierCurveTo(candleX-fw*(0.85+flicker*0.12),candleBaseY-fh*0.72,candleX-fw,candleBaseY-fh*0.32,candleX,candleBaseY);
    const fg=ctx.createLinearGradient(candleX,candleBaseY,candleX,candleBaseY-fh);
    fg.addColorStop(0,  'rgba(255,210,30,0.97)');
    fg.addColorStop(0.30,'rgba(255,140,15,0.90)');
    fg.addColorStop(0.68,'rgba(255,80,8,0.78)');
    fg.addColorStop(1,  'rgba(210,45,4,0.30)');
    ctx.fillStyle=fg; ctx.fill();
    ctx.restore();

    // Inner flame core (blue-white)
    const ifh=fh*0.30, ifw=fw*0.28;
    ctx.save(); ctx.globalCompositeOperation='screen';
    ctx.beginPath();
    ctx.moveTo(candleX,candleBaseY-fh*0.08);
    ctx.bezierCurveTo(candleX+ifw,candleBaseY-fh*0.20,candleX+ifw*0.8,candleBaseY-ifh*2.2,candleX,candleBaseY-ifh*2.8);
    ctx.bezierCurveTo(candleX-ifw*0.8,candleBaseY-ifh*2.2,candleX-ifw,candleBaseY-ifh*0.20,candleX,candleBaseY-fh*0.08);
    const icg=ctx.createLinearGradient(candleX,candleBaseY,candleX,candleBaseY-ifh*3);
    icg.addColorStop(0,'rgba(220,240,255,0.55)');
    icg.addColorStop(1,'rgba(180,210,255,0)');
    ctx.fillStyle=icg; ctx.fill();
    ctx.restore();

    // Steam wisps
    for (let w=0;w<4;w++) {
      const ph=t*0.010+w*1.57;
      const sx=W*(0.22+w*0.19)+Math.sin(ph*0.7)*W*0.04, baseY=H*0.86;
      const cp1x=sx+Math.sin(ph+0.5)*W*0.05, cp1y=baseY-H*0.22;
      const cp2x=sx+Math.sin(ph+1.2)*W*0.07, cp2y=baseY-H*0.48;
      const ex=sx+Math.sin(ph+0.3)*W*0.03, ey=baseY-H*0.72;
      for (let s=0;s<12;s++) {
        const tn=s/11, mt=1-tn;
        const bx=mt*mt*mt*sx+3*mt*mt*tn*cp1x+3*mt*tn*tn*cp2x+tn*tn*tn*ex;
        const by=mt*mt*mt*baseY+3*mt*mt*tn*cp1y+3*mt*tn*tn*cp2y+tn*tn*tn*ey;
        const rad=7+tn*20, al=0.028*(1-tn)*(0.7+0.3*Math.sin(ph*2.5));
        const sg=ctx.createRadialGradient(bx,by,0,bx,by,rad);
        sg.addColorStop(0,`rgba(215,175,142,${al})`); sg.addColorStop(1,'rgba(215,175,142,0)');
        ctx.fillStyle=sg; ctx.fillRect(bx-rad,by-rad,rad*2,rad*2);
      }
    }

    // Spark/mote particles caught in candlelight
    if (!this._presleepMotes) {
      this._presleepMotes=Array.from({length:36},()=>({
        x:0.3+Math.random()*0.4, y:0.4+Math.random()*0.5,
        r:0.5+Math.random()*1.6, vx:(Math.random()-0.5)*0.00006,
        vy:-(0.00003+Math.random()*0.00006), ph:Math.random()*Math.PI*2,
      }));
    }
    this._presleepMotes.forEach(m=>{
      m.x=(m.x+m.vx+1)%1; m.y+=m.vy;
      if(m.y<0.10){m.y=0.88;m.x=0.3+Math.random()*0.4;}
      // Brightness depends on proximity to candle
      const dx=(m.x-candleX/W)*W, dy=(m.y*H-candleBaseY);
      const dist=Math.sqrt(dx*dx+dy*dy);
      const prox=Math.max(0,1-dist/(H*0.45));
      const al=(0.15+0.22*Math.sin(t*0.014+m.ph))*prox;
      ctx.beginPath(); ctx.arc(m.x*W,m.y*H,m.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(240,172,90,${al.toFixed(3)})`; ctx.fill();
    });

    this._addFilmGrain(ctx,W,H,t,0.035);
    this.t++;
  }

  // ── 睡眠 — Aurora Night (time-aware) ─────────────────────────────────────
  _drawSleep() {
    const { ctx, canvas, t } = this;
    const W = canvas.width, H = canvas.height;
    const hr    = this._getHour();
    const night = Math.max(0, 1-Math.max(0,Math.sin((hr-6)/12*Math.PI)));
    const deep  = Math.max(0, 1-Math.abs(hr-0)/4);

    // True astronomical dark
    ctx.fillStyle=`rgb(1,${(4+deep*0)|0},${(10+deep*0)|0})`; ctx.fillRect(0,0,W,H);

    // Moon with atmospheric halo
    const moonX=W*0.72, moonY=H*0.18;
    ctx.save(); ctx.globalCompositeOperation='screen';
    [[H*0.32,0.035*night],[H*0.18,0.068*night],[H*0.08,0.130*night],[H*0.030,0.300*night]].forEach(([r,a])=>{
      const mg=ctx.createRadialGradient(moonX,moonY,0,moonX,moonY,r);
      mg.addColorStop(0,  `rgba(195,208,255,${a.toFixed(3)})`);
      mg.addColorStop(0.3,`rgba(160,180,255,${(a*0.35).toFixed(3)})`);
      mg.addColorStop(1,  'rgba(0,0,0,0)');
      ctx.fillStyle=mg; ctx.fillRect(0,0,W,H);
    });
    ctx.restore();
    ctx.fillStyle=`rgba(228,236,255,${(night*0.92).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(moonX,moonY,H*0.030,0,Math.PI*2); ctx.fill();
    // Crescent shadow
    ctx.fillStyle=`rgba(1,4,10,${(night*0.85).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(moonX-H*0.007,moonY-H*0.005,H*0.028,0,Math.PI*2); ctx.fill();

    // Milky Way diagonal band
    ctx.save(); ctx.globalCompositeOperation='screen';
    const mwAngle=0.38;
    for (let i=0;i<160;i++) {
      const s=i*131.1;
      const along=(i/160)*W*1.8-W*0.4;
      const across=(Math.sin(s*0.23)+1)/2*H*0.22-H*0.11;
      const mx=along*Math.cos(mwAngle)-across*Math.sin(mwAngle)+W*0.25;
      const my=along*Math.sin(mwAngle)+across*Math.cos(mwAngle)+H*0.05;
      if(mx<0||mx>W||my<0||my>H)continue;
      const br=night*(0.04+0.12*Math.abs(Math.sin(s*0.44)));
      const mwc=i%3===0?[220,210,255]:i%3===1?[255,240,220]:[200,215,255];
      ctx.fillStyle=`rgba(${mwc[0]},${mwc[1]},${mwc[2]},${br.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(mx,my,0.3+0.5*Math.abs(Math.sin(s*0.31)),0,Math.PI*2); ctx.fill();
    }
    ctx.restore();

    // Star field (120 stars)
    const starB=0.12+night*0.62;
    for (let i=0;i<120;i++) {
      const s=i*127.1;
      const sx=((Math.sin(s*0.11)+1)/2)*W, sy=((Math.sin(s*0.073)+1)/2)*H*0.85;
      const tw=starB*Math.abs(Math.sin(t*(0.0003+(i%7)*0.00005)*5000+s));
      const sr=0.3+1.0*Math.abs(Math.sin(s*0.31));
      if(tw<0.015)continue;
      ctx.fillStyle=`rgba(218,226,255,${tw.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2); ctx.fill();
      if(sr>0.85&&tw>0.42){
        ctx.strokeStyle=`rgba(218,226,255,${(tw*0.28).toFixed(3)})`;
        ctx.lineWidth=0.4;
        ctx.beginPath(); ctx.moveTo(sx-sr*3,sy); ctx.lineTo(sx+sr*3,sy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx,sy-sr*3); ctx.lineTo(sx,sy+sr*3); ctx.stroke();
      }
    }

    // Aurora curtains (vivid, impossible colors — the "surreal" element)
    const auroraA=0.14+night*0.20;
    ctx.save(); ctx.globalCompositeOperation='screen';
    [{xR:0.20,wR:0.36,spd:0.072,ph:0.0,rgb:[0,218,158],a:auroraA},
     {xR:0.52,wR:0.32,spd:0.058,ph:2.1,rgb:[55,108,235],a:auroraA*0.88},
     {xR:0.76,wR:0.26,spd:0.092,ph:4.4,rgb:[148,42,215],a:auroraA*0.68},
     {xR:0.38,wR:0.22,spd:0.108,ph:1.2,rgb:[0,185,118],a:auroraA*0.50},
    ].forEach(cu=>{
      const xC=(cu.xR+Math.sin(t*cu.spd+cu.ph)*0.07)*W, wW=cu.wR*W;
      const [r,g,b]=cu.rgb;
      ctx.beginPath();
      const S=50;
      for(let s=0;s<=S;s++){const y=(s/S)*H*0.86,wo=Math.sin(y/H*Math.PI*3.6+t*0.10+cu.ph)*wW*0.24;s===0?ctx.moveTo(xC-wW*0.5+wo,y):ctx.lineTo(xC-wW*0.5+wo,y);}
      for(let s=S;s>=0;s--){const y=(s/S)*H*0.86,wo=Math.sin(y/H*Math.PI*3.6+t*0.10+cu.ph)*wW*0.24;ctx.lineTo(xC+wW*0.5+wo,y);}
      ctx.closePath();
      const gr=ctx.createLinearGradient(0,0,0,H*0.86);
      gr.addColorStop(0,   `rgba(${r},${g},${b},0)`);
      gr.addColorStop(0.08,`rgba(${r},${g},${b},${cu.a.toFixed(3)})`);
      gr.addColorStop(0.60,`rgba(${r},${g},${b},${(cu.a*0.46).toFixed(3)})`);
      gr.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle=gr; ctx.fill();
    });
    ctx.restore();

    // Shooting stars
    if(!this._shootingStars)this._shootingStars=[];
    if(Math.random()<0.004&&this._shootingStars.length<3){
      this._shootingStars.push({x:Math.random()*W*0.65,y:Math.random()*H*0.28,vx:3.0+Math.random()*3.8,vy:1.3+Math.random()*2.0,life:0,maxLife:0.50+Math.random()*0.45});
    }
    this._shootingStars=this._shootingStars.filter(ss=>ss.life<ss.maxLife);
    this._shootingStars.forEach(ss=>{
      ss.life+=0.016; ss.x+=ss.vx; ss.y+=ss.vy;
      const prog=ss.life/ss.maxLife, al=Math.sin(prog*Math.PI)*0.88*night;
      const len=55+ss.vx*7;
      const grad=ctx.createLinearGradient(ss.x,ss.y,ss.x-ss.vx*len*0.11,ss.y-ss.vy*len*0.11);
      grad.addColorStop(0,`rgba(218,228,255,${al.toFixed(3)})`);
      grad.addColorStop(1,'rgba(218,228,255,0)');
      ctx.beginPath(); ctx.moveTo(ss.x,ss.y); ctx.lineTo(ss.x-ss.vx*len*0.11,ss.y-ss.vy*len*0.11);
      ctx.strokeStyle=grad; ctx.lineWidth=1.1; ctx.stroke();
      ctx.fillStyle=`rgba(240,246,255,${al.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(ss.x,ss.y,1.1,0,Math.PI*2); ctx.fill();
    });

    // Horizon glow
    const hor=ctx.createLinearGradient(0,H*0.80,0,H);
    hor.addColorStop(0,'rgba(0,0,0,0)');
    hor.addColorStop(1,`rgba(0,${(38+deep*18)|0},${(28+deep*14)|0},${(0.10+night*0.08).toFixed(3)})`);
    ctx.fillStyle=hor; ctx.fillRect(0,H*0.80,W,H*0.20);

    this._addFilmGrain(ctx,W,H,t,0.018);
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

    // ── Icon brightness: apply immediately, then every 60 s ──
    this._applyIconBrightness();
    this._iconBrightTimer = setInterval(() => this._applyIconBrightness(), 60_000);
    // Fetch geo → accurate sunrise/sunset (async, non-blocking)
    this._fetchWeather();

    // ── Resume AudioContext when returning from background (iOS/Android fix) ──
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.ac && this.ac.state === 'suspended') {
        this.ac.resume().catch(() => {});
      }
    });
    // Also resume on any user interaction (belt-and-suspenders for iOS)
    const resumeOnTouch = () => {
      if (this.ac && this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    };
    document.addEventListener('touchstart', resumeOnTouch, { passive: true });
    document.addEventListener('click',      resumeOnTouch, { passive: true });
  }
}

document.addEventListener('DOMContentLoaded', () => { new HealingApp(); });
