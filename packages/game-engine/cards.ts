import { randomInt } from 'node:crypto';
export type Card = string;
export const rankNames = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'];
export function deck(): Card[] {
  const cards = [...'23456789TJQKA'].flatMap(r => [...'cdhs'].map(s => r + s));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function five(cards: Card[]): number[] {
  const values = cards.map(c => '23456789TJQKA'.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  values.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  const groups = [...counts].sort((a,b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const distinct = [...counts.keys()];
  const straight = distinct.length === 5 ? (values[0] - values[4] === 4 ? values[0] : values.join(',') === '14,5,4,3,2' ? 5 : 0) : 0;
  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, ...groups.map(g => g[0])];
  if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...groups.map(g => g[0])];
  if (groups[0][1] === 2) return [1, ...groups.map(g => g[0])];
  return [0, ...values];
}
export function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}
export function evaluate(cards: Card[]): { score: number[]; name: string } {
  if (cards.length < 5 || cards.length > 7 || new Set(cards).size !== cards.length) throw new Error('牌数不正确');
  let score: number[] = [-1];
  for (let a=0;a<cards.length-4;a++) for(let b=a+1;b<cards.length-3;b++)
    for(let c=b+1;c<cards.length-2;c++) for(let d=c+1;d<cards.length-1;d++) for(let e=d+1;e<cards.length;e++) {
      const candidate = five([cards[a],cards[b],cards[c],cards[d],cards[e]]);
      if (compare(candidate, score) > 0) score = candidate;
    }
  return { score, name: score[0] === 8 && score[1] === 14 ? '皇家同花顺' : rankNames[score[0]] };
}
