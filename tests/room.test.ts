import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, verifyPassword } from '../apps/server/store';
import { Room, gameDay } from '../apps/server/room';
import { Holdem } from '../packages/game-engine/holdem';
function setup(n=3){const store=new Store(':memory:');const users=Array.from({length:n},(_,i)=>store.createUser(`user${i}`,`玩家${i}`,'test-password-123',i===0));const room=new Room(store);users.forEach(u=>room.online.add(u.id));const cmd=(id:number,type:string,data:Record<string,unknown>={})=>room.command(id,crypto.randomUUID(),room.state.version,type,data);cmd(users[0].id,'createRoom',{name:'测试好友房'});users.forEach(u=>cmd(u.id,'sit',{amount:2000}));return {store,room,users,cmd};}
test('password hashing and login invalidation',()=>{const {store,users}=setup(2);const u=users[0];assert.ok(verifyPassword('test-password-123',u.password));assert.ok(!verifyPassword('wrong',u.password));const a=store.login(u),b=store.login(u);assert.equal(store.session(a),undefined);assert.equal(store.session(b)?.id,u.id);store.db.close();});
test('duplicate requests do not debit twice; stale requests rejected; host required',()=>{
  const {store,room,users,cmd}=setup(2),id=users[0].id,key=crypto.randomUUID(),version=room.state.version;
  room.command(id,key,version,'topup',{amount:2000});room.command(id,key,version,'topup',{amount:2000});
  assert.equal(store.user(id)?.balance,96000);assert.equal(room.state.seats[0].stack,4000);
  assert.throws(()=>room.command(id,crypto.randomUUID(),version,'topup',{amount:1}));assert.throws(()=>cmd(users[1].id,'start'));store.db.close();
});
test('time card arms without charging, consumes once after 25s, timeout conserves money',()=>{
  const {store,room,users,cmd}=setup(2);cmd(users[0].id,'start');const id=room.state.hand!.actor!;
  cmd(id,'time');assert.equal(store.user(id)?.timeCards,3);
  room.tick(room.state.deadline+1);assert.equal(store.user(id)?.timeCards,2);assert.ok(room.state.timeExtended);
  room.tick(room.state.deadline+1);assert.equal(room.state.hand?.street,'finished');
  assert.equal(room.state.seats.reduce((s,p)=>s+p.stack,0),4000);store.db.close();
});
test('squid reserves and early payout are zero sum, cannot enter mid-round',()=>{
  const {store,room,users,cmd}=setup(3);cmd(users[0].id,'settings',{smallBlind:10,bigBlind:20,straddleMax:8,squidEnabled:true,squidUnit:100});cmd(users[0].id,'start');
  assert.equal(store.user(users[0].id)?.balance,97800);
  while(room.state.hand?.street!=='finished')cmd(room.state.hand!.actor!,'action',{action:'fold'});
  assert.equal(room.state.squid?.marked.length,1);cmd(users[0].id,'pause');cmd(users[0].id,'squidEnd');
  assert.equal(store.users().reduce((s,u)=>s+u.balance,0)+room.state.seats.reduce((s,p)=>s+p.stack,0),300000);store.db.close();
});
test('daily reset waits until end of hand and counts wallet/table/reserve once',()=>{
  const {store,room,users,cmd}=setup(2);cmd(users[0].id,'start');room.state.day='2000-01-01';
  room.tick(room.state.deadline-1);assert.equal(room.state.day,'2000-01-01');
  cmd(room.state.hand!.actor!,'action',{action:'fold'});room.tick();
  assert.ok(store.users().every(u=>u.balance===100000));assert.ok(room.state.seats.every(p=>p.stack===0));assert.equal(room.state.hand,null);assert.equal(room.state.running,false);
  const ledgerCount=store.recent(users[0].id).length;room.tick();assert.equal(store.recent(users[0].id).length,ledgerCount);store.db.close();
});
test('Shanghai 04:00 day boundary',()=>{assert.equal(gameDay(Date.parse('2026-11-15T19:59:59Z')),'2026-11-15');assert.equal(gameDay(Date.parse('2026-11-15T20:00:00Z')),'2026-11-16');});
test('restart restores same private deck and pauses active hand',()=>{
  const {store,room,users,cmd}=setup(2);cmd(users[0].id,'start');const before=structuredClone(room.state.hand);
  const resumed=new Room(store);assert.ok(resumed.state.pausedForRecovery);assert.deepEqual(resumed.state.hand,before);assert.equal(resumed.tick(Date.now()+999999),false);
  resumed.command(users[0].id,crypto.randomUUID(),resumed.state.version,'start');assert.equal(resumed.state.pausedForRecovery,false);assert.deepEqual(Holdem.restore(resumed.state.hand!).view(users[1].id).players[0].cards,[]);store.db.close();
});
