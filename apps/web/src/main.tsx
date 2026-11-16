import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import type { RoomView } from '../../server/room';
import { Lobby, RoomSetupForm } from './lobby';
import { Card } from './card';
import { PokerTable } from './table';
import { Settlement } from './settlement';
import type { MatchResult } from '../../../packages/game-engine/room-config';
import './style.css';
import './lobby.css';

const number=(n:number)=>n.toLocaleString('zh-CN');
async function request(path:string,body?:unknown) {
  const response=await fetch(`/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'请求失败');return data;
}
function Mark(){return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 24c8-14 20-14 29 0-9 14-21 14-29 0Z" stroke="currentColor" strokeWidth="2"/><path d="m37 24 7-9v18l-7-9ZM22 14l-5-6M22 34l-5 6" stroke="currentColor" strokeWidth="2"/><circle cx="16" cy="23" r="2" fill="currentColor"/></svg>}
function AccountCreator(){
  const [pending,setPending]=useState(false),[message,setMessage]=useState('');
  return <section className="panel"><details><summary>创建朋友账号</summary><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);setPending(true);setMessage('');try{await request('admin/users',{username:f.get('username'),name:f.get('name'),password:f.get('password')});form.reset();setMessage('账号已创建');}catch(err){setMessage((err as Error).message);}finally{setPending(false);}}}><label>登录账号<input name="username" required pattern="[a-zA-Z0-9_]{3,24}" autoComplete="off"/></label><label>昵称<input name="name" required maxLength={16}/></label><label>初始密码<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><button className="wide" disabled={pending}>创建账号</button>{message&&<p className="muted" role="status">{message}</p>}</form></details></section>;
}
function App(){
  const [page,setPage]=useState<'lobby'|'table'|'create'|'settings'>('lobby');
  const [user,setUser]=useState<RoomView['me']|null>(null),[loading,setLoading]=useState(true),[room,setRoom]=useState<RoomView|null>(null);
  const [error,setError]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false);
  const [settlement,setSettlement]=useState<MatchResult|null>(null);
  const activeMatch=useRef<string|null>(null);
  const [clock,setClock]=useState(Date.now());
  const socket=useRef<Socket|null>(null),offset=useRef(0);
  useEffect(()=>{request('me').then(d=>setUser(d.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
  useEffect(()=>{
    if(!user)return;
    const s=io({transports:['websocket','polling']});socket.current=s;
    s.on('connect',()=>{setConnected(true);setError('');});s.on('disconnect',()=>setConnected(false));
    s.on('connect_error',()=>setError('连接暂时中断，正在尝试重连；若已在其他设备登录，请重新登录。'));
    s.on('state',(state:RoomView)=>{offset.current=state.serverNow-Date.now();if(activeMatch.current&&!state.match){const result=state.recentMatches.find(m=>m.id===activeMatch.current);if(result)setSettlement(result);}activeMatch.current=state.match?.id??null;setRoom(state);});
    return()=>{s.disconnect();socket.current=null;};
  },[user?.id]);
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(room&&!room.match)setPage(p=>p==='table'||p==='settings'?'lobby':p);},[room?.match?.id]);
  async function command(type:string,data:Record<string,unknown>={}) {
    if(!socket.current?.connected||!room||busy)return false;
    setBusy(true);setError('');
    try{const ack=await socket.current.timeout(7000).emitWithAck('command',{key:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,version:room.version,type,data});if(!ack.ok)throw new Error(ack.error);return true;}
    catch(e){setError(e instanceof Error?e.message:'请求失败，请等待牌桌同步后再操作');return false;}finally{setBusy(false);}
  }
  async function logout(){await request('logout',{});setUser(null);setRoom(null);setError('');setPage('lobby');setSettlement(null);activeMatch.current=null;}
  if(loading)return <div className="loading">正在连接牌桌…</div>;
  if(!user)return <main className="login-layout">
    <div className="brand"><Mark/><span>鱼人德州<small>FISHMAN POKER CLUB</small></span></div>
    <section className="intro"><h1>鱼人德州</h1><div className="intro-cards"><Card value="As"/><Card value="Ah"/></div></section>
    <section className="login-card"><div className="mini-line"/><h2>登录</h2>
      <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{const d=await request('login',{username:f.get('username'),password:f.get('password')});setUser(d.user);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
        <label>账号<input name="username" autoComplete="username" required placeholder="输入你的账号" maxLength={24}/></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required placeholder="输入密码" maxLength={128}/></label>
        {error&&<p className="error" role="alert">{error}</p>}<button className="primary wide" disabled={busy}>{busy?'登录中…':'登录'} <span>↗</span></button>
      </form>
    </section>
  </main>;
  const me=room?.me??user,seat=room?.seats.find(p=>p.id===me.id),hand=room?.hand;
  const host=room?.hostId===me.id||!!me.admin,playing=!!hand&&hand.street!=='finished';
  const player=hand?.players.find(p=>p.id===me.id);
  const disabled=busy||!connected;
  const endRoom=()=>{if(window.confirm(playing?'确定结束比赛？当前手会继续，结束后结算鱿鱼、退回筹码并关闭房间。':'确定关闭房间？将结算鱿鱼、退回所有筹码并保存战绩。'))void command('endRoom');};
  const header=<header className="topbar"><div className="brand"><Mark/><span>鱼人德州</span></div><button className="quiet" onClick={()=>{setPage('lobby');setSettlement(null);setError('');}}>大厅</button>{room?.match&&page!=='table'&&<button className="quiet" onClick={()=>setPage('table')}>牌桌</button>}<div className="connection"><i className={connected?'online':''}/>{connected?'已连接':'正在重连'}</div><details className="profile"><summary>我的</summary><div className="profile-card"><b>{me.name}</b><dl><div><dt>账户积分</dt><dd>{number(me.balance)}</dd></div><div><dt>桌上筹码</dt><dd>{number(playing&&player?player.stack:seat?.stack??0)}</dd></div><div><dt>时间卡</dt><dd>{me.timeCards} 张</dd></div></dl><small>每日 04:00 重置至 100,000</small><button className="quiet" onClick={logout}>退出登录</button></div></details></header>;
  const accountPanel=!!me.admin&&<AccountCreator/>;
  if(!room)return <div className="club">{header}<div className="loading">正在同步大厅…</div></div>;
  if(settlement)return <div className="club">{header}<Settlement result={settlement} room={room} now={clock+offset.current} disabled={disabled} error={error} command={command} onClose={()=>{setSettlement(null);setPage('lobby');}}/></div>;
  if(page!=='table'||!room.match)return <div className="club">{header}{error&&<p className="error lobby-error" role="alert">{error}</p>}
    {page==='create'&&!room.match?<RoomSetupForm name={`${me.name}的好友局`} busy={disabled} onCancel={()=>setPage('lobby')} onSubmit={async data=>{if(await command('createRoom',data)){setPage('table');}}}/>:
      page==='settings'&&room.match&&host?<RoomSetupForm name={room.match.name} initial={room.config} edit busy={disabled||room.match.startedAt!==null} onCancel={()=>setPage('table')} onSubmit={async data=>{if(await command('settings',data))setPage('table');}}/>:
      <Lobby room={room} now={clock+offset.current} disabled={disabled} onCreate={()=>{setPage('create');setError('');}} onEnter={()=>{setPage('table');setError('');}} onEnd={endRoom} accountPanel={accountPanel}/>}
  </div>;
  return <div className="club game-club">{header}<PokerTable key={room.match.id} room={room} now={clock+offset.current} disabled={disabled} error={error} command={command} clearError={()=>setError('')} onEdit={()=>setPage('settings')}/></div>;

}
createRoot(document.getElementById('root')!).render(<App/>);
