const portrait:Record<number,number[][]>={
  2:[[50,90],[50,10]],
  3:[[50,90],[15,22],[85,22]],
  4:[[50,90],[12,50],[50,10],[88,50]],
  5:[[50,90],[12,65],[24,15],[76,15],[88,65]],
  6:[[50,90],[12,68],[12,30],[50,10],[88,30],[88,68]],
  7:[[50,90],[12,72],[12,43],[28,12],[72,12],[88,43],[88,72]],
  8:[[50,90],[12,76],[12,49],[12,22],[50,10],[88,22],[88,49],[88,76]],
  9:[[50,90],[12,77],[12,50],[12,23],[37,10],[63,10],[88,23],[88,50],[88,77]],
  10:[[50,90],[12,80],[12,58],[12,36],[24,12],[50,10],[76,12],[88,36],[88,58],[88,80]],
  11:[[50,90],[12,81],[12,62],[12,43],[12,24],[37,10],[63,10],[88,24],[88,43],[88,62],[88,81]],
};
// Seat IDs are physical positions. Only the view rotates; dealing order never changes.
export function seatPosition(index:number,count:number,ownSeat:number|null) {
  const relative=(index-(ownSeat??0)+count)%count;
  const angle=relative/count*Math.PI*2;
  const [mobileLeft,mobileTop]=portrait[count][relative];
  return {left:50-40*Math.sin(angle),top:50+38*Math.cos(angle),mobileLeft,mobileTop,relative};
}
