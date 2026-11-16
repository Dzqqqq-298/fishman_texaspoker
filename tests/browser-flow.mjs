// Functional browser checks only: no screenshots or visual inspection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { chromium } from 'playwright-core';

const candidates=[process.env.BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
let executablePath;
for(const path of candidates)try{await access(path);executablePath=path;break;}catch{}
if(!executablePath)throw new Error('请设置 BROWSER_EXECUTABLE 为本机 Chromium/Edge/Chrome 可执行文件路径');
const folder=await mkdtemp(join(tmpdir(),'fishman-ui-'));
const password='Browser-fixture-password-9527';
const child=spawn(process.execPath,['--import','tsx','apps/server/index.ts'],{cwd:process.cwd(),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATA_DIR:folder,ADMIN_USERNAME:'uitest',ADMIN_PASSWORD:password,PUBLIC_ORIGIN:''},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',port=0,browser;
child.stdout.on('data',d=>{output+=d;port=Number(output.match(/http:\/\/localhost:(\d+)/)?.[1]??0);});
child.stderr.on('data',d=>output+=d);
async function until(fn,ms=10000){const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw new Error('浏览器流程等待超时');await new Promise(r=>setTimeout(r,30));}}
try {
  await until(()=>port||child.exitCode!==null,15000);assert.ok(port,output);
  const base=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({headless:true,executablePath});
  const desktop=await browser.newContext({viewport:{width:1440,height:900}});
  const mobile=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true});
  const host=await desktop.newPage(),friend=await mobile.newPage(),errors=[];
  for(const page of [host,friend]){page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(10000);}
  const login=async(page,username)=>{await page.goto(base);await page.getByLabel('账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:/^登录/}).click();await page.getByRole('heading',{name:'大厅',exact:true}).waitFor();};
  await login(host,'uitest');
  const added=await host.request.post(`${base}/api/admin/users`,{headers:{Origin:base},data:{username:'friendtest',name:'手机玩家',password}});assert.equal(added.status(),200);
  await host.getByRole('button',{name:'＋ 创建房间',exact:true}).click();
  await host.getByLabel('房间名称').fill('选座交互测试');
  await host.getByRole('button',{name:'创建房间',exact:true}).click();
  await host.getByRole('button',{name:'6 号空座，点击入座',exact:true}).waitFor();
  assert.equal(await host.getByRole('dialog').count(),0);
  assert.equal(await host.getByRole('button',{name:/号空座，点击入座/}).count(),11);
  await login(friend,'friendtest');await friend.getByRole('button',{name:/进入房间/}).click();
  // Both players select the same physical seat, but only one may pay for it.
  for(const page of [host,friend])await page.getByRole('button',{name:'6 号空座，点击入座',exact:true}).click();
  await host.getByRole('button',{name:'确认入座',exact:true}).click();
  await host.getByRole('dialog').waitFor({state:'detached'});
  await friend.getByText('座位已有人，请另选',{exact:true}).waitFor();
  assert.equal(await friend.getByRole('button',{name:'确认入座',exact:true}).isDisabled(),true);
  const state=async page=>(await page.request.get(`${base}/api/room`)).json();
  assert.equal((await state(friend)).me.balance,100000);
  await friend.getByRole('button',{name:'关闭',exact:true}).click();
  await friend.getByRole('button',{name:'3 号空座，点击入座',exact:true}).click();
  await friend.getByRole('button',{name:'确认入座',exact:true}).click();
  await friend.getByRole('dialog').waitFor({state:'detached'});
  assert.equal((await state(host)).seats.find(s=>s.name==='房主').seat,5);
  assert.equal((await state(friend)).seats.find(s=>s.name==='手机玩家').seat,2);
  for(const page of [host,friend]) {
    await page.getByRole('button',{name:'设置',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'设置',exact:true});await dialog.waitFor();
    for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
    assert.ok(await page.getByRole('button',{name:'设置',exact:true}).evaluate(el=>document.activeElement===el));
    await page.getByRole('button',{name:'记录',exact:true}).click();
    await page.getByRole('dialog',{name:'记录',exact:true}).getByRole('cell',{name:'手机玩家',exact:true}).waitFor();
    await page.getByRole('button',{name:'关闭',exact:true}).click();
  }
  await host.getByRole('button',{name:'开始比赛',exact:true}).click();
  await until(async()=>!!(await state(host)).hand);
  await host.getByRole('button',{name:'设置',exact:true}).click();
  await host.getByRole('button',{name:'结束比赛',exact:true}).click();
  await until(async()=>(await state(host)).match.endRequested);
  await host.getByRole('dialog').waitFor({state:'detached'});
  const current=await state(host),actor=current.hand.actor===current.me.id?host:friend;
  await actor.getByRole('button',{name:'弃牌',exact:true}).click();
  for(const page of [host,friend])await page.getByRole('heading',{name:'本场结算',exact:true}).waitFor();
  const final=await state(host);assert.equal(final.match,null);assert.equal(final.recentMatches[0].handCount,1);
  assert.equal(final.recentMatches[0].players.reduce((n,p)=>n+p.profit,0),0);
  await host.getByRole('button',{name:'秀第 1 张底牌',exact:true}).click();
  const firstHistory=await (await host.request.get(`${base}/api/hands?matchId=${final.recentMatches[0].id}`)).json();
  assert.equal(firstHistory.hands[0].players.find(p=>p.id===final.me.id).publicCards.filter(Boolean).length,1);
  await host.getByRole('button',{name:'本场牌谱',exact:true}).click();
  await host.getByRole('combobox',{name:'选择手牌'}).waitFor();
  for(const page of [host,friend])await page.getByRole('button',{name:'返回大厅',exact:true}).click();
  await host.locator('.match-result summary').first().click();
  await host.getByRole('button',{name:'本场牌谱',exact:true}).click();
  await host.getByRole('combobox',{name:'选择手牌'}).waitFor();
  // A second match exercises the expanded raise panel, chat mute and unanimous double runout.
  await host.getByRole('button',{name:'＋ 创建房间',exact:true}).click();
  await host.getByLabel('房间名称').fill('双发与聊天测试');await host.getByLabel('人数上限').selectOption('2');
  await host.getByRole('button',{name:'创建房间',exact:true}).click();
  await host.getByRole('button',{name:'1 号空座，点击入座',exact:true}).click();await host.getByRole('button',{name:'确认入座',exact:true}).click();await host.getByRole('dialog').waitFor({state:'detached'});
  await friend.getByRole('button',{name:/进入房间/}).click();await friend.getByRole('button',{name:'2 号空座，点击入座',exact:true}).click();await friend.getByRole('button',{name:'确认入座',exact:true}).click();await friend.getByRole('dialog').waitFor({state:'detached'});
  await host.getByRole('button',{name:/^聊天/}).click();await host.getByLabel('消息',{exact:true}).fill('开始吧');await host.getByRole('button',{name:'发送',exact:true}).click();await host.getByText('开始吧',{exact:true}).waitFor();await host.keyboard.press('Escape');
  await friend.getByRole('button',{name:/^聊天/}).click();await friend.getByText('开始吧',{exact:true}).waitFor();await friend.keyboard.press('Escape');
  await host.getByRole('button',{name:'开始比赛',exact:true}).click();
  assert.equal(await host.getByRole('slider',{name:'加注滑杆'}).count(),0);
  await host.getByRole('button',{name:'加注',exact:true}).click();await host.getByRole('slider',{name:'加注滑杆'}).waitFor();
  await host.getByRole('button',{name:'1/2',exact:true}).click();assert.ok(Number(await host.getByLabel('加注到',{exact:true}).inputValue())>=40);
  await host.getByRole('button',{name:'全下',exact:true}).click();await host.getByRole('button',{name:/^确认加注/}).click();
  await host.getByRole('button',{name:/^聊天/}).click();assert.equal(await host.getByLabel('消息',{exact:true}).isDisabled(),true);await host.keyboard.press('Escape');
  await host.getByRole('button',{name:'设置',exact:true}).click();await host.getByRole('button',{name:'结束比赛',exact:true}).click();await host.getByRole('dialog').waitFor({state:'detached'});
  await friend.getByRole('button',{name:/^跟注/}).click();
  await host.getByRole('button',{name:'同意发两次',exact:true}).click();await friend.getByRole('button',{name:'同意发两次',exact:true}).click();
  for(const page of [host,friend])await page.getByRole('heading',{name:'本场结算',exact:true}).waitFor();
  const twice=await state(host),twiceHistory=await (await host.request.get(`${base}/api/hands?matchId=${twice.recentMatches[0].id}`)).json();
  assert.equal(twiceHistory.hands[0].boards.length,2);assert.ok(twiceHistory.hands[0].players.every(p=>p.publicCards.every(Boolean)));
  assert.equal(twice.recentMatches[0].players.reduce((n,p)=>n+p.profit,0),0);
  // Four real clients: reserve next hand's UTG straddle while this hand is still running.
  for(const page of [host,friend])await page.getByRole('button',{name:'返回大厅',exact:true}).click();
  const extras=[];
  for(let i=0;i<2;i++){
    const username=`straddlefriend${i}`;
    const added=await host.request.post(`${base}/api/admin/users`,{headers:{Origin:base},data:{username,name:`接力玩家${i}`,password}});assert.equal(added.status(),200);
    const context=await browser.newContext({viewport:{width:375,height:812},isMobile:true,hasTouch:true}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(10000);
    await login(page,username);extras.push(page);
  }
  await host.getByRole('button',{name:'＋ 创建房间',exact:true}).click();
  await host.getByLabel('房间名称').fill('下一手抓位测试');await host.getByLabel('人数上限').selectOption('4');
  await host.getByRole('button',{name:'创建房间',exact:true}).click();
  const players=[host,friend,...extras],pagesById=new Map();
  for(let i=0;i<players.length;i++){
    const page=players[i];if(i)await page.getByRole('button',{name:/进入房间/}).click();
    await page.getByRole('button',{name:`${i+1} 号空座，点击入座`,exact:true}).click();await page.getByRole('button',{name:'确认入座',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
    pagesById.set((await state(page)).me.id,page);
  }
  await host.getByRole('button',{name:'开始比赛',exact:true}).click();
  await host.getByRole('button',{name:'设置',exact:true}).click();await host.getByRole('button',{name:'本手后暂停',exact:true}).click();await host.keyboard.press('Escape');
  const preview=await state(host),initialHand=preview.hand.id;
  assert.equal(await friend.getByRole('button',{name:'Double Straddle 80',exact:true}).count(),0);
  await host.getByRole('button',{name:'Straddle 40',exact:true}).click();
  await friend.getByRole('button',{name:'Double Straddle 80',exact:true}).click();
  await host.getByRole('button',{name:'取消预约',exact:true}).click();
  await until(async()=>await friend.getByRole('button',{name:'取消预约',exact:true}).count()===0);
  await host.getByRole('button',{name:'Straddle 40',exact:true}).click();
  await friend.getByRole('button',{name:'Double Straddle 80',exact:true}).click();
  assert.deepEqual((await state(host)).hand.straddles,[]);assert.equal((await state(host)).hand.id,initialHand);
  const foldCurrentHand=async()=>{let guard=0;while(true){const s=await state(host);if(!s.match||s.hand?.street==='finished')break;assert.ok(++guard<5);const actor=pagesById.get(s.hand.actor);await actor.getByRole('button',{name:'弃牌',exact:true}).click();await until(async()=>{const after=await state(host);return !after.hand||after.hand.actor!==s.hand.actor;});}};
  await foldCurrentHand();await host.getByRole('button',{name:'继续比赛',exact:true}).click();
  await until(async()=>(await state(host)).hand.id!==initialHand);
  assert.deepEqual((await state(host)).hand.straddles.map(s=>s.amount),[40,80]);
  await host.getByRole('button',{name:'设置',exact:true}).click();await host.getByRole('button',{name:'结束比赛',exact:true}).click();await host.getByRole('dialog').waitFor({state:'detached'});
  await foldCurrentHand();await host.getByRole('heading',{name:'本场结算',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('UI flow passed: desktop + mobile, seat contention, buy-in, drawer focus/Escape, records, voluntary show, chat mute, raise panel, double runout, settlement and four-client next-hand Straddle relay.');
} finally {
  await browser?.close();child.kill();await until(()=>child.exitCode!==null||child.signalCode!==null).catch(()=>{});
  const rel=relative(resolve(tmpdir()),resolve(folder));
  if(rel&&!rel.startsWith('..')&&!isAbsolute(rel))await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
