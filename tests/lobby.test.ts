import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../apps/server/store';
import { Room } from '../apps/server/room';

function fixture(n=3) {
  const store=new Store(':memory:');
  const users=Array.from({length:n},(_,i)=>store.createUser(`friend${i}`,`朋友${i}`,'Fixture-password-9527'));
  const room=new Room(store);users.forEach(u=>room.online.add(u.id));
  const cmd=(i:number,type:string,data:Record<string,unknown>={})=>room.command(users[i].id,crypto.randomUUID(),room.state.version,type,data);
  const create=(data:Record<string,unknown>={})=>cmd(0,'createRoom',{name:'周末好友局',...data});
  const sit=(i:number,amount=2000)=>cmd(i,'sit',{amount});
  const foldHand=()=>{
    let actions=0;
    while(room.state.hand&&room.state.hand.street!=='finished') {
      assert.ok(++actions<15);
      const id=room.state.hand.actor!;room.command(id,crypto.randomUUID(),room.state.version,'action',{action:'fold'});
    }
  };
  return {store,users,room,cmd,create,sit,foldHand};
}

test('lobby starts empty; concurrent creation only permits one room and assigns creator as host',()=>{
  const f=fixture();try {
    assert.equal(f.room.view(f.users[0].id).phase,'empty');assert.throws(()=>f.sit(0),/先在大厅创建/);
    const version=f.room.state.version;f.create();
    assert.throws(()=>f.room.command(f.users[1].id,crypto.randomUUID(),version,'createRoom',{name:'抢建的房间'}));
    assert.throws(()=>f.cmd(1,'createRoom',{name:'第二个房间'}),/已有房间/);
    assert.equal(f.room.state.match?.name,'周末好友局');assert.equal(f.room.state.hostId,f.users[0].id);
    f.sit(1);assert.equal(f.room.state.hostId,f.users[0].id);assert.equal(f.room.state.match?.startedAt,null);
    assert.ok(f.store.users().every(u=>u.balance>=98000));
  } finally {f.store.db.close();}
});

test('invalid rules roll back; seat limits, buy-in limits and creator authority are enforced',()=>{
  const f=fixture();try {
    assert.throws(()=>f.create({durationMinutes:-1}));assert.equal(f.room.state.match,null);
    assert.throws(()=>f.create({minBuyIn:3000,defaultBuyIn:2000}));assert.equal(f.room.state.match,null);
    f.create({maxPlayers:2,maxBuyIn:4000});assert.throws(()=>f.sit(1,1000),/带入范围/);
    f.sit(1);f.sit(2);assert.throws(()=>f.sit(0),/座位已满/);
    assert.throws(()=>f.cmd(1,'start'),/房主/);assert.throws(()=>f.cmd(1,'endRoom'),/房主/);
    f.cmd(0,'start');assert.equal(f.room.view(f.users[0].id).phase,'running');
    f.foldHand();assert.throws(()=>f.cmd(0,'settings',{smallBlind:5,bigBlind:10}),/规则锁定/);
    assert.throws(()=>f.cmd(1,'topup',{amount:5000}),/不能超过/);
  } finally {f.store.db.close();}
});

test('wall-clock duration begins with first successful start, remains through pauses and closes between hands',()=>{
  const f=fixture(2);try {
    f.create({durationMinutes:60});assert.equal(f.room.state.match?.endsAt,null);
    assert.throws(()=>f.cmd(0,'start'),/至少需要两名/);assert.equal(f.room.state.match?.startedAt,null);
    f.sit(0);f.sit(1);f.cmd(0,'start');const endsAt=f.room.state.match!.endsAt!;
    assert.equal(endsAt-f.room.state.match!.startedAt!,3600000);
    f.cmd(0,'pause');f.foldHand();assert.equal(f.room.state.match?.endsAt,endsAt);
    f.cmd(0,'start');assert.equal(f.room.state.match?.endsAt,endsAt);f.cmd(0,'pause');f.foldHand();
    f.room.state.match!.endsAt=Date.now()-1;f.room.tick();
    assert.equal(f.room.state.match,null);assert.equal(f.store.recentMatches()[0].reason,'比赛时长到期');
    assert.equal(f.store.users().reduce((sum,u)=>sum+u.balance,0),200000);
  } finally {f.store.db.close();}
});

test('expiry during a hand keeps cards and actor, defers payouts, and prevents another deal',()=>{
  const f=fixture(2);try {
    f.create({durationMinutes:30});f.sit(0);f.sit(1);f.cmd(0,'start');
    const before=structuredClone(f.room.state.hand);f.room.state.match!.endsAt=Date.now()-1;f.room.tick();
    assert.equal(f.room.view(f.users[0].id).phase,'ending');assert.deepEqual(f.room.state.hand,before);
    assert.equal(f.store.recentMatches().length,0);assert.throws(()=>f.cmd(0,'topup',{amount:2000}),/收尾/);
    f.foldHand();assert.equal(f.room.state.match,null);assert.equal(f.room.state.running,false);
    f.room.tick(Date.now()+10000);assert.equal(f.room.state.hand,null);
    assert.equal(f.store.recentMatches().length,1);
  } finally {f.store.db.close();}
});

test('manual closing resolves squid, refunds once, saves profit including leavers, and allows a new room',()=>{
  const f=fixture(3);try {
    f.create({durationMinutes:0,squidEnabled:true});f.sit(0);f.sit(1);f.sit(2);f.cmd(0,'topup',{amount:2000});
    f.cmd(0,'start');const key=crypto.randomUUID(),v=f.room.state.version;
    f.room.command(f.users[0].id,key,v,'endRoom');assert.ok(f.room.state.match?.endRequested);
    assert.throws(()=>f.cmd(1,'createRoom',{name:'占位'}));f.foldHand();
    f.room.command(f.users[0].id,key,v,'endRoom');
    assert.equal(f.store.recentMatches().length,1);const result=f.store.recentMatches()[0];
    assert.equal(result.handCount,1);assert.equal(result.players.reduce((n,p)=>n+p.profit,0),0);
    assert.equal(result.players.find(p=>p.id===f.users[0].id)?.buyIn,4000);
    assert.equal(f.store.users().reduce((n,u)=>n+u.balance,0),300000);assert.equal(f.room.state.squid,null);
    assert.equal(f.room.state.seats.length,0);f.create({name:'下一场'});assert.equal(f.room.state.match?.handCount,0);
    f.sit(0);f.cmd(0,'leave');assert.equal(f.room.state.hostId,f.users[0].id);f.cmd(0,'endRoom');
    const second=f.store.recentMatches()[0];assert.equal(second.players[0].cashOut,2000);assert.equal(second.players[0].profit,0);
  } finally {f.store.db.close();}
});

test('top-up and late joining policies enforce room settings',()=>{
  const f=fixture();try {
    f.create({allowTopup:false,allowLateJoin:false});f.sit(0);f.sit(1);
    assert.throws(()=>f.cmd(0,'topup',{amount:100}),/不允许追加/);
    f.cmd(0,'start');f.cmd(0,'pause');f.foldHand();assert.throws(()=>f.sit(2),/不允许新玩家/);
    assert.equal(f.store.user(f.users[2].id)?.balance,100000);
  } finally {f.store.db.close();}
});

test('waiting room can be dissolved without a hand or charging anyone',()=>{
  const f=fixture();try {
    f.create();f.cmd(0,'endRoom');assert.equal(f.room.view(f.users[0].id).phase,'empty');
    const result=f.store.recentMatches()[0];assert.equal(result.startedAt,null);assert.deepEqual(result.players,[]);
    assert.ok(f.store.users().every(u=>u.balance===100000));
  } finally {f.store.db.close();}
});

test('restart retains match deadline and safely closes expired paused match; old fixed table migrates without chip loss',()=>{
  const f=fixture(2);try {
    f.create();f.sit(0);f.sit(1);f.cmd(0,'start');f.cmd(0,'pause');f.foldHand();
    f.room.state.match!.endsAt=Date.now()-1;f.store.save(f.room.state);
    const reopened=new Room(f.store);assert.ok(reopened.state.match);reopened.tick();assert.equal(reopened.state.match,null);
    assert.equal(f.store.users().reduce((n,u)=>n+u.balance,0),200000);
    // A prior-version snapshot has no match property, but its seated chips must survive.
    const legacy=structuredClone(f.room.state) as unknown as Record<string,unknown>;delete legacy.match;
    legacy.config={smallBlind:10,bigBlind:20,straddleMax:8,squidEnabled:false,squidUnit:100};
    f.store.save(legacy);const migrated=new Room(f.store);
    assert.equal(migrated.state.match?.name,'原有好友房');assert.equal(migrated.state.config.durationMinutes,0);
    assert.deepEqual(migrated.state.seats,f.room.state.seats);
  } finally {f.store.db.close();}
});
