import { useEffect, useState } from 'react';
import type { HandRecord } from '../../../packages/game-engine/records';
import { Card } from './card';

export function HandHistory({matchId,refreshKey}:{matchId:string;refreshKey?:unknown}) {
  const [hands,setHands]=useState<(HandRecord&{cursor:number})[]>([]),[selected,setSelected]=useState<string|null>(null);
  const [cursor,setCursor]=useState<number|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    fetch(`/api/hands?matchId=${encodeURIComponent(matchId)}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('牌谱加载失败');return r.json();}).then(d=>{setHands(d.hands);setCursor(d.nextCursor);setSelected(old=>d.hands.some((h:HandRecord)=>h.id===old)?old:d.hands[0]?.id??null);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[matchId,refreshKey]);
  async function more(){if(!cursor)return;setLoading(true);try{const r=await fetch(`/api/hands?matchId=${encodeURIComponent(matchId)}&before=${cursor}`);if(!r.ok)throw new Error('牌谱加载失败');const d=await r.json();setHands(old=>[...old,...d.hands]);setCursor(d.nextCursor);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  const index=hands.findIndex(h=>h.id===selected),hand=hands[index];
  return <section className="hand-history"><div className="history-pager"><button disabled={index<0||index>=hands.length-1} onClick={()=>setSelected(hands[index+1].id)}>上一手</button><select aria-label="选择手牌" value={selected??''} onChange={e=>setSelected(e.target.value)}>{hands.map(h=><option key={h.id} value={h.id}>第 {h.number||h.cursor} 手</option>)}</select><button disabled={index<=0} onClick={()=>setSelected(hands[index-1].id)}>下一手</button></div>
    {error&&<p className="error" role="alert">{error}</p>}{loading&&!hand&&<p className="field-help">加载中…</p>}{!loading&&!hands.length&&<p className="field-help">暂无已完成手牌</p>}
    {hand&&<><div className="history-boards">{hand.boards.map((board,i)=><div key={i}>{hand.boards.length>1&&<small>第 {i+1} 次</small>}<div>{Array.from({length:5},(_,j)=><Card key={j} value={board[j]} empty/>)}</div></div>)}</div>
      <div className="history-players">{hand.players.map(p=><div key={p.id}><span>{p.name}</span><div className="history-hole">{p.publicCards.map((c,i)=><Card key={i} value={c??undefined}/>)}</div><small>{p.publicCards.every(c=>!c)?'未秀牌':p.folded?'弃牌后秀牌':'已秀牌'}</small><b className={p.profit>=0?'positive':'negative'}>{p.profit>0?'+':''}{p.profit.toLocaleString()}</b></div>)}</div>
      <div className="history-pots">{hand.pots.filter(p=>!p.returned).map((p,i)=><p key={i}>{p.board!==undefined?`第 ${p.board+1} 次 · `:''}{hand.players.filter(x=>p.winners.includes(x.id)).map(x=>x.name).join(' / ')} <b>+{p.amount.toLocaleString()}</b></p>)}</div>
      <details className="history-actions"><summary>下注过程</summary><div className="log">{hand.log.map((line,i)=><p key={i}>{line}</p>)}</div></details>
    </>}{cursor&&<button disabled={loading} onClick={more}>{loading?'加载中…':'更早的牌谱'}</button>}
  </section>;
}
