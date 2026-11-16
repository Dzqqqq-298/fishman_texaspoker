import { deck, evaluate, compare, type Card } from './cards';

export interface Entrant { id: number; name: string; seat: number; stack: number; straddle?: boolean;postBlind?:{live:number;dead:number} }
export interface Player extends Entrant { cards: Card[]; bet: number; total: number; deadBlind:number; folded: boolean; actedAt: number | null; action: string; allIn:boolean }
export interface PotResult { amount: number; winners: number[]; returned?: boolean; board?:number; potIndex?:number }
export interface HandState {
  id: string; players: Player[]; board: Card[]; deck: Card[]; button: number; smallBlind: number; bigBlind: number;
  street: 'preflop'|'flop'|'turn'|'river'|'runout'|'finished'; currentBet: number; minRaise: number;
  pending: number[]; actor: number | null; pots: PotResult[]; log: string[]; straddles: { id: number; amount: number }[];
  boards:Card[][];shown:Record<number,number[]>;lastAggressor:number|null;maxRunouts:1|2;showdownMode:'auto'|'all';
  runout:{eligible:number[];votes:Record<number,1|2>}|null;
}
export class Holdem {
  state: HandState;
  constructor(entries: Entrant[], buttonSeat: number, sb=10, bb=20, straddleMax=8, id=crypto.randomUUID(),maxRunouts:1|2=1,showdownMode:'auto'|'all'='auto') {
    if(entries.length < 2 || entries.length > 11) throw new Error('需要 2～11 名玩家');
    const players = [...entries].sort((a,b)=>a.seat-b.seat).map(p=>({...p,cards:[] as Card[],bet:0,total:0,deadBlind:0,folded:false,actedAt:null,action:'',allIn:false}));
    this.state = {id,players,board:[],deck:deck(),button:buttonSeat,smallBlind:sb,bigBlind:bb,street:'preflop',currentBet:bb,minRaise:bb,pending:[],actor:null,pots:[],log:[],straddles:[],boards:[],shown:{},lastAggressor:null,maxRunouts,showdownMode,runout:null};
    const button = players.findIndex(p=>p.seat===buttonSeat);
    if(button < 0) throw new Error('庄位无效');
    const small = players.length===2 ? button : (button+1)%players.length;
    const big = (small+1)%players.length;
    for(const p of players)if(p.postBlind){
      const {live,dead}=p.postBlind;
      if(!Number.isSafeInteger(live)||!Number.isSafeInteger(dead)||live<0||dead<0||live>bb||dead>sb||p.stack<live+dead||p.stack<=dead)throw new Error('补盲筹码不足或金额无效');
      p.stack-=dead;p.deadBlind=dead;
      if(dead)this.state.log.push(`${p.name} · 补小盲 ${dead}（不抵跟注）`);
    }
    this.pay(players[small], Math.min(sb,players[small].stack)); players[small].action='小盲';
    this.pay(players[big], Math.min(bb,players[big].stack)); players[big].action='大盲';
    for(const p of players)if(p.postBlind?.live){
      const amount=Math.max(0,p.postBlind.live-p.bet);this.pay(p,Math.min(amount,p.stack));
      this.state.log.push(`${p.name} · 补大盲 ${p.postBlind.live}（计入本轮下注）`);
    }
    let last = big, amount=bb*2;
    if(players.length>2) for(let k=1;k<=players.length-2 && amount<=bb*straddleMax;k++) {
      const index=(big+k)%players.length, p=players[index];
      if(!p.straddle || p.stack+p.bet<amount) break;
      this.pay(p,amount-p.bet); p.action=`Straddle ${amount}`; last=index;
      this.state.straddles.push({id:p.id,amount}); this.state.currentBet=amount; this.state.minRaise=amount; amount*=2;
    }
    for(let round=0;round<2;round++) for(let k=1;k<=players.length;k++) players[(button+k)%players.length].cards.push(this.state.deck.pop()!);
    this.state.log.push(`盲注 ${sb}/${bb}`,...players.filter(p=>p.bet>0).map(p=>`${p.name} · ${p.action} ${p.bet}`));
    this.state.pending=players.filter(p=>p.stack>0).map(p=>p.id);
    this.advance(players[last].id);
  }
  static restore(state: HandState) {
    const h=Object.create(Holdem.prototype) as Holdem;h.state=state;
    state.boards??=[];state.maxRunouts??=1;state.showdownMode??='auto';state.runout??=null;state.lastAggressor??=null;
    state.shown??=Object.fromEntries(state.street==='finished'&&state.players.filter(p=>!p.folded).length>1?state.players.filter(p=>!p.folded).map(p=>[p.id,[0,1]]):[]);
    state.players.forEach(p=>{p.allIn??=p.stack===0;p.deadBlind??=0;});return h;
  }
  private pay(p:Player,n:number) { p.stack-=n;p.bet+=n;p.total+=n;if(p.stack===0)p.allIn=true; }
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
      s.lastAggressor=id;
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
      if(actionable.length<=1&&live.some(p=>p.allIn)) {
        live.forEach(p=>s.shown[p.id]=[0,1]);
        if(s.maxRunouts===2&&live.length===2) {
          s.street='runout';s.actor=null;s.runout={eligible:live.map(p=>p.id),votes:{}};
          s.log.push('All-in · 等待双方选择发牌次数');return;
        }
        this.completeRunout(1);return;
      }
      s.deck.pop(); // burn a card before each street
      const count=s.street==='preflop'?3:1;
      for(let i=0;i<count;i++) s.board.push(s.deck.pop()!);
      s.street=s.street==='preflop'?'flop':s.street==='flop'?'turn':'river';
      s.lastAggressor=null;s.log.push(`${s.street==='flop'?'翻牌':s.street==='turn'?'转牌':'河牌'} · ${s.board.join(' ')}`);
      s.currentBet=0;s.minRaise=s.bigBlind;
      s.players.forEach(p=>{p.bet=0;p.actedAt=null;if(!p.folded)p.action=p.stack===0?'全下':'';});
      s.pending=actionable.map(p=>p.id);
      this.advance(s.players.find(p=>p.seat===s.button)!.id);return;
    }
    const index=s.players.findIndex(p=>p.id===after);
    for(let k=1;k<=s.players.length;k++) {const p=s.players[(index+k)%s.players.length];if(s.pending.includes(p.id)){s.actor=p.id;return;}}
  }
  voteRunout(id:number,count:1|2) {
    const s=this.state,q=s.runout;
    if(s.street!=='runout'||!q||!q.eligible.includes(id)||![1,2].includes(count))throw new Error('当前不能选择发牌次数');
    if(q.votes[id])throw new Error('已提交选择');
    q.votes[id]=count;
    if(count===1)this.completeRunout(1);
    else if(q.eligible.every(id=>q.votes[id]===2))this.completeRunout(2);
  }
  completeRunout(count:1|2) {
    const s=this.state,live=s.players.filter(p=>!p.folded);
    if(s.street==='finished'||s.pending.length||live.length<2||live.filter(p=>p.stack>0).length>1)throw new Error('下注尚未结束');
    if(count===2&&(live.length!==2||s.maxRunouts!==2||!s.runout?.eligible.every(id=>s.runout!.votes[id]===2)))throw new Error('双方同意后才能发两次');
    const prefix=[...s.board];s.boards=[];
    for(let run=0;run<count;run++) {
      const board=[...prefix];
      while(board.length<5){s.deck.pop();const n=board.length===0?3:1;for(let i=0;i<n;i++)board.push(s.deck.pop()!);}
      s.boards.push(board);s.log.push(`第 ${run+1} 次发牌 · ${board.join(' ')}`);
    }
    s.board=s.boards[0];s.runout=null;this.settle();
  }
  showCards(id:number,indices:number[]) {
    const s=this.state,p=s.players.find(p=>p.id===id);
    if(s.street!=='finished'||!p)throw new Error('本手结束后才能秀牌');
    if(!indices.length||indices.length>2||indices.some(i=>i!==0&&i!==1))throw new Error('请选择要秀出的底牌');
    const before=s.shown[id]??[];s.shown[id]=[...new Set([...before,...indices])].sort();
    if(s.shown[id].length>before.length)s.log.push(`${p.name} · 秀牌 ${indices.map(i=>p.cards[i]).join(' ')}`);
  }
  private settle() {
    const s=this.state,levels=[...new Set(s.players.map(p=>p.total).filter(Boolean))].sort((a,b)=>a-b);
    const boards=s.boards.length?s.boards:[s.board];let previous=0,potIndex=0,dead=s.players.reduce((n,p)=>n+p.deadBlind,0);
    for(const level of levels) {
      const contributors=s.players.filter(p=>p.total>=level);let amount=(level-previous)*contributors.length;previous=level;
      if(contributors.length===1) {contributors[0].stack+=amount;s.pots.push({amount,winners:[contributors[0].id],returned:true});continue;}
      amount+=dead;dead=0; // Dead small blinds enter the main pot, never enlarge a side-pot cap.
      const eligible=contributors.filter(p=>!p.folded);
      for(let run=0;run<boards.length;run++) {
        const portion=Math.floor(amount/boards.length)+(run<amount%boards.length?1:0);let winners=eligible;
        if(eligible.length>1) {
          const scores=eligible.map(p=>({p,score:evaluate([...p.cards,...boards[run]]).score}));
          scores.sort((a,b)=>compare(b.score,a.score));winners=scores.filter(x=>compare(x.score,scores[0].score)===0).map(x=>x.p);
        }
        if(!winners.length)throw new Error('底池无可获奖玩家');
        winners.sort((a,b)=>((a.seat-s.button+11)%11||11)-((b.seat-s.button+11)%11||11));
        const share=Math.floor(portion/winners.length),extra=portion%winners.length;
        winners.forEach((p,i)=>p.stack+=share+(i<extra?1:0));
        s.pots.push({amount:portion,winners:winners.map(p=>p.id),...(boards.length>1?{board:run,potIndex}: {})});
      }
      potIndex++;
    }
    const live=s.players.filter(p=>!p.folded);
    if(live.length>1) {
      if(live.some(p=>p.allIn)||s.showdownMode==='all')live.forEach(p=>s.shown[p.id]=[0,1]);
      else {
        const order=[...live].sort((a,b)=>((a.seat-s.button+11)%11||11)-((b.seat-s.button+11)%11||11));
        const first=order.findIndex(p=>p.id===s.lastAggressor);if(first>0)order.push(...order.splice(0,first));
        let best:number[]|null=null;
        for(const p of order) {
          const score=evaluate([...p.cards,...s.board]).score;
          if(!best||compare(score,best)>=0||s.pots.some(pot=>!pot.returned&&pot.winners.includes(p.id)))s.shown[p.id]=[0,1];
          if(!best||compare(score,best)>0)best=score;
        }
      }
    }
    s.street='finished';s.actor=null;s.pending=[];
    s.log.push('本手已结算');
  }
  view(id:number) {
    const s=this.state;
    return {id:s.id,button:s.button,street:s.street,board:s.board,boards:s.boards,currentBet:s.currentBet,actor:s.actor,straddles:s.straddles,runout:s.runout,
      pot:s.players.reduce((n,p)=>n+p.total+p.deadBlind,0),pots:s.pots,log:s.log,legal:this.legal(id),
      players:s.players.map(({cards,actedAt,...p})=>{
        const shown=s.shown[p.id]??[],publicCards=cards.map((c,i)=>shown.includes(i)?c:null);
        return {...p,shown,publicCards,cards:p.id===id?cards:publicCards.filter((c):c is Card=>c!==null),handName:s.street==='finished'&&s.board.length===5&&!p.folded&&(p.id===id||shown.length===2)?evaluate([...cards,...s.board]).name:null};
      })};
  }
}
