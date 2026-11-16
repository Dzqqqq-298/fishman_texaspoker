import type {RoomView} from '../../server/room';

export function EntryChoice({value,onChange,big,small}:{value:'wait'|'post';onChange:(v:'wait'|'post')=>void;big:number;small:number}) {
  return <fieldset className="entry-choice"><legend>入局方式</legend><div>
    <button type="button" aria-pressed={value==='wait'} onClick={()=>onChange('wait')}>等大盲</button>
    <button type="button" aria-pressed={value==='post'} onClick={()=>onChange('post')}>补盲入局 · {big+small}</button>
  </div>{small>0&&<small>大盲 {big} 可抵跟注，小盲 {small} 直接入池</small>}</fieldset>;
}

export function EntryControls({room,disabled,command}:{room:RoomView;disabled:boolean;command:(type:string,data?:Record<string,unknown>)=>Promise<boolean>}) {
  const seat=room.seats.find(p=>p.id===room.me.id),entry=room.entry;
  if(!seat||!entry||entry.mode==='ready'||room.match?.endRequested)return null;
  const big=entry.big?room.config.bigBlind:0,small=entry.small?room.config.smallBlind:0;
  const needed=(entry.big?room.config.bigBlind:1)+small;
  return <section className="entry-controls" aria-label="入局等待"><div aria-live="polite"><b>{entry.mode==='wait'?'等待大盲入局':'已选补盲入局'}</b><small>{entry.mode==='post'&&seat.stack<needed?'筹码不足，请补充筹码或等大盲':entry.mode==='post'?`下一手补盲 ${big+small}`:room.nextDeal?.big===seat.id?'下一手轮到你交大盲':'未轮到大盲不发牌'}</small></div><div>
    {entry.mode==='wait'?<button disabled={disabled||seat.stack<needed} onClick={()=>command('entry',{entryMode:'post'})}>补盲入局 · {big+small}</button>:<button disabled={disabled} onClick={()=>command('entry',{entryMode:'wait'})}>改为等大盲</button>}
  </div></section>;
}
