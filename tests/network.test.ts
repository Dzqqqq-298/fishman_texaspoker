import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import type { RoomView } from '../apps/server/room';

async function until(predicate:()=>boolean,ms=6000) {const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)throw new Error('等待状态超时');await new Promise(r=>setTimeout(r,10));}}
test('real HTTP + 11 WebSocket clients: authentication, private cards, complete hand, reconnect', {timeout:45000}, async()=>{
  const folder=await mkdtemp(join(tmpdir(),'fishman-test-')),sockets:Socket[]=[];
  const child=spawn(process.execPath,['--import','tsx','apps/server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:folder,ADMIN_USERNAME:'testadmin',ADMIN_PASSWORD:'Network-test-password-9527',PUBLIC_ORIGIN:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',port=0;child.stdout.on('data',data=>{output+=data.toString();port=Number(output.match(/http:\/\/localhost:(\d+)/)?.[1]??0);});child.stderr.on('data',data=>output+=data.toString());
  try {
    await until(()=>port>0||child.exitCode!==null,15000);assert.ok(port>0,output);
    const base=`http://127.0.0.1:${port}`;
    const call=async(path:string,body?:unknown,cookie='')=>fetch(`${base}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{origin:base,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await fetch(base)).status,200);assert.equal((await fetch(`${base}/src/main.tsx`)).status,200);
    assert.equal((await call('me')).status,401);
    assert.equal((await fetch(`${base}/api/login`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
    const login=async(username:string)=>{const r=await call('login',{username,password:'Network-test-password-9527'});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0];};
    const adminCookie=await login('testadmin');
    const cookies=[adminCookie];
    for(let i=1;i<11;i++){
      const response=await call('admin/users',{username:`testuser${i}`,name:`朋友${i}`,password:'Network-test-password-9527'},adminCookie);assert.equal(response.status,200);cookies.push(await login(`testuser${i}`));
    }
    const states=new Map<number,RoomView>();
    for(let i=0;i<11;i++){
      const socket=io(base,{transports:['websocket'],extraHeaders:{Origin:base,Cookie:cookies[i]},reconnection:false});sockets.push(socket);socket.on('state',(s:RoomView)=>states.set(i,s));
      await until(()=>states.has(i));
      const state=states.get(i)!;
      const ack=await socket.timeout(5000).emitWithAck('command',{key:crypto.randomUUID(),version:state.version,type:'sit',data:{amount:2000}});assert.ok(ack.ok,ack.error);
      await until(()=>states.get(i)!.seats.length===i+1);
    }
    await until(()=>states.get(0)!.seats.length===11);
    const send=async(index:number,type:string,data:Record<string,unknown>={})=>{
      const v=states.get(index)!.version;
      const ack=await sockets[index].timeout(5000).emitWithAck('command',{key:crypto.randomUUID(),version:v,type,data});assert.ok(ack.ok,ack.error);
      await until(()=>Array.from({length:11},(_,i)=>states.get(i)!.version>v).every(Boolean));
    };
    await send(0,'start');await send(0,'pause');
    for(let i=0;i<11;i++){
      const s=states.get(i)!;assert.equal(s.hand!.players.find(p=>p.id===s.me.id)!.cards.length,2);
      assert.ok(s.hand!.players.filter(p=>p.id!==s.me.id).every(p=>p.cards.length===0));
      assert.ok(!('deck' in s.hand!));
    }
    let actions=0;
    while(states.get(0)!.hand!.street!=='finished'){
      assert.ok(++actions<100);const actor=states.get(0)!.hand!.actor,index=[...states].find(([,v])=>v.me.id===actor)![0];
      const legal=states.get(index)!.hand!.legal!;await send(index,'action',{action:legal.canCheck?'check':'call'});
    }
    const result=states.get(0)!;assert.equal(result.seats.reduce((n,p)=>n+p.stack,0),22000);assert.equal(result.running,false);
    const id=result.me.id;sockets[0].disconnect();
    const reconnected=io(base,{transports:['websocket'],extraHeaders:{Origin:base,Cookie:cookies[0]},reconnection:false});sockets.push(reconnected);
    let restored:RoomView|undefined;reconnected.on('state',(s:RoomView)=>restored=s);await until(()=>!!restored);
    assert.equal(restored!.me.id,id);assert.equal(restored!.hand!.id,result.hand!.id);
    assert.equal(restored!.seats.length,11);
  } finally {
    sockets.forEach(s=>s.disconnect());child.kill();await until(()=>child.exitCode!==null||child.signalCode!==null).catch(()=>{});
    const rel=relative(resolve(tmpdir()),resolve(folder));
    if(rel&&!rel.startsWith('..')&&!isAbsolute(rel))await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
