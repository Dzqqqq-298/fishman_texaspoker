import type { RoomView } from '../../server/room';

export function StraddlePrompt({room,disabled,command}:{room:RoomView;disabled:boolean;command:(type:string,data?:Record<string,unknown>)=>Promise<boolean>}) {
  const plan=room.nextStraddle,offer=plan?.chain.find(p=>p.id===room.me.id);
  if(!plan||!offer)return null;
  const label=offer.multiple===2?'Straddle':'Double Straddle';
  const choose=(enabled:boolean)=>command('straddle',{planKey:plan.key,amount:offer.amount,enabled});
  return <section className={`straddle-prompt ${offer.status}`} aria-label="下一手 Straddle">
    <div aria-live="polite"><span>下一手 · {offer.multiple}BB</span><b>{offer.status==='accepted'?`已预约 ${offer.amount.toLocaleString()}`:offer.status==='declined'?'已跳过':offer.status==='insufficient'?'筹码不足':label}</b></div>
    <div className="straddle-choices">
      {offer.status==='accepted'?<button className="quiet" disabled={disabled} onClick={()=>choose(false)}>取消预约</button>:offer.status!=='insufficient'&&<>
        <button className="primary" disabled={disabled} onClick={()=>choose(true)}>{label} {offer.amount.toLocaleString()}</button>
        {offer.status==='offer'&&<button className="quiet" disabled={disabled} onClick={()=>choose(false)}>跳过</button>}
      </>}
    </div>
  </section>;
}
