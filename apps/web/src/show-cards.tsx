import type { RoomView } from '../../server/room';
import { Card } from './card';

export function ShowCards({hand,me,expiresAt,now,disabled,command}:{hand:NonNullable<RoomView['hand']>;me:number;expiresAt:number;now:number;disabled:boolean;command:(type:string,data?:Record<string,unknown>)=>Promise<boolean>}) {
  const p=hand.players.find(p=>p.id===me);if(!p?.cards.length)return null;
  const seconds=Math.max(0,Math.ceil((expiresAt-now)/1000));
  return <div className="show-cards"><div>{p.cards.map((c,i)=><button key={i} aria-label={p.shown.includes(i)?`第 ${i+1} 张已秀出`:`秀第 ${i+1} 张底牌`} disabled={disabled||!seconds||p.shown.includes(i)} onClick={()=>command('showCards',{handId:hand.id,indices:[i]})}><Card value={c}/><small>{p.shown.includes(i)?'已秀':'秀牌'}</small></button>)}</div>{p.shown.length<2&&seconds>0&&<button className="quiet" disabled={disabled} onClick={()=>command('showCards',{handId:hand.id,indices:[0,1]})}>秀两张 · {seconds}s</button>}</div>;
}
