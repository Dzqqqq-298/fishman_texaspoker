import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Holdem} from '../packages/game-engine/holdem';
import {Room} from '../apps/server/room';
import {Store} from '../apps/server/store';

const entrants=(n:number)=>Array.from({length:n},(_,i)=>({id:i+1,name:`朋友${i+1}`,seat:i,stack:2000}));
function allIn(h:Holdem){let guard=0;while(h.state.street!=='runout'&&h.state.street!=='finished'){assert.ok(++guard<20);const id=h.state.actor!,legal=h.legal(id)!;h.act(id,legal.canRaise?'raise':legal.canCheck?'check':'call',legal.canRaise?legal.maxTo:undefined);}}
test('heads-up RIT requires both votes; shared flop, distinct remaining cards and chip conservation',()=>{
  const h=new Holdem(entrants(2),0,10,20,0,crypto.randomUUID(),2);
  h.act(1,'call');h.act(2,'check');const flop=[...h.state.board];allIn(h);
  assert.equal(h.state.street,'runout');assert.equal(h.state.actor,null);
  assert.ok(h.view(999).players.every(p=>p.cards.length===2));assert.throws(()=>h.voteRunout(999,2));
  h.voteRunout(1,2);assert.equal(h.state.street,'runout');assert.throws(()=>h.voteRunout(1,2));
  h.voteRunout(2,2);assert.equal(h.state.street,'finished');assert.equal(h.state.boards.length,2);
  assert.deepEqual(h.state.boards[0].slice(0,3),flop);assert.deepEqual(h.state.boards[1].slice(0,3),flop);
  const cards=[...h.state.players.flatMap(p=>p.cards),...flop,...h.state.boards.flatMap(b=>b.slice(3))];
  assert.equal(new Set(cards).size,cards.length);assert.equal(h.state.players.reduce((n,p)=>n+p.stack,0),4000);
  assert.equal(h.state.pots.reduce((n,p)=>n+p.amount,0),4000);
});
test('a rejection runs once; 3-way all-in and river all-in never offer twice',()=>{
  const h=new Holdem(entrants(2),0,10,20,0,crypto.randomUUID(),2);allIn(h);h.voteRunout(1,1);
  assert.equal(h.state.boards.length,1);assert.throws(()=>h.voteRunout(2,2));
  const multi=new Holdem(entrants(3),0,10,20,0,crypto.randomUUID(),2);allIn(multi);
  assert.equal(multi.state.street,'finished');assert.equal(multi.state.boards.length,1);
  assert.equal(multi.state.players.reduce((n,p)=>n+p.stack,0),6000);
  const river=new Holdem(entrants(2),0,10,20,0,crypto.randomUUID(),2);
  while(river.state.street!=='river'){const id=river.state.actor!,l=river.legal(id)!;river.act(id,l.canCheck?'check':'call');}
  allIn(river);assert.equal(river.state.street,'finished');assert.equal(river.state.runout,null);
});
test('two boards split each pot separately with odd chip to first board and correct uncalled returns',()=>{
  const h=new Holdem(entrants(3),0,10,20,0,crypto.randomUUID(),2),s=h.state;
  s.players.forEach((p,i)=>{p.total=i?101:1;p.stack=i?0:1999;p.folded=i===0;p.allIn=i!==0;p.cards=[['Qs','Qh'],['As','Ah'],['Kc','Ks']][i];});
  s.board=[];s.pending=[];s.actor=null;s.street='runout';s.runout={eligible:[2,3],votes:{2:2,3:2}};
  s.deck=['Tc','2c','3d','7h','Jc','8s','Qc','9c','Td','Kh','2d','3h','Jd','7s','Qd','9h'].reverse();
  h.completeRunout(2);
  assert.deepEqual(s.pots.map(p=>p.amount),[2,1,100,100]);
  assert.equal(s.players[1].stack,102);assert.equal(s.players[2].stack,101);
  assert.equal(s.players.reduce((n,p)=>n+p.stack,0),2202);
  const unequal=entrants(2);unequal[0].stack=101;unequal[1].stack=100;
  const q=new Holdem(unequal,0,1,2,0,crypto.randomUUID(),2);allIn(q);q.voteRunout(1,2);q.voteRunout(2,2);
  assert.equal(q.state.pots.filter(p=>p.returned).reduce((n,p)=>n+p.amount,0),1);
  assert.equal(q.state.players.reduce((n,p)=>n+p.stack,0),201);
});
test('normal showdown reveals first player and winners, mucks losing followers; optional reveal is cumulative',()=>{
  const h=new Holdem(entrants(3),0),s=h.state;
  s.street='river';s.board=['2c','3d','7h','8s','9c'];s.currentBet=0;s.pending=[2,3,1];s.actor=2;s.lastAggressor=null;
  s.players.forEach((p,i)=>{p.cards=[['As','Ah'],['Ks','Kh'],['Qs','Qh']][i];p.bet=0;p.total=100;p.stack=1900;});
  assert.throws(()=>h.showCards(1,[0]),/结束/);h.act(2,'check');h.act(3,'check');h.act(1,'check');
  const observer=h.view(999);assert.equal(observer.players[0].cards.length,2);assert.equal(observer.players[1].cards.length,2);assert.equal(observer.players[2].cards.length,0);assert.equal(observer.players[2].handName,null);
  h.showCards(3,[1]);assert.deepEqual(h.view(999).players[2].publicCards,[null,'Qh']);h.showCards(3,[0]);assert.deepEqual(h.view(999).players[2].publicCards,['Qs','Qh']);
  assert.throws(()=>h.showCards(999,[0]));assert.throws(()=>h.showCards(3,[2]));
});
function fixture(n=2){const store=new Store(':memory:');const users=Array.from({length:n},(_,i)=>store.createUser(`friend${i}`,`朋友${i}`,'Fixture-password-9527'));const room=new Room(store);users.forEach(u=>room.online.add(u.id));const cmd=(i:number,type:string,data:Record<string,unknown>={})=>room.command(users[i].id,crypto.randomUUID(),room.state.version,type,data);cmd(0,'createRoom',{name:'功能测试',maxRunouts:2});users.forEach((_,i)=>cmd(i,'sit',{amount:2000}));return {store,users,room,cmd};}
test('chat enforces all-in mute on server, stays version-neutral and does not expose cards before betting closes',()=>{
  const f=fixture(3);try{
    f.cmd(0,'start');const h=f.room.state.hand!,actor=h.actor!,index=f.users.findIndex(u=>u.id===actor);
    f.cmd(index,'action',{action:'raise',amount:Holdem.restore(h).legal(actor)!.maxTo});
    assert.throws(()=>f.cmd(index,'chat',{text:'不能发'}),/禁言/);assert.equal(f.room.view(actor).chatBlocked,true);
    const other=(index+1)%3;const v=f.room.state.version;f.cmd(other,'chat',{text:'收到'});assert.equal(f.room.state.version,v);
    assert.equal(f.room.state.chat.length,1);assert.ok(f.room.view(f.users[other].id).hand!.players.filter(p=>p.id!==f.users[other].id).every(p=>p.cards.length===0));
    assert.throws(()=>f.cmd(other,'chat',{text:'刷屏'}),/太快/);
    assert.throws(()=>f.cmd(index,'showCards',{handId:h.id,indices:[0]}));
  }finally{f.store.db.close();}
});
test('RIT timeout resolves once, manual ending waits, and restart preserves votes',()=>{
  const f=fixture();try{
    f.cmd(0,'start');f.cmd(0,'action',{action:'raise',amount:2000});f.cmd(1,'action',{action:'call'});
    assert.equal(f.room.state.hand?.street,'runout');const handId=f.room.state.hand!.id;
    f.cmd(0,'runoutVote',{handId,count:2});f.cmd(0,'endRoom');assert.ok(f.room.state.match);
    const restored=new Room(f.store);assert.ok(restored.state.pausedForRecovery);assert.equal(restored.state.hand?.runout?.votes[f.users[0].id],2);
    restored.command(f.users[0].id,crypto.randomUUID(),restored.state.version,'start');
    restored.tick(restored.state.deadline+1);assert.equal(restored.state.match,null);
    const history=f.store.handHistory(f.store.recentMatches()[0].id);assert.equal(history.length,1);assert.equal(history[0].boards.length,1);
    assert.equal(f.store.users().reduce((n,u)=>n+u.balance,0),200000);
    restored.tick();assert.equal(f.store.recentMatches().length,1);
  }finally{f.store.db.close();}
});
test('history only stores public hole cards; last-hand voluntary showing works after room closes and expires',()=>{
  const f=fixture();try{
    f.cmd(0,'start');const id=f.room.state.hand!.id,matchId=f.room.state.match!.id,own=[...f.room.state.hand!.players[0].cards];
    f.cmd(0,'action',{action:'fold'});f.cmd(0,'endRoom');assert.equal(f.room.state.match,null);
    assert.ok(f.store.handHistory(matchId)[0].players.every(p=>p.publicCards.every(c=>c===null)));
    const raw=String((f.store.db.prepare('SELECT summary FROM hands WHERE id=?').get(id) as {summary:string}).summary);
    assert.ok(!raw.includes('"deck"'));assert.ok(!raw.includes('"cards"'));assert.ok(!raw.includes(own[0]));
    f.cmd(0,'showCards',{handId:id,indices:[0]});const history=f.store.handHistory(matchId)[0];assert.deepEqual(history.players[0].publicCards,[own[0],null]);
    assert.equal(history.players.reduce((n,p)=>n+p.profit,0),0);
    assert.equal(f.room.view(f.users[1].id).lastCompleted?.hand.players[0].cards.length,1);
    f.room.state.lastCompleted!.expiresAt=Date.now()-1;assert.throws(()=>f.cmd(0,'showCards',{handId:id,indices:[1]}),/时间已结束/);
    assert.deepEqual(f.store.handHistory(matchId)[0].players[0].publicCards,[own[0],null]);
  }finally{f.store.db.close();}
});
test('25-second no-action checks when free, folds when facing bet, and two timeouts sit out next hand',()=>{
  const f=fixture();try{
    f.cmd(0,'start');f.room.tick(f.room.state.deadline+1);assert.equal(f.room.state.hand?.players[0].folded,true);
    f.cmd(0,'start'); // button moves; player 0 is now the big blind.
    f.cmd(1,'action',{action:'call'});assert.equal(f.room.state.hand?.actor,f.users[0].id);
    f.room.tick(f.room.state.deadline+1);assert.equal(f.room.state.hand?.players[0].folded,false);
    assert.equal(f.room.state.seats.find(p=>p.id===f.users[0].id)?.sittingOut,true);
    assert.ok(f.room.state.hand?.log.some(l=>l.includes('过牌')));
  }finally{f.store.db.close();}
});
