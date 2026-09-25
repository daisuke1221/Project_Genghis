// 手続き生成の肖像（SVG）。文化ごとの髪型・かぶり物で描き分ける
function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

const SKIN = ['#f3d6b8', '#e8c39e', '#d9ae84', '#c89870', '#b07d58'];
const HAIR = ['#1b1512', '#2b1d14', '#3d2817', '#5a3a1e', '#8a5a2b', '#b8893e'];
const SKIN_BY = { european: [0, 1], slavic: [0, 1], greek: [1, 2], georgian: [1, 2], islamic: [2, 3], indian: [3, 4], mongol: [1, 2], turkic: [1, 2], chinese: [0, 1], korean: [0, 1], japanese: [0, 1], tibetan: [2, 3] };

export function portrait(person, culture, color = '#8a2b2b', size = 64, child = false) {
  const h = hash(person.id + person.name);
  const [s0, s1] = SKIN_BY[culture] ?? [1, 2];
  const skin = SKIN[s0 + (h % (s1 - s0 + 1))];
  const western = ['european', 'slavic', 'greek', 'georgian'].includes(culture);
  const hair = western ? HAIR[(h >> 3) % HAIR.length] : HAIR[(h >> 3) % 3];
  const eyeY = 38, faceRy = child ? 13 : 15;
  const smile = (h >> 5) % 2 ? 'M28 49 Q32 52 36 49' : 'M29 49 Q32 50.5 35 49';
  let back = '', front = '';
  switch (culture) {
    case 'mongol': case 'turkic':
      // 高い冠（ボクタ）
      back = `<path d="M17 36 Q16 20 32 18 Q48 20 47 36 Z" fill="${hair}"/>`;
      front = child ? `<rect x="22" y="15" width="20" height="8" rx="3" fill="${color}"/>` :
        `<path d="M24 22 L27 2 L37 2 L40 22 Z" fill="${color}"/><rect x="26" y="0" width="12" height="4" rx="1" fill="#e0b440"/>
         <path d="M32 0 Q36 -6 41 -2" stroke="#3a6ea8" stroke-width="2" fill="none"/><rect x="20" y="20" width="24" height="5" rx="2" fill="#e0b440"/>
         <circle cx="18" cy="44" r="2.5" fill="#d9534f"/><circle cx="46" cy="44" r="2.5" fill="#d9534f"/>`;
      break;
    case 'chinese': case 'korean':
      back = `<path d="M16 40 Q14 20 32 17 Q50 20 48 40 Z" fill="${hair}"/>`;
      front = `<ellipse cx="32" cy="15" rx="10" ry="7" fill="${hair}"/>
        ${child ? '' : '<line x1="20" y1="10" x2="44" y2="18" stroke="#e0b440" stroke-width="2"/><circle cx="44" cy="18" r="2.5" fill="#d9534f"/><path d="M24 12 L20 6" stroke="#e0b440" stroke-width="1.5"/>'}`;
      break;
    case 'japanese':
      back = `<path d="M15 64 Q12 22 32 18 Q52 22 49 64 Z" fill="${hair}"/>`;
      front = `<path d="M18 34 Q20 20 32 20 Q44 20 46 34 Q40 26 32 27 Q24 26 18 34 Z" fill="${hair}"/>`;
      break;
    case 'tibetan':
      back = `<path d="M16 50 Q14 20 32 18 Q50 20 48 50 Z" fill="${hair}"/>`;
      front = `<rect x="20" y="17" width="24" height="6" rx="3" fill="#c0392b"/><circle cx="26" cy="20" r="2" fill="#3fb5a0"/><circle cx="32" cy="20" r="2" fill="#e0b440"/><circle cx="38" cy="20" r="2" fill="#3fb5a0"/>`;
      break;
    case 'islamic': case 'indian':
      back = `<path d="M12 62 Q10 16 32 14 Q54 16 52 62 Z" fill="${color}"/>`;
      front = `<path d="M16 40 Q16 20 32 19 Q48 20 48 40 Q44 26 32 25 Q20 26 16 40 Z" fill="${color}" opacity="0.95"/>
        ${culture === 'indian' ? '<circle cx="32" cy="31" r="1.6" fill="#c0392b"/>' : '<path d="M20 22 Q32 17 44 22" stroke="#e0b440" stroke-width="1.5" fill="none"/>'}`;
      break;
    default:
      back = `<path d="M14 58 Q10 18 32 16 Q54 18 50 58 Z" fill="${child ? hair : '#f2efe6'}"/>`;
      front = `<path d="M18 34 Q20 22 32 21 Q44 22 46 34 Q40 27 32 28 Q24 27 18 34 Z" fill="${hair}"/>
        ${child ? '' : '<path d="M19 22 L23 15 L27 20 L32 13 L37 20 L41 15 L45 22 Z" fill="#e0b440"/>'}`;
  }
  return `<svg class="portrait" width="${size}" height="${size * 1.125}" viewBox="0 -4 64 72" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="-4" width="64" height="72" rx="6" fill="#2a2016"/>
    ${back}
    <path d="M8 68 Q10 54 32 53 Q54 54 56 68 Z" fill="${color}"/>
    <path d="M26 53 L32 60 L38 53" fill="none" stroke="#e0b440" stroke-width="1.5"/>
    <rect x="28" y="46" width="8" height="8" fill="${skin}"/>
    <ellipse cx="32" cy="38" rx="12" ry="${faceRy}" fill="${skin}"/>
    <path d="M25 ${eyeY - 3} Q27 ${eyeY - 4} 29 ${eyeY - 3}" stroke="${hair}" stroke-width="1" fill="none"/>
    <path d="M35 ${eyeY - 3} Q37 ${eyeY - 4} 39 ${eyeY - 3}" stroke="${hair}" stroke-width="1" fill="none"/>
    <ellipse cx="27" cy="${eyeY}" rx="1.6" ry="${(h >> 7) % 2 ? 1.4 : 1}" fill="#1b1512"/>
    <ellipse cx="37" cy="${eyeY}" rx="1.6" ry="${(h >> 7) % 2 ? 1.4 : 1}" fill="#1b1512"/>
    <circle cx="24" cy="44" r="2.5" fill="#e88" opacity="0.35"/><circle cx="40" cy="44" r="2.5" fill="#e88" opacity="0.35"/>
    <path d="${smile}" stroke="#a0463c" stroke-width="1.3" fill="none"/>
    ${front}
  </svg>`;
}
