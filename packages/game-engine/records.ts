import type { Card } from './cards';
import type { PotResult } from './holdem';

export interface HandRecord {
  id:string;matchId:string;number:number;completedAt:number;
  board:Card[];boards:Card[][];pots:PotResult[];log:string[];
  players:{id:number;name:string;seat:number;publicCards:(Card|null)[];stack:number;contributed:number;profit:number;folded:boolean}[];
}
export interface ChatMessage {id:string;userId:number;name:string;text:string;at:number}
