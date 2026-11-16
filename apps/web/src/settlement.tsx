import { useState } from 'react';
import type { MatchResult } from '../../../packages/game-engine/room-config';
import type { RoomView } from '../../server/room';
import { HandHistory } from './hand-history';
import { ShowCards } from './show-cards';

export function Settlement({result,room,now,disabled,error,command,onClose}:{result:MatchResult;room:RoomView;now:number;disabled:boolean;error:string;command:(type:string,data?:Record<string,unknown>)=>Promise<boolean>;onClose:()=>void}) {
  const [history,setHistory]=useState(false),me=result.players.find(p=>p.id===room.me.id);
  const last=room.lastCompleted?.matchId===result.id?room.lastCompleted:null;
  return <main className="settlement"><header><div><h1>本场结算</h1><p>{result.name} · {result.handCount} 手</p></div><button onClick={onClose}>返回大厅</button></header>
    <div className="settlement-score"><span>我的盈亏</span><strong className={(me?.profit??0)>=0?'positive':'negative'}>{(me?.profit??0)>0?'+':''}{(me?.profit??0).toLocaleString()}</strong><small>{result.reason} · 积分已到账</small></div>
    <div className="results-scroll"><table className="session-results"><thead><tr><th>玩家</th><th>带入</th><th>退回</th><th>鱿鱼</th><th>盈亏</th></tr></thead><tbody>{result.players.map(p=><tr key={p.id}><td>{p.name}{p.id===room.me.id?' · 我':''}</td><td>{p.buyIn.toLocaleString()}</td><td>{p.cashOut.toLocaleString()}</td><td>{p.squidProfit.toLocaleString()}</td><td className={p.profit>=0?'positive':'negative'}>{p.profit>0?'+':''}{p.profit.toLocaleString()}</td></tr>)}</tbody></table></div>
    {last&&<ShowCards hand={last.hand} me={room.me.id} expiresAt={last.expiresAt} now={now} disabled={disabled} command={command}/>}{error&&<p className="error" role="alert">{error}</p>}
    <button className="wide" aria-expanded={history} onClick={()=>setHistory(v=>!v)}>{history?'收起牌谱':'本场牌谱'}</button>{history&&<HandHistory matchId={result.id} refreshKey={room.version}/>}
  </main>;
}
