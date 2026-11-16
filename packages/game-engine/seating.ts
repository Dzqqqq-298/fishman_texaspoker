export type EntryMode='ready'|'wait'|'post';
export interface BlindAccount {small:boolean;big:boolean;mode:EntryMode;lastSeat:number}
export interface DealSeat {id:number;seat:number;stack:number;sittingOut:boolean;online:boolean;blind:BlindAccount}
const distance=(from:number,to:number)=>(to-from+11)%11||11;
export function crossedSeat(from:number,to:number,seat:number) {
  return from!==to&&distance(from,seat)<=distance(from,to);
}
// Waiting players participate in finding the next BB, but never move the button or take the SB.
export function planSeats<T extends DealSeat>(seats:T[],previousButton:number,bb:number,sb:number) {
  const available=seats.filter(p=>p.online&&!p.sittingOut&&p.stack>0).sort((a,b)=>a.seat-b.seat);
  const ready=available.filter(p=>p.blind.mode==='ready'||p.blind.mode==='post'&&p.stack>=(p.blind.big?bb:1)+(p.blind.small?sb:0));
  const waiting=available.filter(p=>p.blind.mode==='wait');
  if(!ready.length)return null;
  const button=ready.find(p=>p.seat>previousButton)??ready[0];
  let entries=[...ready];
  if(ready.length===1){
    const next=[...waiting].sort((a,b)=>distance(button.seat,a.seat)-distance(button.seat,b.seat))[0];
    if(next)entries.push(next);
  }else{
    const small=ready[(ready.indexOf(button)+1)%ready.length];
    const next=[...ready.filter(p=>p.id!==small.id),...waiting].sort((a,b)=>distance(small.seat,a.seat)-distance(small.seat,b.seat))[0];
    if(next?.blind.mode==='wait')entries.push(next);
  }
  entries.sort((a,b)=>a.seat-b.seat);
  if(entries.length<2)return null;
  const buttonIndex=entries.findIndex(p=>p.id===button.id);
  const small=entries[entries.length===2?buttonIndex:(buttonIndex+1)%entries.length];
  const big=entries[(entries.indexOf(small)+1)%entries.length];
  return {entries,button:button.seat,small,big};
}
