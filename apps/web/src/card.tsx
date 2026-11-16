export function Card({value,empty=false}:{value?:string;empty?:boolean}) {
  const suit=value?({c:'♣',d:'♦',h:'♥',s:'♠'}[value[1]]):'';
  return <span className={`card ${value&&'dh'.includes(value[1])?'red':''} ${!value?'back':''} ${empty?'empty':''}`} aria-label={value?`${value[0]}${suit}`:'未发牌'}>{value?<><b>{value[0]==='T'?'10':value[0]}</b><span>{suit}</span></>:<span>◇</span>}</span>;
}
