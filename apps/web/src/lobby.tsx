import React, { useState } from 'react';
import type { RoomView } from '../../server/room';
import { DEFAULT_ROOM_CONFIG, type RoomConfig, type MatchResult } from '../../../packages/game-engine/room-config';

const num=(n:number)=>n.toLocaleString('zh-CN');
export const phaseNames={empty:'暂无房间',waiting:'等待开赛',running:'进行中',paused:'已暂停',ending:'本手后结束'};
export function matchTime(room:RoomView,now:number) {
  const m=room.match;if(!m)return '';
  if(m.endRequested)return '本手后结束';
  if(m.startedAt===null)return room.config.durationMinutes?`${room.config.durationMinutes} 分钟`:'不限时';
  if(m.endsAt===null)return '不限时';
  const seconds=Math.max(0,Math.ceil((m.endsAt-now)/1000));
  if(!seconds)return '到时 · 本手后结束';
  return `剩余 ${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds%3600/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
}

export function RoomSetupForm({initial,name,edit=false,busy,onSubmit,onCancel}:{initial?:RoomConfig;name:string;edit?:boolean;busy:boolean;onSubmit:(data:Record<string,unknown>)=>void;onCancel:()=>void}) {
  const [config,setConfig]=useState<RoomConfig>({...DEFAULT_ROOM_CONFIG,...initial});
  const [roomName,setName]=useState(name);
  const update=<K extends keyof RoomConfig>(key:K,value:RoomConfig[K])=>setConfig(c=>({...c,[key]:value}));
  return <form className="room-setup" onSubmit={e=>{e.preventDefault();onSubmit({name:roomName,...config});}}>
    <div className="setup-heading"><div><h1>{edit?'房间设置':'创建房间'}</h1></div><button type="button" className="quiet" onClick={onCancel}>返回</button></div>
    <section className="setup-section"><div className="section-title"><span>01</span><div><h2>基本设置</h2></div></div>
      {!edit&&<label>房间名称<input required maxLength={24} value={roomName} onChange={e=>setName(e.target.value)} placeholder="例如：周末好友局"/></label>}
      <div className="form-pair"><label>人数上限<select value={config.maxPlayers} onChange={e=>update('maxPlayers',Number(e.target.value))}>{Array.from({length:10},(_,i)=>i+2).map(n=><option key={n} value={n}>{n} 人</option>)}</select></label><label>比赛时长<select value={config.durationMinutes} onChange={e=>update('durationMinutes',Number(e.target.value))}>{[30,60,90,120,180,240,360,720,0].map(n=><option key={n} value={n}>{n?`${n} 分钟`:'不限时 / 手动结束'}</option>)}</select></label></div>
      <p className="field-help">开赛计时，暂停不停表；到时打完本手。</p>
    </section>
    <section className="setup-section"><div className="section-title"><span>02</span><div><h2>盲注与带入</h2></div></div>
      <div className="form-pair"><label>小盲<input type="number" required min={1} max={10000} value={config.smallBlind} onChange={e=>update('smallBlind',Number(e.target.value))}/></label><label>大盲<input type="number" required min={1} max={10000} value={config.bigBlind} onChange={e=>update('bigBlind',Number(e.target.value))}/></label></div>
      <label>默认带入<input type="number" required min={config.minBuyIn} max={config.maxBuyIn} value={config.defaultBuyIn} onChange={e=>update('defaultBuyIn',Number(e.target.value))}/></label>
      <div className="preset-line">快捷盲注{[[5,10],[10,20],[25,50],[50,100]].map(([sb,bb])=><button type="button" key={bb} className={config.bigBlind===bb?'selected':''} onClick={()=>setConfig(c=>({...c,smallBlind:sb,bigBlind:bb}))}>{sb}/{bb}</button>)}</div>
    </section>
    <section className="setup-section"><div className="section-title"><span>03</span><div><h2>特色玩法</h2><p>开赛后锁定规则</p></div></div>
      <label>连续 Straddle<select value={config.straddleMax} onChange={e=>update('straddleMax',Number(e.target.value))}>{[0,2,4,8,16].map(n=><option key={n} value={n}>{n?`接力最高 ${n}BB`:'关闭'}</option>)}</select></label>
      <label className="setting-toggle"><span><b>鱿鱼</b><small>赢主池得标记，最后无标记者付分。</small></span><input type="checkbox" checked={config.squidEnabled} onChange={e=>update('squidEnabled',e.target.checked)}/></label>
      {config.squidEnabled&&<label>向每位有标记者支付<input type="number" required min={1} max={10000} value={config.squidUnit} onChange={e=>update('squidUnit',Number(e.target.value))}/><small className="field-help">至少 3 人；每人最多预留 {(config.maxPlayers-1)*config.squidUnit} 积分。</small></label>}
      <div className="fixed-rule"><span>行动时间 <b>25 秒</b></span><span>时间卡 <b>每张 +30 秒</b></span></div>
    </section>
    <details className="setup-section advanced"><summary>高级选项</summary><div className="advanced-content">
      <div className="form-pair"><label>最低带入<input required type="number" min={config.bigBlind} value={config.minBuyIn} onChange={e=>update('minBuyIn',Number(e.target.value))}/></label><label>最高带入<input required type="number" min={config.defaultBuyIn} max={1000000000} value={config.maxBuyIn} onChange={e=>update('maxBuyIn',Number(e.target.value))}/></label></div>
      <label className="setting-toggle"><span><b>允许追加带入</b><small>手间追加，不超过最高带入。</small></span><input type="checkbox" checked={config.allowTopup} onChange={e=>update('allowTopup',e.target.checked)}/></label>
      <label className="setting-toggle"><span><b>允许中途加入</b><small>手间入座；鱿鱼需等本轮结束。</small></span><input type="checkbox" checked={config.allowLateJoin} onChange={e=>update('allowLateJoin',e.target.checked)}/></label>
    </div></details>
    <div className="setup-submit"><p>{config.maxPlayers} 人桌 · {config.smallBlind}/{config.bigBlind} 盲注 · {config.durationMinutes?`${config.durationMinutes} 分钟`:'不限时'}</p><button className="primary" disabled={busy}>{busy?'正在保存…':edit?'保存':'创建房间'}</button></div>
  </form>;
}

function Results({match,me}:{match:MatchResult;me:number}) {
  return <details className="match-result"><summary><span><b>{match.name}</b><small>{new Date(match.endedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · {match.handCount} 手</small></span><span className="tag">{match.reason}</span></summary><div className="results-scroll"><table><thead><tr><th>玩家</th><th>累计带入</th><th>退回筹码</th><th>鱿鱼盈亏</th><th>总盈亏</th></tr></thead><tbody>{match.players.length?match.players.map(p=><tr key={p.id}><td>{p.name}{p.id===me?' · 我':''}</td><td>{num(p.buyIn)}</td><td>{num(p.cashOut)}</td><td>{p.squidProfit>0?'+':''}{num(p.squidProfit)}</td><td className={p.profit>=0?'positive':'negative'}>{p.profit>0?'+':''}{num(p.profit)}</td></tr>):<tr><td colSpan={5}>无带入记录</td></tr>}</tbody></table></div></details>;
}

export function Lobby({room,now,disabled,onCreate,onEnter,onEnd,accountPanel}:{room:RoomView;now:number;disabled:boolean;onCreate:()=>void;onEnter:()=>void;onEnd:()=>void;accountPanel:React.ReactNode}) {
  const match=room.match,host=room.hostId===room.me.id||!!room.me.admin;
  const owner=room.hostName;
  return <main className="lobby"><header className="lobby-heading"><h1>大厅</h1></header>
    <div className={`lobby-columns ${accountPanel?'':'lobby-wide'}`}><div>
      <div className="lobby-section-heading"><h2>当前房间</h2></div>
      {match?<section className={`room-card ${room.phase==='ending'?'ending':''}`}>
        <div className="room-card-head"><span className="room-icon" aria-hidden="true">♠</span><div><span className={`room-phase ${room.phase}`}>{phaseNames[room.phase]}</span><h2>{match.name}</h2><p>{room.hostId===room.me.id?'你是房主':owner?`房主 · ${owner}`:'好友房'}</p></div></div>
        <div className="room-facts"><div><span>盲注</span><b>{room.config.smallBlind} / {room.config.bigBlind}</b></div><div><span>入座人数</span><b>{room.seats.length} / {room.config.maxPlayers}</b></div><div><span>默认带入</span><b>{num(room.config.defaultBuyIn)}</b></div></div>
        <div className="room-clock"><span aria-hidden="true">◷</span><b>{matchTime(room,now)}</b><small>已完成 {match.handCount} 手</small></div>
        <div className="rule-tags"><span>{room.config.straddleMax?`Straddle ${room.config.straddleMax}BB`:'无 Straddle'}</span><span>{room.config.squidEnabled?`鱿鱼 ${num(room.config.squidUnit)} 积分`:'鱿鱼关闭'}</span><span>25 秒行动</span><span>{room.config.allowTopup?'允许追加':'禁止追加'}</span></div>
        <div className="room-members">{room.seats.length?room.seats.map(p=><span key={p.id} title={`${p.name}${p.online?' · 在线':' · 离线'}`} className={!p.online?'offline':''}>{p.name.slice(0,1)}</span>):<p className="muted">暂无玩家</p>}</div>
        <div className="room-card-actions"><button className="primary" disabled={disabled} onClick={onEnter}>{room.seats.some(p=>p.id===room.me.id)?'返回牌桌':'进入房间'} <span>↗</span></button>{host&&<button className="quiet danger-text" disabled={disabled||match.endRequested} onClick={onEnd}>{match.startedAt===null?'解散房间':'结束比赛'}</button>}</div>
        {room.seats.some(p=>p.id===room.me.id)&&<p className="field-help">已入座 · 返回大厅不离桌</p>}
      </section>:<section className="empty-room"><div className="empty-table" aria-hidden="true"><span>♠</span><i/><i/><i/></div><h2>暂无房间</h2><button className="primary" disabled={disabled} onClick={onCreate}>＋ 创建房间</button></section>}
      <section className="match-history"><div className="lobby-section-heading"><h2>最近战绩</h2><span className="muted">最近 5 场</span></div>{room.recentMatches.length?room.recentMatches.map(m=><Results key={m.id} match={m} me={room.me.id}/>):<div className="history-empty">暂无战绩</div>}</section>
    </div>{accountPanel&&<aside className="lobby-side">{accountPanel}</aside>}</div>
  </main>;
}
