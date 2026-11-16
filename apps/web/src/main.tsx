import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import type { RoomView } from '../../server/room';
import { Lobby, RoomSetupForm, matchTime } from './lobby';
import './style.css';
import './lobby.css';

const number=(n:number)=>n.toLocaleString('zh-CN');
async function request(path:string,body?:unknown) {
  const response=await fetch(`/api/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'请求失败');return data;
}
function Mark(){return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 24c8-14 20-14 29 0-9 14-21 14-29 0Z" stroke="currentColor" strokeWidth="2"/><path d="m37 24 7-9v18l-7-9ZM22 14l-5-6M22 34l-5 6" stroke="currentColor" strokeWidth="2"/><circle cx="16" cy="23" r="2" fill="currentColor"/></svg>}
function Card({value,empty=false}:{value?:string;empty?:boolean}) {
  const suit=value?({c:'♣',d:'♦',h:'♥',s:'♠'}[value[1]]):'';
  return <span className={`card ${value&&'dh'.includes(value[1])?'red':''} ${!value?'back':''} ${empty?'empty':''}`} aria-label={value?`${value[0]}${suit}`:'未发牌'}>{value?<><b>{value[0]==='T'?'10':value[0]}</b><span>{suit}</span></>:<span>◇</span>}</span>;
}
function AccountCreator(){
  const [pending,setPending]=useState(false),[message,setMessage]=useState('');
  return <section className="panel"><details><summary>创建朋友账号</summary><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);setPending(true);setMessage('');try{await request('admin/users',{username:f.get('username'),name:f.get('name'),password:f.get('password')});form.reset();setMessage('账号已创建');}catch(err){setMessage((err as Error).message);}finally{setPending(false);}}}><label>登录账号<input name="username" required pattern="[a-zA-Z0-9_]{3,24}" autoComplete="off"/></label><label>昵称<input name="name" required maxLength={16}/></label><label>初始密码<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><button className="wide" disabled={pending}>创建账号</button>{message&&<p className="muted" role="status">{message}</p>}</form></details></section>;
}
function App(){
  const [page,setPage]=useState<'lobby'|'table'|'create'|'settings'>('lobby');
  const [user,setUser]=useState<RoomView['me']|null>(null),[loading,setLoading]=useState(true),[room,setRoom]=useState<RoomView|null>(null);
  const [error,setError]=useState(''),[connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[tab,setTab]=useState('table');
  const [amount,setAmount]=useState('2000'),[raise,setRaise]=useState(''),[clock,setClock]=useState(Date.now());
  const [ledger,setLedger]=useState<{amount:number;kind:string;at:string}[]>([]);
  const socket=useRef<Socket|null>(null),offset=useRef(0);
  useEffect(()=>{request('me').then(d=>setUser(d.user)).catch(()=>{}).finally(()=>setLoading(false));},[]);
  useEffect(()=>{
    if(!user)return;
    const s=io({transports:['websocket','polling']});socket.current=s;
    s.on('connect',()=>{setConnected(true);setError('');});s.on('disconnect',()=>setConnected(false));
    s.on('connect_error',()=>setError('连接暂时中断，正在尝试重连；若已在其他设备登录，请重新登录。'));
    s.on('state',(state:RoomView)=>{offset.current=state.serverNow-Date.now();setRoom(state);});
    return()=>{s.disconnect();socket.current=null;};
  },[user?.id]);
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),250);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(tab==='history'&&user)request('ledger').then(setLedger).catch(e=>setError(e.message));},[tab,room?.hand?.street,user?.id]);
  useEffect(()=>{setRaise(String(room?.hand?.legal?.minTo??''));},[room?.hand?.actor,room?.hand?.currentBet,room?.hand?.street]);
  useEffect(()=>{if(room&&!room.match)setPage(p=>p==='table'||p==='settings'?'lobby':p);},[room?.match?.id]);
  useEffect(()=>{if(room?.match)setAmount(String(room.config.defaultBuyIn));},[room?.match?.id,room?.config.defaultBuyIn]);
  async function command(type:string,data:Record<string,unknown>={}) {
    if(!socket.current?.connected||!room||busy)return false;
    setBusy(true);setError('');
    try{const ack=await socket.current.timeout(7000).emitWithAck('command',{key:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,version:room.version,type,data});if(!ack.ok)throw new Error(ack.error);return true;}
    catch(e){setError(e instanceof Error?e.message:'请求失败，请等待牌桌同步后再操作');return false;}finally{setBusy(false);}
  }
  async function logout(){await request('logout',{});setUser(null);setRoom(null);setError('');setPage('lobby');}
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
  const me=room?.me??user,seat=room?.seats.find(p=>p.id===me.id),hand=room?.hand,legal=hand?.legal;
  const host=room?.hostId===me.id||!!me.admin,playing=!!hand&&hand.street!=='finished';
  const remaining=room?.deadline?Math.max(0,Math.ceil((room.deadline-clock-offset.current)/1000)):0;
  const seats=[...(room?.seats??[])].sort((a,b)=>a.seat-b.seat);
  const myIndex=seats.findIndex(p=>p.id===me.id);if(myIndex>0)seats.push(...seats.splice(0,myIndex));
  const player=hand?.players.find(p=>p.id===me.id);
  const disabled=busy||!connected;
  const config=room?.config;
  const endRoom=()=>{if(window.confirm(playing?'确定结束比赛？当前手会继续，结束后结算鱿鱼、退回筹码并关闭房间。':'确定关闭房间？将结算鱿鱼、退回所有筹码并保存战绩。'))void command('endRoom');};
  const header=<header className="topbar"><div className="brand"><Mark/><span>鱼人德州</span></div><button className="quiet" onClick={()=>{setPage('lobby');setError('');}}>大厅</button>{room?.match&&page!=='table'&&<button className="quiet" onClick={()=>setPage('table')}>牌桌</button>}<div className="connection"><i className={connected?'online':''}/>{connected?'已连接':'正在重连'}</div><details className="profile"><summary>我的</summary><div className="profile-card"><b>{me.name}</b><dl><div><dt>账户积分</dt><dd>{number(me.balance)}</dd></div><div><dt>桌上筹码</dt><dd>{number(playing&&player?player.stack:seat?.stack??0)}</dd></div><div><dt>时间卡</dt><dd>{me.timeCards} 张</dd></div></dl><small>每日 04:00 重置至 100,000</small><button className="quiet" onClick={logout}>退出登录</button></div></details></header>;
  const accountPanel=!!me.admin&&<AccountCreator/>;
  if(!room)return <div className="club">{header}<div className="loading">正在同步大厅…</div></div>;
  if(page!=='table'||!room.match)return <div className="club">{header}{error&&<p className="error lobby-error" role="alert">{error}</p>}
    {page==='create'&&!room.match?<RoomSetupForm name={`${me.name}的好友局`} busy={disabled} onCancel={()=>setPage('lobby')} onSubmit={async data=>{if(await command('createRoom',data)){setPage('table');setTab('room');}}}/>:
      page==='settings'&&room.match&&host?<RoomSetupForm name={room.match.name} initial={room.config} edit busy={disabled||room.match.startedAt!==null} onCancel={()=>setPage('table')} onSubmit={async data=>{if(await command('settings',data))setPage('table');}}/>:
      <Lobby room={room} now={clock+offset.current} disabled={disabled} onCreate={()=>{setPage('create');setError('');}} onEnter={()=>{setPage('table');setError('');}} onEnd={endRoom} accountPanel={accountPanel}/>}
  </div>;
  return <div className="club">
    {header}
    <div className={`match-bar ${room.match.endRequested?'closing':''}`}><b>{matchTime(room,clock+offset.current)}</b></div>
    <div className="club-body"><main className={`table-panel ${tab!=='table'?'mobile-hidden':''}`}>
      <div className="table-heading"><div><h1>{room.match.name}</h1></div><div className="table-meta"><b>{room.seats.length}<small> / {config?.maxPlayers} 人</small></b><span>盲注 {config?.smallBlind} / {config?.bigBlind}</span></div></div>
      <div className="table-status"><span>{room?.pausedForRecovery?'等待恢复':playing?({preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌'}[hand!.street as 'preflop']):room?.running?'准备发牌':'待开赛'}</span><span>{config?.straddleMax?`Straddle ≤ ${config.straddleMax}BB`:'Straddle 关闭'}</span></div>
      <div className="arena"><div className="felt"><div className="felt-inner"/><div className="felt-wordmark">FISHMAN</div></div>
        <div className="community"><span className="pot-label">{hand?.street==='finished'?'本手底池':'底池'}</span><strong>{number(hand?.pot??0)}</strong><div className="board">{Array.from({length:5},(_,i)=><Card key={i} value={hand?.board[i]} empty/>)}</div>
          {hand?.street==='finished'?<div className="result">{hand.pots.filter(p=>!p.returned).map((p,i)=><span key={i}>{i===0?'主池':'边池'} {p.winners.map(id=>hand.players.find(x=>x.id===id)?.name).join(' / ')} +{number(p.amount)}</span>)}</div>:null}
        </div>
        {seats.map((p,i)=>{const hp=hand?.players.find(x=>x.id===p.id),active=hand?.actor===p.id,angle=(i/Math.max(seats.length,2))*Math.PI*2;
          return <div key={p.id} className={`seat ${i===0?'bottom-seat':''} ${p.id===me.id?'mine':''} ${active?'active':''} ${hp?.folded&&playing?'folded':''}`} style={{left:`${50-42*Math.sin(angle)}%`,top:`${49+40*Math.cos(angle)}%`}}>
            <div className="seat-avatar">{p.name.slice(0,1)}{room?.hostId===p.id&&<span className="host-badge">房主</span>}{hp&&hand?.button===p.seat&&<span className="dealer">D</span>}</div>
            <b title={p.name}>{p.name}{p.id===me.id?' · 我':''}</b><span className="seat-stack">{number(playing&&hp?hp.stack:p.stack)}</span>
            <span className="seat-action">{!p.online?'离线':p.sittingOut?'下手暂离':hp?.action||''}</span>
            {active&&<span className="turn-clock">{room?.pausedForRecovery?'已暂停':`${remaining}s`}</span>}
            {room?.squid?.marked.includes(p.id)&&<span className="squid-mark" title="已获得鱿鱼标记">◆</span>}
            {hp&&hp.cards.length>0&&p.id!==me.id&&<div className="revealed">{hp.cards.map(c=><Card key={c} value={c}/>)}</div>}
          </div>;
        })}
      </div>
      {!!player?.cards.length&&<section className="my-hand" aria-label="手牌"><div className="hole-cards"><Card value={player.cards[0]}/><Card value={player.cards[1]}/></div>{player.handName&&<b>{player.handName}</b>}</section>}
      {error&&<div className="error" role="alert">{error}</div>}
      {legal&&!room?.pausedForRecovery?<section className="actions"><div className="bet-input"><label>加注到<input inputMode="numeric" type="number" min={Math.min(legal.minTo,legal.maxTo)} max={legal.maxTo} value={raise} onChange={e=>setRaise(e.target.value)}/></label><button disabled={disabled||!legal.canRaise} onClick={()=>setRaise(String(legal.minTo))}>最小</button><button disabled={disabled||!legal.canRaise} onClick={()=>setRaise(String(legal.maxTo))}>全下</button></div><div className="action-buttons"><button disabled={disabled} className="fold" onClick={()=>command('action',{action:'fold'})}>弃牌</button><button disabled={disabled} onClick={()=>command('action',{action:legal.canCheck?'check':'call'})}>{legal.canCheck?'过牌':`跟注 ${number(legal.toCall)}`}</button><button className="primary" disabled={disabled||!legal.canRaise} onClick={()=>{if(Number(raise)===legal.maxTo&&!window.confirm(`确认全下，加注到 ${number(legal.maxTo)}？`))return;command('action',{action:'raise',amount:Number(raise)});}}>加注</button></div><button className="time-button" disabled={disabled||me.timeCards===0||room?.timeExtended||room?.timeArmed===me.id} onClick={()=>command('time')}>{room?.timeArmed===me.id?'已预备时间卡':room?.timeExtended?'时间卡已启用':'时间卡 +30s'}</button></section>:!seat?<div className="waiting-bar"><button className="primary" onClick={()=>setTab('room')}>入座</button></div>:host&&(!playing||room.pausedForRecovery)?<div className="waiting-bar"><button className="primary" disabled={disabled||(room.match.endRequested&&!room.pausedForRecovery)} onClick={()=>command('start')}>{room.pausedForRecovery?'恢复牌局':'开始游戏'}</button></div>:null}
    </main>
    <aside className={`sidebar ${tab==='table'?'mobile-hidden':''}`}>
      <nav className="desktop-tabs"><button className={tab!=='history'?'selected':''} onClick={()=>setTab('room')}>房间</button><button className={tab==='history'?'selected':''} onClick={()=>setTab('history')}>记录</button></nav>
      {tab==='history'?<><section className="panel"><h2>牌局记录</h2><div className="log">{hand?.log.length?hand.log.map((l,i)=><p key={i}>{l}</p>):<p className="muted">暂无记录</p>}</div></section><section className="panel"><h2>积分流水</h2>{ledger.map((l,i)=><div className="ledger-row" key={i}><span>{l.kind}<small>{l.at} UTC</small></span><b className={l.amount>=0?'positive':''}>{l.amount>0?'+':''}{number(l.amount)}</b></div>)}</section></>:<>
        <section className="panel wallet"><h2>带入</h2><label>带入金额<input type="number" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} min={seat?1:config?.minBuyIn} max={config?.maxBuyIn}/></label><div className="presets">{[...new Set([config!.defaultBuyIn,Math.min(config!.defaultBuyIn*2,config!.maxBuyIn),config!.maxBuyIn])].map(n=><button key={n} onClick={()=>setAmount(String(n))}>{number(n)}</button>)}</div><button className="primary wide" disabled={disabled||playing||room.match.endRequested||!!seat&&!config?.allowTopup||!seat&&room.match.startedAt!==null&&!config?.allowLateJoin} onClick={()=>command(seat?'topup':'sit',{amount:Number(amount)})}>{seat?'追加带入':'带入并入座'}</button><small className="muted">带入范围 {number(config!.minBuyIn)}～{number(config!.maxBuyIn)}{!config?.allowTopup?' · 禁止追加':''}{!config?.allowLateJoin?' · 禁止中途加入':''}</small>{playing&&<small className="muted">本手结束后可操作</small>}
          {seat&&<><label className="switch"><input type="checkbox" checked={seat.straddle} onChange={e=>command('straddle',{enabled:e.target.checked})} disabled={disabled}/>自动 Straddle</label><label className="switch"><input type="checkbox" checked={seat.sittingOut} onChange={e=>command('away',{enabled:e.target.checked})} disabled={disabled}/>下一手暂离</label><button className="quiet wide" disabled={disabled||playing||room.match.endRequested} onClick={()=>{if(room?.squid&&!confirm('离桌将提前结算当前鱿鱼轮次，是否继续？'))return;command('leave');}}>离桌</button></>}
        </section>
        {config?.squidEnabled&&<section className="panel"><h2>鱿鱼 <span className="tag">{room.squid?'进行中':'待开始'}</span></h2>{room.squid&&<div className="squid-progress">标记 {room.squid.marked.length}/{room.squid.participants.length} · {room.squid.unit} 积分</div>}</section>}
        {host&&<section className="panel"><h2>房主控制</h2><div className="host-actions"><button className="primary" disabled={disabled||(playing&&!room.pausedForRecovery)||(room.match.endRequested&&!room.pausedForRecovery)} onClick={()=>command('start')}>{room.pausedForRecovery?'恢复当前手':room.match.startedAt?'继续比赛':'开始比赛'}</button><button disabled={disabled||!room.running||room.match.endRequested} onClick={()=>command('pause')}>本手后暂停</button></div><button className="quiet wide danger-text" disabled={disabled||room.match.endRequested} onClick={endRoom}>{room.match.endRequested?'本手后结束':room.match.startedAt?'结束比赛':'解散房间'}</button>{room.squid&&<button className="quiet wide" disabled={disabled||playing||room.match.endRequested} onClick={()=>command('squidEnd')}>结算鱿鱼</button>}<button className="wide" disabled={disabled||room.match.startedAt!==null} onClick={()=>setPage('settings')}>编辑开赛规则</button></section>}
        {accountPanel}
        <details className="panel notices"><summary>动态</summary>{room.notices.slice(-4).map((n,i)=><p key={i}>{n}</p>)}</details>
      </>}
      {error&&tab!=='table'&&<p className="error" role="alert">{error}</p>}
    </aside></div>
    <nav className="mobile-nav" aria-label="主导航">{[['table','牌桌'],['room','房间'],['history','记录']].map(([value,label])=><button key={value} className={tab===value?'selected':''} onClick={()=>setTab(value)}>{label}</button>)}</nav>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
