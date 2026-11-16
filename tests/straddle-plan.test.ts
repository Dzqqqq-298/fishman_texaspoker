import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../apps/server/store';
import {Room} from '../apps/server/room';

function setup(n=6){
  const store=new Store(':memory:'),room=new Room(store);
  const users=Array.from({length:n},(_,i)=>store.createUser(`grab${i}`,`玩家${i}`,'Fixture-password-9527'));
  users.forEach(u=>room.online.add(u.id));
  const cmd=(id:number,type:string,data:Record<string,unknown>={})=>room.command(id,crypto.randomUUID(),room.state.version,type,data);
  cmd(users[0].id,'createRoom',{name:'抓位接力'});users.forEach(u=>cmd(u.id,'sit',{amount:2000}));
  const plan=()=>room.view(users[0].id).nextStraddle!;
  const choose=(id:number,enabled=true)=>{const p=plan(),offer=p.chain.find(c=>c.id===id)!;cmd(id,'straddle',{planKey:p.key,amount:offer.amount,enabled});};
  const fold=()=>{let guard=0;while(room.state.hand?.street!=='finished'){assert.ok(++guard<12);cmd(room.state.hand!.actor!,'action',{action:'fold'});}};
  return {store,room,users,cmd,plan,choose,fold};
}

test('next-hand Straddle advances 2/4/8BB in order, charges only on the next deal and never repeats automatically',()=>{
  const f=setup();try{
    f.cmd(f.users[0].id,'start');const hand=f.room.state.hand!,actor=hand.actor,deadline=f.room.state.deadline;
    const p=f.plan();assert.equal(p.button,1);assert.equal(p.chain[0].id,f.users[4].id);
    assert.throws(()=>f.cmd(f.users[5].id,'straddle',{planKey:p.key,amount:80,enabled:true}),/抓位已变化/);
    const balances=f.store.users().map(u=>u.balance),stacks=hand.players.map(p=>p.stack);
    f.choose(f.users[4].id);f.choose(f.users[5].id);f.choose(f.users[0].id);
    assert.deepEqual(f.plan().chain.map(c=>[c.amount,c.status]),[[40,'accepted'],[80,'accepted'],[160,'accepted']]);
    assert.equal(hand.actor,actor);assert.equal(f.room.state.deadline,deadline);
    assert.deepEqual(hand.players.map(p=>p.stack),stacks);assert.deepEqual(f.store.users().map(u=>u.balance),balances);
    assert.deepEqual(hand.straddles,[]);f.fold();f.cmd(f.users[0].id,'start');
    assert.deepEqual(f.room.state.hand!.straddles.map(c=>[c.id,c.amount]),[[f.users[4].id,40],[f.users[5].id,80],[f.users[0].id,160]]);
    assert.equal(f.room.state.hand!.currentBet,160);assert.equal(f.room.state.hand!.actor,f.users[1].id);
    assert.equal(f.plan().chain[0].status,'offer');f.fold();f.cmd(f.users[0].id,'start');assert.deepEqual(f.room.state.hand!.straddles,[]);
  }finally{f.store.db.close();}
});

test('canceling a link invalidates later consents; skip or no response stops the chain',()=>{
  const f=setup();try{
    const first=f.plan().chain[0].id;f.choose(first);const second=f.plan().chain[1].id;f.choose(second);
    const third=f.plan().chain[2].id;f.choose(third);f.choose(second,false);
    assert.deepEqual(f.plan().chain.map(p=>p.status),['accepted','declined']);
    assert.throws(()=>f.cmd(third,'straddle',{planKey:f.plan().key,amount:160,enabled:true}));
    f.choose(second);assert.equal(f.plan().chain[2].status,'offer');
    f.cmd(f.users[0].id,'start');assert.deepEqual(f.room.state.hand!.straddles.map(c=>c.amount),[40,80]);
  }finally{f.store.db.close();}
});

test('roster changes and brief disconnects invalidate the preview; stale amount or hand cannot reserve',()=>{
  const f=setup();try{
    const old=f.plan(),first=old.chain[0].id;f.choose(first);
    f.cmd(f.users[1].id,'away',{enabled:true});assert.notEqual(f.plan().key,old.key);
    assert.throws(()=>f.cmd(first,'straddle',{planKey:old.key,amount:40,enabled:true}));
    f.cmd(f.users[1].id,'away',{enabled:false});assert.equal(f.plan().chain[0].status,'offer');
    f.choose(first);f.room.online.delete(f.users[2].id);f.room.refreshStraddlePlan();
    f.room.online.add(f.users[2].id);f.room.refreshStraddlePlan();assert.equal(f.plan().chain[0].status,'offer');
    assert.throws(()=>f.cmd(first,'straddle',{planKey:f.plan().key,amount:80,enabled:true}));
    f.cmd(f.users[0].id,'start');assert.throws(()=>f.cmd(first,'straddle',{planKey:old.key,amount:40,enabled:true}));
  }finally{f.store.db.close();}
});

test('insufficient chips cancel that and later reservations; topping up does not silently restore consent',()=>{
  const f=setup();try{
    const first=f.plan().chain[0].id;f.choose(first);const second=f.plan().chain[1].id;f.choose(second);
    // Simulate a settled hand leaving this player short without changing seat order.
    f.room.state.seats.find(p=>p.id===second)!.stack=79;
    f.cmd(f.users[0].id,'chat',{text:'触发结算后的同步'});
    assert.equal(f.plan().chain[1].status,'insufficient');
    assert.throws(()=>f.choose(second),/筹码不足/);
    f.cmd(second,'topup',{amount:100});assert.equal(f.plan().chain[1].status,'offer');
    f.cmd(f.users[0].id,'start');assert.deepEqual(f.room.state.hand!.straddles.map(c=>c.amount),[40]);
  }finally{f.store.db.close();}
});

test('heads-up and disabled rooms offer no Straddle; first hand and three-handed button remain eligible',()=>{
  const f=setup(2);try{assert.equal(f.plan(),null);assert.throws(()=>f.cmd(f.users[0].id,'straddle',{enabled:true}));}finally{f.store.db.close();}
  const g=setup(3);try{
    assert.equal(g.plan().chain[0].id,g.users[0].id);g.choose(g.users[0].id);
    assert.equal(g.plan().chain.length,1);g.cmd(g.users[0].id,'settings',{straddleMax:0});assert.equal(g.plan(),null);
    g.cmd(g.users[0].id,'settings',{straddleMax:8});assert.equal(g.plan().chain[0].status,'offer');
    g.choose(g.users[0].id);g.cmd(g.users[0].id,'start');assert.deepEqual(g.room.state.hand!.straddles.map(c=>c.amount),[40]);
  }finally{g.store.db.close();}
});
