import { Holdem, type HandState } from '../../packages/game-engine/holdem';
import { Store } from './store';

interface Seat {id:number;name:string;seat:number;stack:number;straddle:boolean;sittingOut:boolean;timeouts:number}
interface Squid {unit:number;participants:number[];marked:number[];reserve:number}
interface State {
  version:number; day:string; hostId:number|null; seats:Seat[]; hand:HandState|null; running:boolean; pausedForRecovery:boolean;
  button:number; deadline:number; nextDeal:number; timeArmed:number|null; timeExtended:boolean;
  config:{smallBlind:number;bigBlind:number;straddleMax:number;squidEnabled:boolean;squidUnit:number};
  squid:Squid|null; notices:string[];
}
export function gameDay(now=Date.now()) {return new Date(now+4*3600000).toISOString().slice(0,10);}
const playing=(s:State)=>!!s.hand&&s.hand.street!=='finished';
export class Room {
  state:State;
  online=new Set<number>();
  constructor(public store:Store) {
    this.state=store.load<State>()??{version:0,day:gameDay(),hostId:null,seats:[],hand:null,running:false,pausedForRecovery:false,button:-1,deadline:0,nextDeal:0,timeArmed:null,timeExtended:false,config:{smallBlind:10,bigBlind:20,straddleMax:8,squidEnabled:false,squidUnit:100},squid:null,notices:['欢迎来到鱼人德州。入座后由房主开始。']};
    if(this.state.running||playing(this.state)) {this.state.running=false;this.state.pausedForRecovery=true;this.note('服务已恢复，等待房主确认继续。');}
    store.save(this.state);
  }
  private note(text:string) {this.state.notices=[...this.state.notices.slice(-19),text];}
  private host(id:number) {if(this.state.hostId!==id&&!this.store.user(id)?.admin) throw new Error('只有房主或管理员可以操作');}
  private seat(id:number) {const seat=this.state.seats.find(s=>s.id===id);if(!seat) throw new Error('请先入座');return seat;}
  private between() {if(playing(this.state)) throw new Error('请在本手结束后操作');}
  private atomic(fn:()=>void) {
    const backup=structuredClone(this.state);
    try {this.store.transaction(()=>{fn();this.state.version++;this.store.save(this.state);});}
    catch(error) {this.state=backup;throw error;}
  }
  command(id:number,key:string,version:number,type:string,data:Record<string,unknown>={}) {
    if(this.store.seen(id,key)) return;
    if(version!==this.state.version) throw new Error('牌桌已更新，请重新操作');
    this.atomic(()=>{this.apply(id,type,data);this.store.remember(id,key);});
  }
  private amount(value:unknown) {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>1000000000) throw new Error('请输入有效的整数积分');return value;}
  private apply(id:number,type:string,data:Record<string,unknown>) {
    const s=this.state;
    if(type==='sit') {
      this.between();if(s.squid) throw new Error('鱿鱼本轮结束后才能加入');if(s.seats.some(p=>p.id===id)) throw new Error('你已经入座');
      if(s.seats.length>=11) throw new Error('座位已满');
      const amount=this.amount(data.amount);if(amount<s.config.bigBlind) throw new Error('带入至少一个大盲');
      this.store.balance(id,-amount,'带入');const user=this.store.user(id)!;
      const seat=Array.from({length:11},(_,i)=>i).find(i=>!s.seats.some(p=>p.seat===i))!;
      s.seats.push({id,name:user.name,seat,stack:amount,straddle:false,sittingOut:false,timeouts:0});if(s.hostId===null)s.hostId=id;
      this.note(`${user.name} 带入 ${amount}，加入牌桌`);
    } else if(type==='topup') {
      this.between();const seat=this.seat(id),amount=this.amount(data.amount);this.store.balance(id,-amount,'追加带入');seat.stack+=amount;
    } else if(type==='leave') {
      this.between();const seat=this.seat(id);if(s.squid)this.finishSquid();
      this.store.balance(id,seat.stack,'离桌退回');s.seats=s.seats.filter(p=>p.id!==id);
      if(s.hostId===id)s.hostId=s.seats[0]?.id??null;
      if(s.seats.length<2)s.running=false;
    } else if(type==='straddle') {
      this.seat(id).straddle=Boolean(data.enabled);
    } else if(type==='away') {
      const seat=this.seat(id);seat.sittingOut=Boolean(data.enabled);if(!seat.sittingOut)seat.timeouts=0;
    } else if(type==='start') {
      this.host(id);
      if(s.pausedForRecovery&&playing(s)) {s.pausedForRecovery=false;s.running=true;s.deadline=Date.now()+25000;s.timeArmed=null;s.timeExtended=false;this.note('房主已恢复牌局');}
      else {this.between();s.pausedForRecovery=false;this.beginHand();s.running=true;}
    } else if(type==='pause') {
      this.host(id);s.running=false;this.note('房主已设置本手结束后暂停');
    } else if(type==='settings') {
      this.host(id);this.between();if(s.squid)throw new Error('请先结算本轮鱿鱼');
      const sb=this.amount(data.smallBlind),bb=this.amount(data.bigBlind),unit=this.amount(data.squidUnit);
      if(sb>bb || bb>10000 || unit>10000 || ![0,2,4,8,16].includes(Number(data.straddleMax)))throw new Error('盲注或 Straddle 上限不合法');
      s.config={smallBlind:sb,bigBlind:bb,straddleMax:Number(data.straddleMax),squidEnabled:Boolean(data.squidEnabled),squidUnit:unit};
      this.note('房主已更新下一手规则');
    } else if(type==='squidEnd') {this.host(id);this.between();this.finishSquid();}
    else if(type==='time') {
      if(s.hand?.actor!==id || s.pausedForRecovery || s.timeExtended || !playing(s))throw new Error('当前不能使用时间卡');
      if(this.store.user(id)!.timeCards<1)throw new Error('时间卡已用完');s.timeArmed=id;
    } else if(type==='action') {
      if(!s.hand||s.pausedForRecovery)throw new Error('牌局尚未开始或等待恢复');
      if(!['fold','check','call','raise'].includes(String(data.action)))throw new Error('动作不合法');
      this.action(id,data.action as 'fold'|'check'|'call'|'raise',data.amount===undefined?undefined:this.amount(data.amount));
      this.seat(id).timeouts=0;
    } else throw new Error('未知操作');
  }
  private beginHand() {
    const s=this.state;
    const entries=s.seats.filter(p=>!p.sittingOut&&p.stack>0&&this.online.has(p.id)).sort((a,b)=>a.seat-b.seat);
    if(entries.length<2)throw new Error('至少需要两名在线且有筹码的玩家');
    if(s.squid&&s.squid.participants.some(id=>!entries.some(p=>p.id===id))) throw new Error('鱿鱼参与者未就绪：请等待，或由房主提前结算本轮');
    if(s.config.squidEnabled&&!s.squid&&entries.length>=3) {
      const reserve=(entries.length-1)*s.config.squidUnit;
      entries.forEach(p=>this.store.balance(p.id,-reserve,'鱿鱼预留'));
      s.squid={unit:s.config.squidUnit,participants:entries.map(p=>p.id),marked:[],reserve};
    }
    s.button=(entries.find(p=>p.seat>s.button)??entries[0]).seat;
    s.hand=new Holdem(entries,s.button,s.config.smallBlind,s.config.bigBlind,s.config.straddleMax).state;
    s.deadline=Date.now()+25000;s.timeArmed=null;s.timeExtended=false;
    if(s.hand.street==='finished')this.finishHand();
  }
  private action(id:number,type:'fold'|'check'|'call'|'raise',amount?:number) {
    const s=this.state,h=Holdem.restore(s.hand!);h.act(id,type,amount);s.hand=h.state;
    s.deadline=Date.now()+25000;s.timeArmed=null;s.timeExtended=false;
    if(s.hand.street==='finished')this.finishHand();
  }
  private finishHand() {
    const s=this.state,h=s.hand!;
    h.players.forEach(p=>{
      const seat=this.seat(p.id);this.store.record(p.id,p.stack-seat.stack,`牌局 ${h.id.slice(0,8)}`);seat.stack=p.stack;
      this.store.db.prepare('UPDATE users SET hands=hands+1,timeCards=MIN(3,timeCards+CASE WHEN (hands+1)%20=0 THEN 1 ELSE 0 END) WHERE id=?').run(p.id);
    });
    const main=h.pots.find(p=>!p.returned);
    if(s.squid&&main?.winners.length===1&&s.squid.participants.includes(main.winners[0])) {
      if(!s.squid.marked.includes(main.winners[0]))s.squid.marked.push(main.winners[0]);
      if(s.squid.marked.length===s.squid.participants.length-1)this.finishSquid();
    }
    const summary={id:h.id,board:h.board,pots:h.pots,players:h.players.map(p=>({id:p.id,name:p.name,stack:p.stack})),log:h.log};
    this.store.db.prepare('INSERT INTO hands(id,summary) VALUES(?,?)').run(h.id,JSON.stringify(summary));
    s.nextDeal=Date.now()+7000;s.deadline=0;
  }
  private finishSquid() {
    const s=this.state,q=s.squid;if(!q)return;
    const losers=q.participants.filter(id=>!q.marked.includes(id));
    for(const id of q.participants) {
      const delta=q.marked.includes(id)?losers.length*q.unit:-q.marked.length*q.unit;
      this.store.balance(id,q.reserve,'鱿鱼预留退回');if(delta)this.store.balance(id,delta,'鱿鱼结算');
    }
    this.note(`鱿鱼已结算：${q.marked.length} 人获标记，${losers.length} 人未获标记`);s.squid=null;
  }
  tick(now=Date.now()):boolean {
    const s=this.state;
    if(s.pausedForRecovery)return false;
    if(s.day!==gameDay(now)&&!playing(s)) {
      this.atomic(()=>{
        this.finishSquid();s.seats.forEach(p=>this.store.balance(p.id,p.stack,'每日清桌'));
        for(const u of this.store.users()) {this.store.record(u.id,100000-u.balance,'每日重置');}
        this.store.db.exec('UPDATE users SET balance=100000,timeCards=3,hands=0');
        s.seats.forEach(p=>{p.stack=0;p.timeouts=0;});s.day=gameDay(now);s.hand=null;s.running=false;this.note('每日积分已重置为 100,000，请重新带入');
      });return true;
    }
    if(playing(s)&&now>=s.deadline) {
      this.atomic(()=>{
        const id=s.hand!.actor!;
        if(s.timeArmed===id&&!s.timeExtended&&this.store.user(id)!.timeCards>0) {
          this.store.db.prepare('UPDATE users SET timeCards=timeCards-1 WHERE id=?').run(id);s.timeExtended=true;s.timeArmed=null;s.deadline=now+30000;
        } else {
          const seat=this.seat(id);seat.timeouts++;if(seat.timeouts>=2)seat.sittingOut=true;
          this.action(id,Holdem.restore(s.hand!).legal(id)!.canCheck?'check':'fold');
        }
      });return true;
    }
    if(s.running&&!playing(s)&&now>=s.nextDeal) {
      try {this.atomic(()=>this.beginHand());}
      catch(error) {this.atomic(()=>{this.state.running=false;this.note(error instanceof Error?error.message:'无法开始下一手');});}
      return true;
    }
    return false;
  }
  view(id:number) {
    const s=this.state,user=this.store.user(id)!;
    return {version:s.version,day:s.day,hostId:s.hostId,running:s.running,pausedForRecovery:s.pausedForRecovery,deadline:s.deadline,timeArmed:s.timeArmed,timeExtended:s.timeExtended,serverNow:Date.now(),
      config:s.config,seats:s.seats.map(p=>({...p,online:this.online.has(p.id)})),hand:s.hand?Holdem.restore(s.hand).view(id):null,
      squid:s.squid,notices:s.notices,me:this.store.publicUser(user)};
  }
}
export type RoomView=ReturnType<Room['view']>;
