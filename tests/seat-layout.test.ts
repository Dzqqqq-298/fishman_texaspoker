import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatPosition } from '../apps/web/src/seat-layout';

test('all 2–11 seat views keep self bottom-center and preserve clockwise physical order',()=>{
  for(let count=2;count<=11;count++)for(let own=0;own<count;own++) {
    const positions=Array.from({length:count},(_,i)=>seatPosition(i,count,own));
    assert.equal(positions[own].left,50);assert.equal(positions[own].mobileLeft,50);
    assert.ok(positions[own].top>=88&&positions[own].mobileTop>=90);
    for(let step=0;step<count;step++)assert.equal(positions[(own+step)%count].relative,step);
    assert.equal(new Set(positions.map(p=>`${p.mobileLeft},${p.mobileTop}`)).size,count);
  }
});

test('portrait seats stay in bounds and do not overlap at 320px and 375px widths',()=>{
  // The mobile stage has 8px outer gutters, 64px player seats and at least 500px height.
  for(const viewport of [320,375])for(let count=2;count<=11;count++) {
    const width=viewport-16,height=500;
    const seats=Array.from({length:count},(_,i)=>seatPosition(i,count,null));
    for(const p of seats) {
      assert.ok(p.mobileLeft/100*width>=32&&p.mobileLeft/100*width<=width-32);
      assert.ok(p.mobileTop/100*height>=45&&p.mobileTop/100*height<=height-45);
    }
    for(let i=0;i<count;i++)for(let j=i+1;j<count;j++) {
      const dx=Math.abs(seats[i].mobileLeft-seats[j].mobileLeft)/100*width;
      const dy=Math.abs(seats[i].mobileTop-seats[j].mobileTop)/100*height;
      assert.ok(dx>=64||dy>=90,`${viewport}px / ${count} seats: ${i} and ${j} overlap`);
    }
  }
});
