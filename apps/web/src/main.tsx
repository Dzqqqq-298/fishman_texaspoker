import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io, type Socket } from 'socket.io-client';
import type { RoomView } from '../../server/room';
import './style.css';

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
function App(){
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
  async function command(type:string,data:Record<string,unknown>={}) {
    if(!socket.current?.connected||!room||busy)return;
    setBusy(true);setError('');
    try{const ack=await socket.current.timeout(7000).emitWithAck('command',{key:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,version:room.version,type,data});if(!ack.ok)throw new Error(ack.error);}
    catch(e){setError(e instanceof Error?e.message:'请求失败，请等待牌桌同步后再操作');}finally{setBusy(false);}
  }
  async function logout(){await request('logout',{});setUser(null);setRoom(null);setError('');}
  if(loading)return <div className="loading">正在连接牌桌…</div>;
  if(!user)return <main className="login-layout">
    <div className="brand"><Mark/><span>鱼人德州<small>FISHMAN POKER CLUB</small></span></div>
    <section className="intro"><span className="eyebrow">一桌好友 · 一起入局</span><h1>好朋友，<br/>下一手见。</h1><p>属于你们的私人牌桌。<br/>从两人对决，到十一人的热闹牌局。</p><div className="intro-cards"><Card value="As"/><Card value="Ah"/></div><span className="intro-caption">TEXAS HOLD’EM / FRIENDS ONLY</span></section>
    <section className="login-card"><div className="mini-line"/><span className="eyebrow">欢迎回来</span><h2>入座之前，先打个招呼。</h2><p className="muted">使用房主提供的账号登录。</p>
      <form onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{const d=await request('login',{username:f.get('username'),password:f.get('password')});setUser(d.user);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>
        <label>账号<input name="username" autoComplete="username" required placeholder="输入你的账号" maxLength={24}/></label>
        <label>密码<input name="password" type="password" autoComplete="current-password" required placeholder="输入密码" maxLength={128}/></label>
        {error&&<p className="error" role="alert">{error}</p>}<button className="primary wide" disabled={busy}>{busy?'登录中…':'进入鱼人牌桌'} <span>↗</span></button>
      </form><p className="login-foot">私人房间 · 虚拟积分 · 每日重新出发</p>
    </section><footer className="login-footer">FISHMAN / EST. 2026 <span>打得尽兴，玩得开心。</span></footer>
  </main>;
  const me=room?.me??user,seat=room?.seats.find(p=>p.id===me.id),hand=room?.hand,legal=hand?.legal;
  const host=room?.hostId===me.id||!!me.admin,playing=!!hand&&hand.street!=='finished';
  const remaining=room?.deadline?Math.max(0,Math.ceil((room.deadline-clock-offset.current)/1000)):0;
  const seats=[...(room?.seats??[])].sort((a,b)=>a.seat-b.seat);
  const myIndex=seats.findIndex(p=>p.id===me.id);if(myIndex>0)seats.push(...seats.splice(0,myIndex));
  const player=hand?.players.find(p=>p.id===me.id);
  const disabled=busy||!connected;
  const config=room?.config;
  return <div className="club">
    <header className="topbar"><div className="brand"><Mark/><span>鱼人德州<small>PRIVATE TABLE / 01</small></span></div><div className="connection"><i className={connected?'online':''}/>{connected?'牌桌已连接':'正在重连'}</div><button className="quiet" onClick={logout}>退出登录</button></header>
    <div className="club-body"><main className={`table-panel ${tab!=='table'?'mobile-hidden':''}`}>
      <div className="table-heading"><div><span className="eyebrow">好友专属牌桌</span><h1>今晚，来一手。</h1></div><div className="table-meta"><b>{room?.seats.length??0}<small> / 11 人</small></b><span>盲注 {config?.smallBlind} / {config?.bigBlind}</span></div></div>
      <div className="table-status"><span>{room?.pausedForRecovery?'服务已恢复 · 等待房主继续':playing?({preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌'}[hand!.street as 'preflop']):room?.running?'下一手准备中':'等待房主开始'}</span><span>{config?.straddleMax?`连续 Straddle · 最高 ${config.straddleMax}BB`:'Straddle 关闭'}</span></div>
      <div className="arena"><div className="felt"><div className="felt-inner"/><div className="felt-wordmark">FISHMAN</div></div>
        <div className="community"><span className="pot-label">{hand?.street==='finished'?'本手底池':'底池'}</span><strong>{number(hand?.pot??0)}</strong><div className="board">{Array.from({length:5},(_,i)=><Card key={i} value={hand?.board[i]} empty/>)}</div>
          {hand?.street==='finished'?<div className="result">{hand.pots.filter(p=>!p.returned).map((p,i)=><span key={i}>{i===0?'主池':'边池'} {p.winners.map(id=>hand.players.find(x=>x.id===id)?.name).join(' / ')} +{number(p.amount)}</span>)}</div>:<span className="felt-note">{seats.length<2?'邀请朋友，入座开局':playing?`等待 ${hand?.players.find(p=>p.id===hand.actor)?.name??''} 行动`:'一桌好友，随时开始'}</span>}
        </div>
        {seats.map((p,i)=>{const hp=hand?.players.find(x=>x.id===p.id),active=hand?.actor===p.id,angle=(i/Math.max(seats.length,2))*Math.PI*2;
          return <div key={p.id} className={`seat ${i===0?'bottom-seat':''} ${p.id===me.id?'mine':''} ${active?'active':''} ${hp?.folded&&playing?'folded':''}`} style={{left:`${50-42*Math.sin(angle)}%`,top:`${49+40*Math.cos(angle)}%`}}>
            <div className="seat-avatar">{p.name.slice(0,1)}{room?.hostId===p.id&&<span className="host-badge">房主</span>}{hp&&hand?.button===p.seat&&<span className="dealer">D</span>}</div>
            <b title={p.name}>{p.name}{p.id===me.id?' · 我':''}</b><span className="seat-stack">{number(playing&&hp?hp.stack:p.stack)}</span>
            <span className="seat-action">{!p.online?'离线':p.sittingOut?'下手暂离':hp?.action||'已入座'}</span>
            {active&&<span className="turn-clock">{room?.pausedForRecovery?'已暂停':`${remaining}s`}</span>}
            {room?.squid?.marked.includes(p.id)&&<span className="squid-mark" title="已获得鱿鱼标记">◆</span>}
            {hp&&hp.cards.length>0&&p.id!==me.id&&<div className="revealed">{hp.cards.map(c=><Card key={c} value={c}/>)}</div>}
          </div>;
        })}
      </div>
      <section className="my-hand"><div><span className="eyebrow">你的手牌</span><div className="hole-cards"><Card value={player?.cards[0]}/><Card value={player?.cards[1]}/></div></div><div className="my-summary"><b>{player?.handName??(player?.folded&&playing?'本手已弃牌':seat?'等待你的好牌':'先入座，再开始')}</b><span>桌上 {number(playing&&player?player.stack:seat?.stack??0)} · 账户 {number(me.balance)}</span><span>时间卡 {me.timeCards} 张 · 每张 +30 秒</span></div></section>
      {error&&<div className="error" role="alert">{error}</div>}
      {legal&&!room?.pausedForRecovery?<section className="actions"><div className="bet-input"><label>加注到<input inputMode="numeric" type="number" min={Math.min(legal.minTo,legal.maxTo)} max={legal.maxTo} value={raise} onChange={e=>setRaise(e.target.value)}/></label><button disabled={disabled||!legal.canRaise} onClick={()=>setRaise(String(legal.minTo))}>最小</button><button disabled={disabled||!legal.canRaise} onClick={()=>setRaise(String(legal.maxTo))}>全下</button></div><div className="action-buttons"><button disabled={disabled} className="fold" onClick={()=>command('action',{action:'fold'})}>弃牌</button><button disabled={disabled} onClick={()=>command('action',{action:legal.canCheck?'check':'call'})}>{legal.canCheck?'过牌':`跟注 ${number(legal.toCall)}`}</button><button className="primary" disabled={disabled||!legal.canRaise} onClick={()=>{if(Number(raise)===legal.maxTo&&!window.confirm(`确认全下，加注到 ${number(legal.maxTo)}？`))return;command('action',{action:'raise',amount:Number(raise)});}}>加注</button></div><button className="time-button" disabled={disabled||me.timeCards===0||room?.timeExtended||room?.timeArmed===me.id} onClick={()=>command('time')}>{room?.timeArmed===me.id?'时间卡已准备，25 秒用尽后启用':room?.timeExtended?'时间卡已启用':'使用时间卡 · +30 秒'}</button></section>:<div className="waiting-bar">{!seat?'前往「房间」带入积分，加入牌桌':playing?'观察牌局，等待轮到你':host?<button className="primary" disabled={disabled} onClick={()=>command('start')}>{room?.pausedForRecovery?'恢复牌局':'开始游戏'}</button>:'等待房主开始游戏'}</div>}
    </main>
    <aside className={`sidebar ${tab==='table'?'mobile-hidden':''}`}>
      <nav className="desktop-tabs"><button className={tab!=='history'?'selected':''} onClick={()=>setTab('room')}>房间</button><button className={tab==='history'?'selected':''} onClick={()=>setTab('history')}>记录</button></nav>
      {tab==='history'?<><section className="panel"><span className="eyebrow">本手行动</span><h2>牌局记录</h2><div className="log">{hand?.log.length?hand.log.map((l,i)=><p key={i}>{l}</p>):<p className="muted">开局后显示行动记录。</p>}</div></section><section className="panel"><h2>你的积分流水</h2>{ledger.map((l,i)=><div className="ledger-row" key={i}><span>{l.kind}<small>{l.at} UTC</small></span><b className={l.amount>=0?'positive':''}>{l.amount>0?'+':''}{number(l.amount)}</b></div>)}</section></>:<>
        <section className="panel wallet"><span className="eyebrow">{me.name} 的账户</span><strong>{number(me.balance)}</strong><span className="muted">每日 04:00 重置为 100,000 积分</span><label>带入金额<input type="number" inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)} min={config?.bigBlind}/></label><div className="presets">{[2000,4000,10000].map(n=><button key={n} onClick={()=>setAmount(String(n))}>{number(n)}</button>)}</div><button className="primary wide" disabled={disabled||playing} onClick={()=>command(seat?'topup':'sit',{amount:Number(amount)})}>{seat?'追加带入':'带入并入座'}</button>{playing&&<small className="muted">本手结束后可带入或追加</small>}
          {seat&&<><label className="switch"><input type="checkbox" checked={seat.straddle} onChange={e=>command('straddle',{enabled:e.target.checked})} disabled={disabled}/>下一手自动接力 Straddle</label><label className="switch"><input type="checkbox" checked={seat.sittingOut} onChange={e=>command('away',{enabled:e.target.checked})} disabled={disabled}/>下一手暂离</label><button className="quiet wide" disabled={disabled||playing} onClick={()=>{if(room?.squid&&!confirm('离桌将提前结算当前鱿鱼轮次，是否继续？'))return;command('leave');}}>离桌，退回筹码</button></>}
        </section>
        <section className="panel"><span className="eyebrow">SQUID GAME</span><h2>鱿鱼小游戏 <span className="tag">{room?.squid?'进行中':config?.squidEnabled?'已开启':'未开启'}</span></h2><p className="muted">独赢主池得一枚标记，最后无标记者向其他人支付积分。</p><div className="squid-progress">{room?.squid?`${room.squid.marked.length} / ${room.squid.participants.length} 人已获标记`:'3 人以上可开启，每人最多一枚标记'}</div>{room?.squid&&<small className="muted">每人支付 {room.squid.unit} · 预留 {room.squid.reserve}</small>}</section>
        {host&&room&&<section className="panel"><span className="eyebrow">HOST CONTROLS</span><h2>房主控制</h2><div className="host-actions"><button className="primary" disabled={disabled||playing&&!room.pausedForRecovery} onClick={()=>command('start')}>{room.pausedForRecovery?'恢复牌局':'开始游戏'}</button><button disabled={disabled||!room.running} onClick={()=>command('pause')}>本手后暂停</button></div>{room.squid&&<button className="quiet wide" disabled={disabled||playing} onClick={()=>command('squidEnd')}>提前结算鱿鱼</button>}<details><summary>牌桌规则设置</summary><form key={JSON.stringify(config)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);command('settings',{smallBlind:Number(f.get('sb')),bigBlind:Number(f.get('bb')),straddleMax:Number(f.get('straddle')),squidEnabled:f.get('squid')==='on',squidUnit:Number(f.get('unit'))});}}><div className="form-pair"><label>小盲<input name="sb" type="number" defaultValue={config?.smallBlind} min={1}/></label><label>大盲<input name="bb" type="number" defaultValue={config?.bigBlind} min={1}/></label></div><label>Straddle 上限<select name="straddle" defaultValue={config?.straddleMax}>{[0,2,4,8,16].map(n=><option key={n} value={n}>{n?`${n}BB`:'关闭'}</option>)}</select></label><label className="switch"><input name="squid" type="checkbox" defaultChecked={config?.squidEnabled}/>开启鱿鱼</label><label>鱿鱼单人支付积分<input name="unit" type="number" defaultValue={config?.squidUnit} min={1}/></label><button className="wide" disabled={disabled||playing||!!room.squid}>保存下一手规则</button></form></details></section>}
        {!!me.admin&&<section className="panel"><details><summary>创建朋友账号</summary><form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,f=new FormData(form);setBusy(true);try{await request('admin/users',{username:f.get('username'),name:f.get('name'),password:f.get('password')});form.reset();setError('账号已创建，可以把账号密码发给朋友。');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}><label>登录账号<input name="username" required pattern="[a-zA-Z0-9_]{3,24}" autoComplete="off"/></label><label>昵称<input name="name" required maxLength={16}/></label><label>初始密码<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><button className="wide" disabled={busy}>创建账号</button></form></details></section>}
        <section className="panel notices"><span className="eyebrow">牌桌动态</span>{room?.notices.slice(-4).map((n,i)=><p key={i}>{n}</p>)}</section>
      </>}
      {error&&tab!=='table'&&<p className="error" role="alert">{error}</p>}
    </aside></div>
    <nav className="mobile-nav" aria-label="主导航">{[['table','牌桌'],['room','房间'],['history','记录']].map(([value,label])=><button key={value} className={tab===value?'selected':''} onClick={()=>setTab(value)}>{label}</button>)}</nav>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
