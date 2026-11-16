import { useEffect, useState } from 'react';
import type { RoomView } from '../../server/room';

export function BetControls({room,disabled,command}:{room:RoomView;disabled:boolean;command:(type:string,data?:Record<string,unknown>)=>Promise<boolean>}) {
  const h=room.hand!,legal=h.legal!,p=h.players.find(p=>p.id===room.me.id)!;
  const [expanded,setExpanded]=useState(false),[amount,setAmount]=useState(String(legal.minTo));
  const min=Math.min(legal.minTo,legal.maxTo),max=legal.maxTo;
  useEffect(()=>{setExpanded(false);setAmount(String(Math.min(legal.minTo,legal.maxTo)));},[h.id,h.actor,h.currentBet,h.street]);
  const valid=Number.isSafeInteger(Number(amount))&&Number(amount)>=min&&Number(amount)<=max;
  const clamp=(v:number)=>Math.max(min,Math.min(max,Math.round(v)));
  const preset=(fraction:number)=>clamp(p.bet+legal.toCall+(h.pot+legal.toCall)*fraction);
  return <div className="bet-controls">
    {expanded&&<form className="raise-panel" onSubmit={async e=>{e.preventDefault();if(!valid)return;if(Number(amount)===max&&!confirm(`全下，加注到 ${max.toLocaleString()}？`))return;if(await command('action',{action:'raise',amount:Number(amount)}))setExpanded(false);}}>
      <label>加注到<input aria-label="加注到" type="number" inputMode="numeric" min={min} max={max} step={1} required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <input type="range" aria-label="加注滑杆" min={min} max={max} step={1} value={valid?amount:min} onChange={e=>setAmount(e.target.value)}/>
      <div className="bet-presets">{[['最小',min],['1/3',preset(1/3)],['1/2',preset(.5)],['2/3',preset(2/3)],['底池',preset(1)],['全下',max]].map(([label,n])=><button type="button" key={label} disabled={disabled} onClick={()=>setAmount(String(n))}>{label}</button>)}</div>
      <button className="primary" disabled={disabled||!valid}>确认加注 {valid?Number(amount).toLocaleString():''}</button>
    </form>}
    <div className="action-buttons"><button className="fold" disabled={disabled} onClick={()=>command('action',{action:'fold'})}>弃牌</button><button disabled={disabled} onClick={()=>command('action',{action:legal.canCheck?'check':'call'})}>{legal.canCheck?'过牌':`跟注 ${legal.toCall.toLocaleString()}`}</button><button className="primary" disabled={disabled||!legal.canRaise} aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'收起加注':'加注'}</button></div>
    <button className="time-card quiet" disabled={disabled||room.me.timeCards===0||room.timeExtended||room.timeArmed===room.me.id} onClick={()=>command('time')}>{room.timeExtended?'已延时':room.timeArmed===room.me.id?'已预备时间卡':'时间卡 +30s'}</button>
  </div>;
}
