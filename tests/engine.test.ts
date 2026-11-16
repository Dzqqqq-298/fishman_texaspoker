import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Holdem } from '../packages/game-engine/holdem';
import { deck, evaluate, compare } from '../packages/game-engine/cards';
const players=(n:number,stack=2000)=>Array.from({length:n},(_,i)=>({id:i+1,name:`玩家${i+1}`,seat:i,stack}));
test('52 unique cards, wheel and royal flush, kickers',()=>{
  const d=deck();assert.equal(d.length,52);assert.equal(new Set(d).size,52);
  assert.deepEqual(evaluate('As 2h 3c 4d 5s 8s 9h'.split(' ')).score,[4,5]);
  assert.equal(evaluate('As Ks Qs Js Ts 2c 3d'.split(' ')).name,'皇家同花顺');
  assert.ok(compare(evaluate('As Ah Kc Qs 9h'.split(' ')).score,evaluate('Ac Ad Kd Jc 9s'.split(' ')).score)>0);
});
test('heads-up button is SB, acts first preflop and last postflop',()=>{
  const h=new Holdem(players(2),0);assert.equal(h.state.actor,1);assert.equal(h.state.players[0].bet,10);
  h.act(1,'call');h.act(2,'check');assert.equal(h.state.street,'flop');assert.equal(h.state.actor,2);
});
test('short all-in big blind does not force a pointless call of nominal BB',()=>{
  const p=players(2);p[1].stack=5;const h=new Holdem(p,0);
  assert.equal(h.state.street,'finished');assert.equal(h.state.players.reduce((n,p)=>n+p.stack,0),2005);
});
test('consecutive 2 / 4 / 8 BB straddles; first raise doubles final straddle',()=>{
  const h=new Holdem(players(6).map(p=>({...p,straddle:true})),0);
  assert.deepEqual(h.state.straddles.map(x=>x.amount),[40,80,160]);assert.equal(h.state.actor,1);
  assert.equal(h.legal(1)?.minTo,320);
  assert.throws(()=>h.act(1,'raise',200));
});
test('three-handed straddle stops before blinds; absent link ends chain',()=>{
  const h=new Holdem(players(3).map(p=>({...p,straddle:true})),0);assert.deepEqual(h.state.straddles.map(x=>x.amount),[40]);
  const h2=new Holdem(players(6).map(p=>({...p,straddle:p.id!==4})),0);assert.equal(h2.state.straddles.length,0);
});
test('short all-in does not reopen; cumulative short raises do reopen individually',()=>{
  const p=players(4);p[0].stack=130;p[1].stack=200;
  const h=new Holdem(p,0);h.act(4,'raise',100);h.act(1,'raise',130);
  assert.equal(h.state.minRaise,80);h.act(2,'raise',200);h.act(3,'call');
  assert.equal(h.state.actor,4);assert.equal(h.legal(4)?.canRaise,true);assert.equal(h.legal(4)?.minTo,280);
  const p2=players(3);p2[1].stack=130;const q=new Holdem(p2,0);
  q.act(1,'raise',100);q.act(2,'raise',130);q.act(3,'call');assert.equal(q.legal(1)?.canRaise,false);
});
test('side pots award only eligible players and refund unmatched contribution',()=>{
  const h=new Holdem(players(3),0);const s=h.state;
  s.street='river';s.board=['2c','3d','7h','8s','9c'];s.currentBet=0;s.pending=[1,2,3];s.actor=1;
  s.players.forEach((p,i)=>{p.cards=[['As','Ah'],['Ks','Kh'],['Qs','Qh']][i];p.bet=0;p.total=[100,300,400][i];p.stack=1000-p.total;p.actedAt=null;});
  h.act(1,'check');h.act(2,'check');h.act(3,'check');
  assert.deepEqual(s.pots,[{amount:300,winners:[1]},{amount:400,winners:[2,]},{amount:100,winners:[3],returned:true}]);
  assert.deepEqual(s.players.map(p=>p.stack),[1200,1100,700]);
});
test('other players hole cards and deck never appear in private view',()=>{
  const h=new Holdem(players(3),0),v=h.view(1);
  assert.equal(v.players[0].cards.length,2);assert.equal(v.players[1].cards.length,0);assert.ok(!('deck' in v));
  h.act(1,'fold');h.act(2,'fold');assert.equal(h.view(1).players[2].cards.length,0);
});
test('2 through 11 players: randomized legal actions conserve chips and terminate',()=>{
  let seed=9527;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let n=2;n<=11;n++)for(let run=0;run<25;run++){
    const h=new Holdem(players(n).map(p=>({...p,stack:20+Math.floor(random()*3000),straddle:random()<.5})),run%n);
    const total=h.state.players.reduce((sum,p)=>sum+p.stack+p.total,0);let actions=0;
    while(h.state.street!=='finished'){
      assert.ok(++actions<1000);const id=h.state.actor!,legal=h.legal(id)!;assert.ok(legal);
      const r=random();if(r<.14)h.act(id,'fold');else if(r<.38&&legal.canRaise)h.act(id,'raise',legal.maxTo);else h.act(id,legal.canCheck?'check':'call');
      assert.ok(h.state.players.every(p=>p.stack>=0));
    }
    assert.equal(h.state.players.reduce((sum,p)=>sum+p.stack,0),total);
  }
});
