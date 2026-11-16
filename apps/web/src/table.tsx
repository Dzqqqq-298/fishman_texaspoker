import { useEffect, useState, type CSSProperties } from 'react';
import type { RoomView } from '../../server/room';
import { Card } from './card';
import { Overlay } from './overlay';
import { matchTime } from './lobby';
import { seatPosition } from './seat-layout';
import './table.css';

const num=(n:number)=>n.toLocaleString('zh-CN');
type Command=(type:string,data?:Record<string,unknown>)=>Promise<boolean>;
type Props={room:RoomView;now:number;disabled:boolean;error:string;command:Command;clearError:()=>void;onEdit:()=>void};
function ToolIcon({kind}:{kind:'settings'|'history'}) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{kind==='settings'?<><path d="M4 7h16M4 17h16"/><rect x="7" y="4" width="4" height="6" rx="1" fill="var(--table-dark)"/><rect x="14" y="14" width="4" height="6" rx="1" fill="var(--table-dark)"/></>:<><path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/></>}</svg>;
}

export function PokerTable({room,now,disabled,error,command,clearError,onEdit}:Props) {
  const [panel,setPanel]=useState<'settings'|'history'|'buyin'|null>(null);
  const [selectedSeat,setSelectedSeat]=useState<number|null>(null);
  const [amount,setAmount]=useState(String(room.config.defaultBuyIn));
  const [raise,setRaise]=useState('');
  const [ledger,setLedger]=useState<{amount:number;kind:string;at:string}[]>([]);
  const [ledgerError,setLedgerError]=useState('');
  const [ledgerLoading,setLedgerLoading]=useState(false);
  const {me,config,hand,match}=room;
  const seat=room.seats.find(p=>p.id===me.id),player=hand?.players.find(p=>p.id===me.id);
  const playing=!!hand&&hand.street!=='finished',legal=hand?.legal;
  const host=room.hostId===me.id||!!me.admin;
  const remaining=room.deadline?Math.max(0,Math.ceil((room.deadline-now)/1000)):0;
  // Preserve pre-upgrade seat IDs if an older room reduced capacity around a gap.
  const capacity=Math.max(config.maxPlayers,...room.seats.map(p=>p.seat+1));
  const selectedTaken=selectedSeat!==null&&room.seats.some(p=>p.seat===selectedSeat);
  const buyInLimit=seat?Math.max(0,config.maxBuyIn-seat.stack):config.maxBuyIn;
  const buyInMax=Math.min(me.balance,buyInLimit),buyInMin=seat?1:config.minBuyIn;
  const buyInReason=match?.endRequested?'房间正在结束':selectedTaken?'座位已有人，请另选':playing?'本手结束后可操作':seat&&!config.allowTopup?'本房间禁止追加':!seat&&match?.startedAt!==null&&!config.allowLateJoin?'本房间禁止中途加入':!seat&&room.squid?'鱿鱼本轮结束后可入座':buyInMax<buyInMin?'可用积分或带入额度不足':'';
  useEffect(()=>setRaise(String(legal?.minTo??'')),[hand?.actor,hand?.currentBet,hand?.street]);
  useEffect(()=>{
    if(panel!=='history')return;
    const controller=new AbortController();setLedgerLoading(true);setLedgerError('');
    fetch('/api/ledger',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('流水加载失败');return r.json();}).then(setLedger).catch(e=>{if(e.name!=='AbortError')setLedgerError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLedgerLoading(false);});
    return()=>controller.abort();
  },[panel,me.balance,hand?.street]);
  function open(next:'settings'|'history') {clearError();setPanel(next);}
  function openBuyIn(index:number|null) {clearError();setSelectedSeat(index);setAmount(String(Math.min(config.defaultBuyIn,buyInMax)));setPanel('buyin');}
  async function endRoom() {
    if(window.confirm(playing?'结束比赛？打完本手后结算。':'关闭房间并退回筹码？')&&await command('endRoom'))setPanel(null);
  }
  if(!match)return null;
  return <main className="poker-room">
    <header className="poker-heading"><div className="poker-title"><h1>{match.name}</h1><div className="poker-meta"><span>盲注 {config.smallBlind}/{config.bigBlind}</span><span>{room.seats.length}/{config.maxPlayers} 人</span><span className={match.endRequested?'ending':''}>{matchTime(room,now)}</span></div></div><nav className="table-tools" aria-label="牌桌工具">
      <button onClick={()=>open('settings')} aria-haspopup="dialog" aria-expanded={panel==='settings'}><ToolIcon kind="settings"/><span>设置</span></button>
      <button onClick={()=>open('history')} aria-haspopup="dialog" aria-expanded={panel==='history'}><ToolIcon kind="history"/><span>记录</span></button>
    </nav></header>

    <section className="poker-stage" aria-label="牌桌">
      <div className="poker-felt" aria-hidden="true"><div/><span>鱼人德州</span></div>
      <div className="table-center">
        {hand?<><div className="pot-total"><span>{playing?'底池':'本手底池'}</span><strong>{num(hand.pot)}</strong></div><div className="community-cards" aria-label="公共牌">{Array.from({length:5},(_,i)=><Card key={i} value={hand.board[i]} empty/>)}</div>
          {playing?<span className="street-name">{{preflop:'翻牌前',flop:'翻牌',turn:'转牌',river:'河牌',finished:''}[hand.street]}</span>:<div className="pot-results">{hand.pots.filter(p=>!p.returned).map((p,i)=><span key={i}>{p.winners.map(id=>hand.players.find(x=>x.id===id)?.name).join(' / ')} <b>+{num(p.amount)}</b></span>)}</div>}</>:<div className="table-idle"><span>盲注 {config.smallBlind}/{config.bigBlind}</span>{host?<button className="primary" disabled={disabled||room.seats.filter(p=>p.online&&!p.sittingOut&&p.stack>0).length<2} onClick={()=>command('start')}>开始比赛</button>:<span>待开赛</span>}</div>}
        {room.pausedForRecovery&&<span className="stage-notice">等待房主恢复</span>}
      </div>
      {Array.from({length:capacity},(_,index)=>{
        const p=room.seats.find(p=>p.seat===index),position=seatPosition(index,capacity,seat?.seat??null);
        const style={'--seat-x':`${position.left}%`,'--seat-y':`${position.top}%`,'--seat-mobile-x':`${position.mobileLeft}%`,'--seat-mobile-y':`${position.mobileTop}%`} as CSSProperties;
        if(!p)return <button key={index} style={style} className="table-seat empty-seat" aria-label={`${index+1} 号空座，点击入座`} disabled={disabled||!!seat||match.endRequested||index>=config.maxPlayers} onClick={()=>openBuyIn(index)}><span className="seat-plus" aria-hidden="true">＋</span><span>空座</span><small>{index+1}</small></button>;
        const hp=hand?.players.find(x=>x.id===p.id),active=playing&&hand?.actor===p.id,mine=p.id===me.id;
        return <div key={index} style={style} className={`table-seat player-seat ${mine?'self-seat':''} ${active?'acting':''} ${playing&&hp?.folded?'has-folded':''}`} aria-label={`${index+1} 号座位 ${p.name}`}>
          {active&&<span className="seat-timer">{room.pausedForRecovery?'暂停':`${remaining}s`}</span>}
          <div className="player-avatar">{p.name.slice(0,1)}{hp&&hand?.button===p.seat&&<span className="dealer-chip">D</span>}{room.squid?.marked.includes(p.id)&&<span className="squid-token" aria-label="鱿鱼标记">◆</span>}</div>
          <span className="player-name" title={p.name}>{p.name}</span><b className="player-stack">{num(playing&&hp?hp.stack:p.stack)}</b>
          <span className="player-action">{!p.online?'离线':p.sittingOut?'暂离':hp?.action??''}</span>
          {!mine&&!!hp?.cards.length&&<div className={`seat-cards ${position.left>50?'cards-left':''}`}>{hp.cards.map(c=><Card key={c} value={c}/>)}</div>}
        </div>;
      })}
    </section>

    <footer className="play-dock">
      {!!player?.cards.length&&<div className="private-cards" aria-label="你的手牌"><div>{player.cards.map(c=><Card key={c} value={c}/>)}</div>{player.handName&&<span>{player.handName}</span>}</div>}
      {error&&!panel&&<p className="error" role="alert">{error}</p>}
      {legal&&!room.pausedForRecovery?<div className="bet-controls">
        <div className="raise-row"><label>加注到<input aria-label="加注到" type="number" inputMode="numeric" min={Math.min(legal.minTo,legal.maxTo)} max={legal.maxTo} value={raise} onChange={e=>setRaise(e.target.value)} disabled={disabled||!legal.canRaise}/></label><button disabled={disabled||!legal.canRaise} onClick={()=>setRaise(String(legal.minTo))}>最小</button><button disabled={disabled||!legal.canRaise} onClick={()=>setRaise(String(legal.maxTo))}>全下</button><button className="time-card" disabled={disabled||me.timeCards===0||room.timeExtended||room.timeArmed===me.id} onClick={()=>command('time')}>{room.timeExtended?'已延时':room.timeArmed===me.id?'已预备':'时间卡 +30s'}</button></div>
        <div className="action-buttons"><button className="fold" disabled={disabled} onClick={()=>command('action',{action:'fold'})}>弃牌</button><button disabled={disabled} onClick={()=>command('action',{action:legal.canCheck?'check':'call'})}>{legal.canCheck?'过牌':`跟注 ${num(legal.toCall)}`}</button><button className="primary" disabled={disabled||!legal.canRaise} onClick={()=>{if(Number(raise)===legal.maxTo&&!window.confirm(`全下 ${num(legal.maxTo)}？`))return;void command('action',{action:'raise',amount:Number(raise)});}}>加注</button></div>
      </div>:<div className="dock-idle">{host&&(room.pausedForRecovery||hand&&!playing&&!room.running)&&<button className="primary" disabled={disabled||(match.endRequested&&!room.pausedForRecovery)} onClick={()=>command('start')}>{room.pausedForRecovery?'恢复牌局':'继续比赛'}</button>}{seat&&<button className="quiet" disabled={disabled||playing||!config.allowTopup||match.endRequested} onClick={()=>openBuyIn(null)}>补充筹码</button>}{!seat&&<span>点击空座入座</span>}</div>}
    </footer>

    {panel==='buyin'&&<Overlay title={seat?'补充筹码':`${(selectedSeat??0)+1} 号座位`} kind="sheet" onClose={()=>setPanel(null)}>
      <form className="buyin-form" onSubmit={async e=>{e.preventDefault();if(!buyInReason&&await command(seat?'topup':'sit',{amount:Number(amount),...(!seat?{seat:selectedSeat}:{})}))setPanel(null);}}>
        <div className="buyin-balance"><span>可用积分</span><b>{num(me.balance)}</b></div>
        <label>带入金额<input autoFocus type="number" inputMode="numeric" required min={buyInMin} max={buyInMax} value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <div className="presets">{[...new Set([config.defaultBuyIn,config.defaultBuyIn*2,buyInMax])].filter(n=>n>=buyInMin&&n<=buyInMax).map(n=><button type="button" key={n} onClick={()=>setAmount(String(n))}>{num(n)}</button>)}</div>
        <small className="muted">{num(buyInMin)}～{num(Math.max(buyInMin,buyInMax))}</small>
        {buyInReason&&<p className="field-help" role="status">{buyInReason}</p>}{error&&<p className="error" role="alert">{error}</p>}
        <button className="primary wide" disabled={disabled||!!buyInReason}>{disabled?'处理中…':seat?'确认带入':'确认入座'}</button>
      </form>
    </Overlay>}

    {panel==='settings'&&<Overlay title="设置" onClose={()=>setPanel(null)}>
      <section className="drawer-section"><h3>房间规则</h3><dl className="room-rules"><div><dt>盲注</dt><dd>{config.smallBlind}/{config.bigBlind}</dd></div><div><dt>带入</dt><dd>{num(config.minBuyIn)}～{num(config.maxBuyIn)}</dd></div><div><dt>Straddle</dt><dd>{config.straddleMax?`最高 ${config.straddleMax}BB`:'关闭'}</dd></div><div><dt>鱿鱼</dt><dd>{config.squidEnabled?`${config.squidUnit} 积分`:'关闭'}</dd></div><div><dt>行动时间</dt><dd>25s</dd></div></dl>{room.squid&&<p className="field-help">鱿鱼标记 {room.squid.marked.length}/{room.squid.participants.length}</p>}</section>
      {seat&&<section className="drawer-section"><h3>我的座位</h3><label className="switch"><input type="checkbox" checked={seat.straddle} disabled={disabled||match.endRequested} onChange={e=>command('straddle',{enabled:e.target.checked})}/>自动 Straddle</label><label className="switch"><input type="checkbox" checked={seat.sittingOut} disabled={disabled||match.endRequested} onChange={e=>command('away',{enabled:e.target.checked})}/>下一手暂离</label><div className="host-actions"><button disabled={disabled||playing||!config.allowTopup||match.endRequested} onClick={()=>openBuyIn(null)}>补充筹码</button><button disabled={disabled||playing||match.endRequested} onClick={async()=>{if(room.squid&&!confirm('离桌将结算本轮鱿鱼，继续？'))return;if(await command('leave'))setPanel(null);}}>离桌</button></div></section>}
      {host&&<section className="drawer-section"><h3>房主控制</h3><div className="host-actions"><button className="primary" disabled={disabled||(playing&&!room.pausedForRecovery)||(match.endRequested&&!room.pausedForRecovery)} onClick={async()=>{if(await command('start'))setPanel(null);}}>{room.pausedForRecovery?'恢复牌局':match.startedAt?'继续比赛':'开始比赛'}</button><button disabled={disabled||!room.running||match.endRequested} onClick={()=>command('pause')}>本手后暂停</button></div><button disabled={disabled||match.startedAt!==null} onClick={()=>{setPanel(null);onEdit();}}>编辑规则</button>{room.squid&&<button disabled={disabled||playing||match.endRequested} onClick={()=>command('squidEnd')}>结算鱿鱼</button>}<button className="danger-text" disabled={disabled||match.endRequested} onClick={endRoom}>{match.startedAt?'结束比赛':'解散房间'}</button></section>}
      {error&&<p className="error" role="alert">{error}</p>}
    </Overlay>}

    {panel==='history'&&<Overlay title="记录" onClose={()=>setPanel(null)}>
      <section className="drawer-section"><h3>本场战绩 <small>已结算</small></h3><div className="results-scroll"><table className="session-results"><thead><tr><th>玩家</th><th>带入</th><th>手数</th><th>盈亏</th></tr></thead><tbody>{match.players.map(p=>{const profit=p.cashOut+(room.seats.find(s=>s.id===p.id)?.stack??0)-p.buyIn+p.squidProfit;return <tr key={p.id}><td>{p.name}</td><td>{num(p.buyIn)}</td><td>{p.hands}</td><td className={profit>=0?'positive':'negative'}>{profit>0?'+':''}{num(profit)}</td></tr>;})}</tbody></table>{!match.players.length&&<p className="field-help">暂无战绩</p>}</div></section>
      <section className="drawer-section"><h3>本手记录</h3><div className="log">{hand?.log.length?hand.log.map((line,i)=><p key={i}>{line}</p>):<p>暂无记录</p>}</div></section>
      <details className="drawer-section"><summary>积分流水</summary>{ledgerLoading?<p className="field-help">加载中…</p>:ledgerError?<p role="alert" className="error">{ledgerError}</p>:ledger.length?ledger.map((l,i)=><div className="ledger-row" key={i}><span>{l.kind}<small>{l.at} UTC</small></span><b className={l.amount>=0?'positive':''}>{l.amount>0?'+':''}{num(l.amount)}</b></div>):<p className="field-help">暂无流水</p>}</details>
      <details className="drawer-section"><summary>房间动态</summary><div className="log">{room.notices.map((n,i)=><p key={i}>{n}</p>)}</div></details>
    </Overlay>}
  </main>;
}
