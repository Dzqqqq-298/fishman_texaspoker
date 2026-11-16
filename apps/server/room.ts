import { Holdem, type HandState } from '../../packages/game-engine/holdem';
import { DEFAULT_ROOM_CONFIG, type RoomConfig, type MatchSession, type MatchResult } from '../../packages/game-engine/room-config';
import { Store } from './store';

interface Seat {id:number;name:string;seat:number;stack:number;straddle:boolean;sittingOut:boolean;timeouts:number}
interface Squid {unit:number;participants:number[];marked:number[];reserve:number}
interface State {
  version:number; day:string; hostId:number|null; seats:Seat[]; hand:HandState|null; running:boolean; pausedForRecovery:boolean;
  button:number; deadline:number; nextDeal:number; timeArmed:number|null; timeExtended:boolean;
  config:RoomConfig; match:MatchSession|null; squid:Squid|null; notices:string[];
}
export function gameDay(now=Date.now()) {return new Date(now+4*3600000).toISOString().slice(0,10);}
const playing=(s:State)=>!!s.hand&&s.hand.street!=='finished';

export class Room {
  state:State;
  online=new Set<number>();

  constructor(public store:Store) {
    this.state=store.load<State>()??{
      version:0,day:gameDay(),hostId:null,seats:[],hand:null,running:false,pausedForRecovery:false,
      button:-1,deadline:0,nextDeal:0,timeArmed:null,timeExtended:false,
      config:{...DEFAULT_ROOM_CONFIG},match:null,squid:null,notices:['欢迎来到鱼人大厅，创建房间或加入朋友的牌局。'],
    };
    const s=this.state;
    s.config={...DEFAULT_ROOM_CONFIG,...s.config};
    // Upgrade the original always-open table without discarding chips or an active hand.
    if(s.match===undefined) {
      s.match=s.seats.length||s.hand?{
        id:crypto.randomUUID(),name:'原有好友房',createdAt:Date.now(),startedAt:s.hand?Date.now():null,
        endsAt:null,endRequested:false,endReason:null,handCount:0,
        players:s.seats.map(p=>({id:p.id,name:p.name,buyIn:p.stack,cashOut:0,squidProfit:0,hands:0})),
      }:null;
      if(s.match) {
        s.config.durationMinutes=0;
        this.note('原牌桌已迁移为好友房，筹码与牌局保留；本场战绩从升级时开始记录。');
      }
    }
    if(s.running||playing(s)) {
      s.running=false;s.pausedForRecovery=true;this.note('服务已恢复，等待房主确认继续。');
    }
    store.save(s);
  }

  private note(text:string) {this.state.notices=[...this.state.notices.slice(-19),text];}
  private host(id:number) {if(this.state.hostId!==id&&!this.store.user(id)?.admin)throw new Error('只有房主或管理员可以操作');}
  private seat(id:number) {const seat=this.state.seats.find(s=>s.id===id);if(!seat)throw new Error('请先入座');return seat;}
  private between() {if(playing(this.state))throw new Error('请在本手结束后操作');}
  private atomic(fn:()=>void) {
    const backup=structuredClone(this.state);
    try {this.store.transaction(()=>{fn();this.state.version++;this.store.save(this.state);});}
    catch(error) {this.state=backup;throw error;}
  }
  command(id:number,key:string,version:number,type:string,data:Record<string,unknown>={}) {
    if(this.store.seen(id,key))return;
    if(version!==this.state.version)throw new Error('牌桌已更新，请重新操作');
    this.atomic(()=>{this.apply(id,type,data);this.store.remember(id,key);});
  }
  private amount(value:unknown) {
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>1000000000)throw new Error('请输入有效的整数积分');
    return value;
  }
  private readConfig(data:Record<string,unknown>,base=DEFAULT_ROOM_CONFIG):RoomConfig {
    const c={...base,...data} as RoomConfig;
    for(const key of ['smallBlind','bigBlind','squidUnit','defaultBuyIn','minBuyIn','maxBuyIn'] as const)this.amount(c[key]);
    if(c.smallBlind>c.bigBlind||c.bigBlind>10000||c.squidUnit>10000)throw new Error('盲注或鱿鱼额度不合法');
    if(!Number.isInteger(c.maxPlayers)||c.maxPlayers<2||c.maxPlayers>11)throw new Error('人数上限应为 2～11 人');
    if(![0,2,4,8,16].includes(c.straddleMax))throw new Error('Straddle 上限不合法');
    if(!Number.isInteger(c.durationMinutes)||(c.durationMinutes!==0&&(c.durationMinutes<15||c.durationMinutes>720)))throw new Error('时长应为 15～720 分钟，或选择不限时');
    if(c.minBuyIn<c.bigBlind||c.minBuyIn>c.defaultBuyIn||c.defaultBuyIn>c.maxBuyIn)throw new Error('带入范围应满足：大盲 ≤ 最低带入 ≤ 默认带入 ≤ 最高带入');
    if([c.squidEnabled,c.allowTopup,c.allowLateJoin].some(v=>typeof v!=='boolean'))throw new Error('规则开关不合法');
    return Object.fromEntries(Object.keys(DEFAULT_ROOM_CONFIG).map(key=>[key,c[key as keyof RoomConfig]])) as unknown as RoomConfig;
  }
  private addBuyIn(id:number,amount:number) {
    const m=this.state.match!,user=this.store.user(id)!;
    let p=m.players.find(p=>p.id===id);
    if(!p){p={id,name:user.name,buyIn:0,cashOut:0,squidProfit:0,hands:0};m.players.push(p);}
    p.buyIn+=amount;
  }
  private apply(id:number,type:string,data:Record<string,unknown>) {
    const s=this.state;
    if(type==='createRoom') {
      if(s.match)throw new Error('已有房间，请等待当前房间结束后再创建');
      if(typeof data.name!=='string'||!data.name.trim()||data.name.trim().length>24)throw new Error('房间名称需 1～24 个字符');
      s.config=this.readConfig(data);
      s.match={id:crypto.randomUUID(),name:data.name.trim(),createdAt:Date.now(),startedAt:null,endsAt:null,endRequested:false,endReason:null,handCount:0,players:[]};
      s.hostId=id;s.button=-1;s.seats=[];s.hand=null;s.running=false;s.pausedForRecovery=false;
      s.deadline=0;s.timeArmed=null;s.timeExtended=false;s.squid=null;
      s.notices=[`${this.store.user(id)!.name} 创建了房间「${s.match.name}」，等待入座。`];
      return;
    }
    if(!s.match)throw new Error('当前没有房间，请先在大厅创建房间');
    if(s.match.endRequested&&!['action','time','start','endRoom'].includes(type))throw new Error('房间正在收尾，本手结束后结算');

    if(type==='endRoom') {
      this.host(id);this.requestEnd('房主手动结束');
    } else if(type==='sit') {
      this.between();
      if(s.match.startedAt&&!s.config.allowLateJoin)throw new Error('本房间开赛后不允许新玩家加入');
      if(s.squid)throw new Error('鱿鱼本轮结束后才能加入');
      if(s.seats.some(p=>p.id===id))throw new Error('你已经入座');
      if(s.seats.length>=s.config.maxPlayers)throw new Error('座位已满');
      const seat=data.seat===undefined?Array.from({length:s.config.maxPlayers},(_,i)=>i).find(i=>!s.seats.some(p=>p.seat===i)):data.seat;
      if(typeof seat!=='number'||!Number.isInteger(seat)||seat<0||seat>=s.config.maxPlayers)throw new Error('座位编号无效');
      if(s.seats.some(p=>p.seat===seat))throw new Error('该座位已有人，请选择其他空座');
      const amount=this.amount(data.amount);
      if(amount<s.config.minBuyIn||amount>s.config.maxBuyIn)throw new Error(`带入范围为 ${s.config.minBuyIn}～${s.config.maxBuyIn}`);
      this.store.balance(id,-amount,'带入');this.addBuyIn(id,amount);
      const user=this.store.user(id)!;
      s.seats.push({id,name:user.name,seat,stack:amount,straddle:false,sittingOut:false,timeouts:0});
      this.note(`${user.name} 带入 ${amount}，加入牌桌`);
    } else if(type==='topup') {
      this.between();if(!s.config.allowTopup)throw new Error('本房间不允许追加带入');
      const seat=this.seat(id),amount=this.amount(data.amount);
      if(seat.stack+amount>s.config.maxBuyIn)throw new Error(`追加后桌上筹码不能超过 ${s.config.maxBuyIn}`);
      this.store.balance(id,-amount,'追加带入');this.addBuyIn(id,amount);seat.stack+=amount;
    } else if(type==='leave') {
      this.between();const seat=this.seat(id);if(s.squid)this.finishSquid();
      this.store.balance(id,seat.stack,'离桌退回');s.match.players.find(p=>p.id===id)!.cashOut+=seat.stack;
      s.seats=s.seats.filter(p=>p.id!==id);
      // The creator remains host even when standing up or browsing the lobby.
      if(s.seats.length<2)s.running=false;
    } else if(type==='straddle') {
      this.seat(id).straddle=Boolean(data.enabled);
    } else if(type==='away') {
      const seat=this.seat(id);seat.sittingOut=Boolean(data.enabled);if(!seat.sittingOut)seat.timeouts=0;
    } else if(type==='start') {
      this.host(id);
      if(s.pausedForRecovery&&playing(s)) {
        s.pausedForRecovery=false;s.running=!s.match.endRequested;
        s.deadline=Date.now()+25000;s.timeArmed=null;s.timeExtended=false;this.note('房主已恢复牌局');
      } else {
        this.between();if(s.match.endRequested)throw new Error('房间正在结束');
        if(s.match.startedAt===null) {
          s.match.startedAt=Date.now();
          s.match.endsAt=s.config.durationMinutes?s.match.startedAt+s.config.durationMinutes*60000:null;
        }
        s.pausedForRecovery=false;this.beginHand();s.running=!!s.match;
      }
    } else if(type==='pause') {
      this.host(id);s.running=false;this.note('房主已设置本手结束后暂停；比赛总时长继续计时');
    } else if(type==='settings') {
      this.host(id);this.between();
      if(s.match.startedAt!==null)throw new Error('开赛后房间规则锁定，请结束后重新创建房间');
      const config=this.readConfig(data,s.config);
      if(s.seats.length>config.maxPlayers)throw new Error('人数上限不能低于已入座人数');
      if(s.seats.some(p=>p.seat>=config.maxPlayers))throw new Error('需关闭的座位仍有人，请先离座再调整人数');
      if(s.seats.some(p=>p.stack<config.minBuyIn||p.stack>config.maxBuyIn))throw new Error('新的带入范围不包含已有玩家筹码，请先让玩家调整或离座');
      s.config=config;this.note('房主已更新开赛规则，请入座玩家确认');
    } else if(type==='squidEnd') {
      this.host(id);this.between();this.finishSquid();
    } else if(type==='time') {
      if(s.hand?.actor!==id||s.pausedForRecovery||s.timeExtended||!playing(s))throw new Error('当前不能使用时间卡');
      if(this.store.user(id)!.timeCards<1)throw new Error('时间卡已用完');s.timeArmed=id;
    } else if(type==='action') {
      if(!s.hand||s.pausedForRecovery)throw new Error('牌局尚未开始或等待恢复');
      if(!['fold','check','call','raise'].includes(String(data.action)))throw new Error('动作不合法');
      this.seat(id).timeouts=0;
      this.action(id,data.action as 'fold'|'check'|'call'|'raise',data.amount===undefined?undefined:this.amount(data.amount));
    } else throw new Error('未知操作');
  }

  private beginHand() {
    const s=this.state,m=s.match;
    if(!m||m.endRequested)throw new Error('房间已结束或正在收尾');
    if(m.endsAt!==null&&Date.now()>=m.endsAt)throw new Error('比赛时间已到，等待结算');
    const entries=s.seats.filter(p=>!p.sittingOut&&p.stack>0&&this.online.has(p.id)).sort((a,b)=>a.seat-b.seat);
    if(entries.length<2)throw new Error('至少需要两名在线且有筹码的玩家');
    if(s.squid&&s.squid.participants.some(id=>!entries.some(p=>p.id===id)))throw new Error('鱿鱼参与者未就绪：请等待，或由房主提前结算本轮');
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
    const s=this.state,h=s.hand!,m=s.match!;
    h.players.forEach(p=>{
      const seat=this.seat(p.id);this.store.record(p.id,p.stack-seat.stack,`牌局 ${h.id.slice(0,8)}`);seat.stack=p.stack;
      m.players.find(x=>x.id===p.id)!.hands++;
      this.store.db.prepare('UPDATE users SET hands=hands+1,timeCards=MIN(3,timeCards+CASE WHEN (hands+1)%20=0 THEN 1 ELSE 0 END) WHERE id=?').run(p.id);
    });
    m.handCount++;
    const main=h.pots.find(p=>!p.returned);
    if(s.squid&&main?.winners.length===1&&s.squid.participants.includes(main.winners[0])) {
      if(!s.squid.marked.includes(main.winners[0]))s.squid.marked.push(main.winners[0]);
      if(s.squid.marked.length===s.squid.participants.length-1)this.finishSquid();
    }
    const summary={id:h.id,matchId:m.id,board:h.board,pots:h.pots,players:h.players.map(p=>({id:p.id,name:p.name,stack:p.stack})),log:h.log};
    this.store.db.prepare('INSERT INTO hands(id,summary) VALUES(?,?)').run(h.id,JSON.stringify(summary));
    s.nextDeal=Date.now()+7000;s.deadline=0;
    if(m.endRequested)this.finishMatch(m.endReason??'房主手动结束');
    else if(m.endsAt!==null&&Date.now()>=m.endsAt)this.finishMatch('比赛时长到期');
  }
  private finishSquid() {
    const s=this.state,q=s.squid;if(!q)return;
    const losers=q.participants.filter(id=>!q.marked.includes(id));
    for(const id of q.participants) {
      const delta=q.marked.includes(id)?losers.length*q.unit:-q.marked.length*q.unit;
      this.store.balance(id,q.reserve,'鱿鱼预留退回');if(delta)this.store.balance(id,delta,'鱿鱼结算');
      const p=s.match?.players.find(p=>p.id===id);if(p)p.squidProfit+=delta;
    }
    this.note(`鱿鱼已结算：${q.marked.length} 人获标记，${losers.length} 人未获标记`);s.squid=null;
  }
  private requestEnd(reason:string) {
    const s=this.state;if(!s.match||s.match.endRequested)return;
    s.match.endRequested=true;s.match.endReason=reason;s.running=false;
    if(playing(s))this.note(`${reason}：打完当前手后退回筹码并关闭房间`);
    else this.finishMatch(reason);
  }
  private finishMatch(reason:string) {
    const s=this.state,m=s.match;if(!m)return;
    this.between();this.finishSquid();
    for(const seat of s.seats) {
      this.store.balance(seat.id,seat.stack,'房间结束退回');m.players.find(p=>p.id===seat.id)!.cashOut+=seat.stack;
    }
    const result:MatchResult={
      id:m.id,name:m.name,startedAt:m.startedAt,endedAt:Date.now(),reason,handCount:m.handCount,config:{...s.config},
      players:m.players.map(p=>({...p,profit:p.cashOut-p.buyIn+p.squidProfit})).sort((a,b)=>b.profit-a.profit||a.id-b.id),
    };
    this.store.saveMatch(result);
    s.match=null;s.seats=[];s.hand=null;s.hostId=null;s.running=false;s.pausedForRecovery=false;
    s.deadline=0;s.timeArmed=null;s.timeExtended=false;s.button=-1;
    this.note(`「${m.name}」已结束，积分已退回账户，战绩已保存。`);
  }

  tick(now=Date.now()):boolean {
    const s=this.state;
    // The match deadline is a wall-clock timestamp; pause/restart never resets it.
    if(s.match?.endsAt!==null&&s.match?.endsAt!==undefined&&now>=s.match.endsAt&&!s.match.endRequested) {
      this.atomic(()=>this.requestEnd('比赛时长到期'));return true;
    }
    if(s.pausedForRecovery)return false;
    if(s.day!==gameDay(now)&&!playing(s)) {
      this.atomic(()=>{
        if(s.match)this.finishMatch('每日积分重置');
        for(const u of this.store.users())this.store.record(u.id,100000-u.balance,'每日重置');
        this.store.db.exec('UPDATE users SET balance=100000,timeCards=3,hands=0');
        s.day=gameDay(now);this.note('每日积分已重置为 100,000，上一场战绩已归档。');
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
    const phase: 'empty'|'waiting'|'running'|'paused'|'ending'=!s.match?'empty':s.match.endRequested?'ending':!s.match.startedAt?'waiting':s.running||playing(s)&&!s.pausedForRecovery?'running':'paused';
    return {
      version:s.version,day:s.day,hostId:s.hostId,hostName:s.hostId?this.store.user(s.hostId)?.name??null:null,running:s.running,pausedForRecovery:s.pausedForRecovery,
      deadline:s.deadline,timeArmed:s.timeArmed,timeExtended:s.timeExtended,serverNow:Date.now(),
      phase,match:s.match,recentMatches:this.store.recentMatches(),
      config:s.config,seats:s.seats.map(p=>({...p,online:this.online.has(p.id)})),hand:s.hand?Holdem.restore(s.hand).view(id):null,
      squid:s.squid,notices:s.notices,me:this.store.publicUser(user),
    };
  }
}
export type RoomView=ReturnType<Room['view']>;
