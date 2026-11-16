import { deck, evaluate, compare, type Card } from './cards';

export interface Entrant { id: number; name: string; seat: number; stack: number; straddle?: boolean }
export interface Player extends Entrant { cards: Card[]; bet: number; total: number; folded: boolean; actedAt: number | null; action: string }
export interface PotResult { amount: number; winners: number[]; returned?: boolean }
export interface HandState {
  id: string; players: Player[]; board: Card[]; deck: Card[]; button: number; smallBlind: number; bigBlind: number;
  street: 'preflop'|'flop'|'turn'|'river'|'finished'; currentBet: number; minRaise: number;
  pending: number[]; actor: number | null; pots: PotResult[]; log: string[]; straddles: { id: number; amount: number }[];
}
export class Holdem {
  state: HandState;
  constructor(entries: Entrant[], buttonSeat: number, sb=10, bb=20, straddleMax=8, id=crypto.randomUUID()) {
    if(entries.length < 2 || entries.length > 11) throw new Error('需要 2～11 名玩家');
    const players = [...entries].sort((a,b)=>a.seat-b.seat).map(p=>({...p,cards:[] as Card[],bet:0,total:0,folded:false,actedAt:null,action:''}));
    this.state = {id,players,board:[],deck:deck(),button:buttonSeat,smallBlind:sb,bigBlind:bb,street:'preflop',currentBet:bb,minRaise:bb,pending:[],actor:null,pots:[],log:[],straddles:[]};
    const button = players.findIndex(p=>p.seat===buttonSeat);
    if(button < 0) throw new Error('庄位无效');
    const small = players.length===2 ? button : (button+1)%players.length;
    const big = (small+1)%players.length;
    this.pay(players[small], Math.min(sb,players[small].stack)); players[small].action='小盲';
    this.pay(players[big], Math.min(bb,players[big].stack)); players[big].action='大盲';
    let last = big, amount=bb*2;
    if(players.length>2) for(let k=1;k<=players.length-2 && amount<=bb*straddleMax;k++) {
      const index=(big+k)%players.length, p=players[index];
      if(!p.straddle || p.stack<amount) break;
      this.pay(p,amount); p.action=`Straddle ${amount}`; last=index;
      this.state.straddles.push({id:p.id,amount}); this.state.currentBet=amount; this.state.minRaise=amount; amount*=2;
    }
    for(let round=0;round<2;round++) for(let k=1;k<=players.length;k++) players[(button+k)%players.length].cards.push(this.state.deck.pop()!);
    this.state.pending=players.filter(p=>p.stack>0).map(p=>p.id);
    this.advance(players[last].id);
  }
  static restore(state: HandState) { const h=Object.create(Holdem.prototype) as Holdem; h.state=state; return h; }
  private pay(p:Player,n:number) { p.stack-=n;p.bet+=n;p.total+=n; }
  legal(id:number) {
    const s=this.state,p=s.players.find(p=>p.id===id);
    if(!p || s.actor!==id || s.street==='finished') return null;
    const toCall=Math.max(0,s.currentBet-p.bet);
    const others=s.players.some(o=>o.id!==id&&!o.folded&&o.stack>0);
    const reopened=p.actedAt===null || p.actedAt===0 || s.currentBet-p.actedAt>=s.minRaise;
    const maxTo=p.bet+p.stack;
    return {toCall:Math.min(toCall,p.stack),canCheck:toCall===0,canRaise:others&&reopened&&maxTo>s.currentBet,minTo:s.currentBet===0?s.bigBlind:s.currentBet+s.minRaise,maxTo};
  }
  act(id:number,type:'fold'|'check'|'call'|'raise',amount?:number) {
    const s=this.state,legal=this.legal(id),p=s.players.find(p=>p.id===id)!;
    if(!legal) throw new Error('还没轮到你行动');
    if(type==='fold') {p.folded=true;p.action='弃牌';}
    else if(type==='check') {if(!legal.canCheck) throw new Error('需要跟注，不能过牌');p.action='过牌';}
    else if(type==='call') {if(legal.canCheck) throw new Error('无需跟注，请过牌');this.pay(p,legal.toCall);p.action=p.stack===0?'全下':`跟注 ${legal.toCall}`;}
    else if(type==='raise') {
      if(!legal.canRaise || !Number.isSafeInteger(amount) || amount!<=s.currentBet || amount!>legal.maxTo || (amount!<legal.minTo && amount!==legal.maxTo)) throw new Error('加注金额不合法');
      const increment=amount!-s.currentBet;
      this.pay(p,amount!-p.bet);
      if(increment>=s.minRaise) s.minRaise=increment;
      s.currentBet=amount!;
      s.pending=s.players.filter(o=>o.id!==id&&!o.folded&&o.stack>0&&(o.bet<s.currentBet||s.pending.includes(o.id))).map(o=>o.id);
      p.action=p.stack===0?`全下 ${amount}`:`加注到 ${amount}`;
    } else throw new Error('未知动作');
    p.actedAt=s.currentBet;s.pending=s.pending.filter(i=>i!==id);s.log.push(`${p.name} · ${p.action}`);
    this.advance(id);
  }
  private advance(after:number) {
    const s=this.state,live=s.players.filter(p=>!p.folded);
    if(live.length===1) {this.settle();return;}
    const actionable=live.filter(p=>p.stack>0);
    // No player can contest chips beyond the largest actual live contribution.
    if(actionable.length<=1) s.currentBet=Math.max(...live.map(p=>p.bet));
    if(actionable.length<=1 && actionable.every(p=>p.bet>=s.currentBet)) s.pending=[];
    s.pending=s.pending.filter(id=>actionable.some(p=>p.id===id));
    if(!s.pending.length) {
      if(s.street==='river') {this.settle();return;}
      s.deck.pop(); // burn a card before each street
      const count=s.street==='preflop'?3:1;
      for(let i=0;i<count;i++) s.board.push(s.deck.pop()!);
      s.street=s.street==='preflop'?'flop':s.street==='flop'?'turn':'river';
      s.currentBet=0;s.minRaise=s.bigBlind;
      s.players.forEach(p=>{p.bet=0;p.actedAt=null;if(!p.folded)p.action=p.stack===0?'全下':'';});
      s.pending=actionable.map(p=>p.id);
      this.advance(s.players.find(p=>p.seat===s.button)!.id);return;
    }
    const index=s.players.findIndex(p=>p.id===after);
    for(let k=1;k<=s.players.length;k++) {const p=s.players[(index+k)%s.players.length];if(s.pending.includes(p.id)){s.actor=p.id;return;}}
  }
  private settle() {
    const s=this.state,levels=[...new Set(s.players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);
    let previous=0;
    for(const level of levels) {
      const contributors=s.players.filter(p=>p.total>=level),amount=(level-previous)*contributors.length;previous=level;
      if(contributors.length===1) {contributors[0].stack+=amount;s.pots.push({amount,winners:[contributors[0].id],returned:true});continue;}
      const eligible=contributors.filter(p=>!p.folded);
      let winners=eligible;
      if(eligible.length>1) {
        const scores=eligible.map(p=>({p,score:evaluate([...p.cards,...s.board]).score}));
        scores.sort((a,b)=>compare(b.score,a.score));winners=scores.filter(x=>compare(x.score,scores[0].score)===0).map(x=>x.p);
      }
      if(!winners.length) throw new Error('底池无可获奖玩家');
      winners.sort((a,b)=>((a.seat-s.button+11)%11||11)-((b.seat-s.button+11)%11||11));
      const share=Math.floor(amount/winners.length),extra=amount%winners.length;
      winners.forEach((p,i)=>p.stack+=share+(i<extra?1:0));s.pots.push({amount,winners:winners.map(p=>p.id)});
    }
    s.street='finished';s.actor=null;s.pending=[];
    s.log.push('本手已结算');
  }
  view(id:number) {
    const s=this.state,showdown=s.street==='finished'&&s.players.filter(p=>!p.folded).length>1;
    return {id:s.id,button:s.button,street:s.street,board:s.board,currentBet:s.currentBet,actor:s.actor,straddles:s.straddles,
      pot:s.players.reduce((n,p)=>n+p.total,0),pots:s.pots,log:s.log.slice(-30),legal:this.legal(id),
      players:s.players.map(({cards,actedAt,...p})=>({...p,cards:p.id===id||(showdown&&!p.folded)?cards:[],handName:showdown&&!p.folded?evaluate([...cards,...s.board]).name:null}))};
  }
}
