import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../apps/server/store';
import {Room} from '../apps/server/room';
import {Holdem} from '../packages/game-engine/holdem';
import {planSeats,type DealSeat} from '../packages/game-engine/seating';

function fixture(n=6,seated=n){
  const store=new Store(':memory:'),room=new Room(store),users=Array.from({length:n},(_,i)=>store.createUser(`seat${i}`,`玩家${i}`,'Fixture-password-9527'));
  users.forEach(u=>room.online.add(u.id));
  const cmd=(i:number,type:string,data:Record<string,unknown>={})=>room.command(users[i].id,crypto.randomUUID(),room.state.version,type,data);
  cmd(0,'createRoom',{name:'盲注与换座',maxPlayers:11});for(let i=0;i<seated;i++)cmd(i,'sit',{seat:i,amount:2000});
  const finish=()=>{let guard=0;while(room.state.hand?.street!=='finished'){assert.ok(++guard<12);const id=room.state.hand!.actor!;room.command(id,crypto.randomUUID(),room.state.version,'action',{action:'fold'});}};
  const next=()=>{if(room.state.hand?.street!=='finished'&&room.state.hand)finish();cmd(0,'start');};
  const debt=(i:number)=>room.state.blindAccounts[users[i].id];
  const total=()=>store.users().reduce((s,u)=>s+u.balance,0)+room.state.seats.reduce((s,p)=>s+p.stack,0);
  return {store,room,users,cmd,finish,next,debt,total};
}

test('new player waits without cards or blind charges and enters on the actual BB; switching to post joins next deal',()=>{
  const f=fixture(6,4);try{
    f.next();f.finish();f.cmd(4,'sit',{seat:4,amount:2000});assert.equal(f.debt(4).mode,'wait');
    const stack=f.room.state.seats.find(p=>p.id===f.users[4].id)!.stack;
    f.next();assert.ok(!f.room.state.hand!.players.some(p=>p.id===f.users[4].id));assert.equal(f.room.state.seats.find(p=>p.id===f.users[4].id)!.stack,stack);
    f.finish();f.next();const p=f.room.state.hand!.players.find(p=>p.id===f.users[4].id)!;
    assert.equal(p.bet,20);assert.equal(p.action,'大盲');assert.equal(f.debt(4).mode,'ready');
    f.finish();f.cmd(5,'sit',{seat:8,amount:2000,entryMode:'post'});f.next();
    const posted=f.room.state.hand!.players.find(p=>p.id===f.users[5].id)!;assert.equal(posted.bet,20);assert.equal(posted.deadBlind,0);
    f.finish();assert.equal(f.total(),600000);
  }finally{f.store.db.close();}
});

test('missed BB/SB follow the account through leaving and moving; live BB and dead SB are charged once at deal',()=>{
  const f=fixture();try{
    f.next();f.finish();f.cmd(3,'away',{enabled:true});f.next();f.finish();assert.equal(f.debt(3).big,true);
    f.next();f.finish();assert.equal(f.debt(3).small,true);
    f.cmd(3,'leave');assert.equal(f.debt(3).small,true);f.cmd(3,'sit',{seat:8,amount:2000});
    const before=f.total(),stack=f.room.state.seats.find(p=>p.id===f.users[3].id)!.stack;
    f.cmd(3,'moveSeat',{seat:3,entryMode:'post'});assert.equal(f.total(),before);assert.equal(f.room.state.seats.find(p=>p.id===f.users[3].id)!.stack,stack);
    assert.equal(f.debt(3).small,true);assert.equal(f.debt(3).big,true);
    f.next();const p=f.room.state.hand!.players.find(p=>p.id===f.users[3].id)!;
    assert.equal(p.bet,20);assert.equal(p.total,20);assert.equal(p.deadBlind,10);assert.equal(p.stack,1970);
    assert.equal(f.debt(3).mode,'ready');assert.equal(f.debt(3).small,false);f.finish();assert.equal(f.total(),before);
    const history=f.store.handHistory(f.room.state.match!.id)[0];assert.equal(history.players.reduce((s,p)=>s+p.profit,0),0);
    f.next();assert.equal(f.room.state.hand!.players.find(p=>p.id===f.users[3].id)!.deadBlind,0);
  }finally{f.store.db.close();}
});

test('waiting through to a natural BB clears missed blinds without charging dead money; offline misses persist on restart',()=>{
  const f=fixture();try{
    f.next();f.finish();f.room.online.delete(f.users[3].id);f.room.refreshStraddlePlan();
    f.next();f.finish();f.next();f.finish();assert.ok(f.debt(3).big&&f.debt(3).small);
    const restored=new Room(f.store);assert.ok(restored.state.blindAccounts[f.users[3].id].small);
    f.room.online.add(f.users[3].id);f.room.refreshStraddlePlan();f.cmd(3,'entry',{entryMode:'wait'});
    let admitted=false;for(let i=0;i<12;i++){
      f.next();const p=f.room.state.hand!.players.find(p=>p.id===f.users[3].id);
      if(p){assert.equal(p.action,'大盲');assert.equal(p.deadBlind,0);assert.equal(f.debt(3).small,false);admitted=true;break;}
      f.finish();
    }
    assert.ok(admitted);
  }finally{f.store.db.close();}
});

test('three to two players still records the absent next BB when the moving button repeats the actual blinds',()=>{
  const f=fixture(3);try{
    f.next();f.finish();f.cmd(0,'away',{enabled:true});f.next();
    assert.equal(f.debt(0).big,true);assert.equal(f.debt(0).small,false);
    f.finish();f.cmd(0,'away',{enabled:false});assert.equal(f.debt(0).mode,'wait');
  }finally{f.store.db.close();}
});

test('move is atomic, keeps chips, rejects occupied/current-hand/stale seats and invalidates Straddle reservations',()=>{
  const f=fixture();try{
    const plan=f.room.view(f.users[0].id).nextStraddle!,first=plan.chain[0];
    f.room.command(first.id,crypto.randomUUID(),f.room.state.version,'straddle',{planKey:plan.key,amount:first.amount,enabled:true});
    const stack=f.room.state.seats[0].stack,balance=f.store.user(f.users[0].id)!.balance,version=f.room.state.version;
    assert.throws(()=>f.cmd(0,'moveSeat',{seat:1}),/已有人/);assert.throws(()=>f.cmd(0,'moveSeat',{seat:11}),/编号/);
    f.cmd(0,'moveSeat',{seat:9});assert.equal(f.room.state.seats[0].stack,stack);assert.equal(f.store.user(f.users[0].id)!.balance,balance);
    assert.equal(f.debt(0).mode,'ready');assert.ok(f.room.view(f.users[0].id).nextStraddle!.chain.every(p=>p.status!=='accepted'));
    assert.throws(()=>f.room.command(f.users[1].id,crypto.randomUUID(),version,'moveSeat',{seat:9}));
    assert.throws(()=>f.room.command(first.id,crypto.randomUUID(),f.room.state.version,'straddle',{planKey:plan.key,amount:first.amount,enabled:true}));
    f.next();assert.throws(()=>f.cmd(0,'moveSeat',{seat:8}),/本手结束/);f.finish();
    f.cmd(0,'moveSeat',{seat:8,entryMode:'post'});const next=f.room.view(f.users[0].id).nextStraddle;
    f.next();const h=f.room.state.hand!;assert.equal(h.button,f.room.state.button);
    if(next){const ps=h.players,i=ps.findIndex(p=>p.seat===h.button);assert.equal(next.chain[0].id,ps[(i+3)%ps.length].id);}
    assert.ok(f.room.state.hand!.players.some(p=>p.id===f.users[0].id));
  }finally{f.store.db.close();}
});

test('waiting planner admits every waiting seat within a rotation and never deals a waiting player as SB or button',()=>{
  for(let waiting=0;waiting<11;waiting++){
    const slots=[0,2,5,8].filter(s=>s!==waiting);
    const seats:DealSeat[]=[...slots.map(seat=>({id:seat+1,seat,stack:2000,sittingOut:false,online:true,blind:{mode:'ready' as const,small:false,big:false,lastSeat:seat}})),{id:99,seat:waiting,stack:2000,sittingOut:false,online:true,blind:{mode:'wait',small:false,big:true,lastSeat:waiting}}];
    let button=-1,found=false;
    for(let i=0;i<12;i++){const plan=planSeats(seats,button,20,10)!;assert.ok(plan);button=plan.button;if(plan.entries.some(p=>p.id===99)){assert.equal(plan.big.id,99);assert.notEqual(plan.small.id,99);found=true;break;}}
    assert.ok(found,`waiting seat ${waiting} starved`);
  }
  const waiters:DealSeat[]=Array.from({length:2},(_,seat)=>({id:seat+1,seat,stack:2000,sittingOut:false,online:true,blind:{mode:'wait',small:false,big:true,lastSeat:seat}}));
  assert.equal(planSeats(waiters,0,20,10),null);waiters[0].blind.mode='post';assert.ok(planSeats(waiters,0,20,10));
});

test('dead SB does not cover calls or side pots, double runouts conserve chips, and posted BB is not charged twice with Straddle',()=>{
  const entries=[{id:1,name:'A',seat:0,stack:101,postBlind:{live:20,dead:10}},{id:2,name:'B',seat:1,stack:200},{id:3,name:'C',seat:2,stack:200}];
  const h=new Holdem(entries,0);assert.equal(h.legal(1)!.toCall,0);assert.equal(h.state.players[0].total,20);assert.equal(h.state.players[0].deadBlind,10);
  while(h.state.street!=='finished'){const id=h.state.actor!,legal=h.legal(id)!;h.act(id,legal.canRaise?'raise':legal.canCheck?'check':'call',legal.canRaise?legal.maxTo:undefined);}
  assert.deepEqual(h.state.pots.map(p=>p.amount),[283,218]);assert.equal(h.state.players.reduce((s,p)=>s+p.stack,0),501);
  const straddle=new Holdem([...entries,{id:4,name:'D',seat:3,stack:2000,straddle:true,postBlind:{live:20,dead:10}}],0);
  const p=straddle.state.players[3];assert.equal(p.bet,40);assert.equal(p.stack,1950);assert.equal(p.total,40);
  const two=new Holdem([{id:1,name:'A',seat:0,stack:101,postBlind:{live:20,dead:10}},{id:2,name:'B',seat:1,stack:200}],0,10,20,0,crypto.randomUUID(),2);
  while(two.state.street!=='runout'){const id=two.state.actor!,l=two.legal(id)!;two.act(id,l.canRaise?'raise':l.canCheck?'check':'call',l.canRaise?l.maxTo:undefined);}
  two.voteRunout(1,2);two.voteRunout(2,2);assert.equal(two.state.pots.reduce((s,p)=>s+p.amount,0),192);assert.equal(two.state.players.reduce((s,p)=>s+p.stack,0),301);
});
