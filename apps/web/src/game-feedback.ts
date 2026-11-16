import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '../../server/room';

export function useGameFeedback(room:RoomView,remaining:number) {
  const [sound,setSound]=useState(()=>{try{return localStorage.getItem('fishman-sound')!=='off';}catch{return true;}});
  const audio=useRef<AudioContext|null>(null),lastTurn=useRef(''),warned=useRef('');
  useEffect(()=>{
    const unlock=()=>{try{audio.current??=new AudioContext();void audio.current.resume().catch(()=>{});}catch{}};
    window.addEventListener('pointerdown',unlock);window.addEventListener('keydown',unlock);
    return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);void audio.current?.close();};
  },[]);
  useEffect(()=>{try{localStorage.setItem('fishman-sound',sound?'on':'off');}catch{}},[sound]);
  useEffect(()=>{
    const turn=room.hand?.actor===room.me.id&&!room.pausedForRecovery?`${room.hand.id}:${room.hand.street}:${room.hand.currentBet}:${room.hand.actor}:${room.deadline}`:'';
    const beep=(frequency:number)=>{const ctx=audio.current;if(!sound||!ctx||ctx.state!=='running')return;const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=frequency;g.gain.setValueAtTime(.07,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.2);};
    if(turn&&turn!==lastTurn.current)beep(660);
    if(turn&&remaining>0&&remaining<=5&&warned.current!==turn){beep(880);warned.current=turn;}
    lastTurn.current=turn;
  },[room.hand?.id,room.hand?.street,room.hand?.actor,room.hand?.currentBet,room.me.id,room.deadline,room.pausedForRecovery,remaining,sound]);
  return {sound,setSound};
}
