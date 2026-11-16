import 'dotenv/config';
import { config } from 'dotenv';
import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import { Store, verifyPassword } from './store';
import { Room } from './room';

config({path:'.env.local'});
const production=process.argv.includes('--production');
const port=Number(process.env.PORT??9527),host=process.env.HOST??'0.0.0.0';
if(production&&!process.env.PUBLIC_ORIGIN?.startsWith('https://'))throw new Error('生产环境必须设置 PUBLIC_ORIGIN=https://你的域名');
const store=new Store(resolve(process.env.DATA_DIR??'data','fishman.sqlite'));
if(!store.users().length) {
  if(!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<12)throw new Error('请先运行 npm run setup，或在环境变量中设置至少 12 位 ADMIN_PASSWORD');
  store.createUser(process.env.ADMIN_USERNAME??'admin','房主',process.env.ADMIN_PASSWORD,true);
}
const room=new Room(store);
const app=express(),server=createServer(app);
app.disable('x-powered-by');
app.use(express.json({limit:'8kb'}));
app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');next();});
function cookie(raw:string|undefined) {return (raw??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fishman_session='))?.slice(16)??'';}
const validOrigin=(origin:string|undefined,hostHeader:string|undefined)=>!!origin&&(process.env.PUBLIC_ORIGIN?origin===process.env.PUBLIC_ORIGIN:origin===`http://${hostHeader}`);
app.use('/api',(req,res,next)=>{
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method)&&!validOrigin(req.get('origin'),req.get('host'))){res.status(403).json({error:'请求来源不合法'});return;}next();
});
const connections=new Map<number,Socket>();
const io=new Server(server,{maxHttpBufferSize:8192,allowRequest:(req,done)=>done(null,validOrigin(req.headers.origin,req.headers.host))});
const limits=new Map<string,{count:number;until:number}>();
const rate=(key:string,max:number,ms:number)=>{const now=Date.now();if(limits.size>2000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);let v=limits.get(key);if(!v||v.until<now){v={count:0,until:now+ms};limits.set(key,v);}return ++v.count<=max;};
app.get('/api/health',(_req,res)=>res.json({status:'ok',version:'0.1.0'}));
app.post('/api/login',(req,res)=>{
  if(!rate(`login:${req.socket.remoteAddress}`,30,60000)){res.status(429).json({error:'尝试过于频繁，请稍后再试'});return;}
  const input=z.object({username:z.string().min(3).max(24),password:z.string().min(1).max(128)}).safeParse(req.body);
  const user=input.success?store.byName(input.data.username):undefined;
  if(!input.success||!user||!verifyPassword(input.data.password,user.password)){res.status(401).json({error:'账号或密码错误'});return;}
  const token=store.login(user);connections.get(user.id)?.disconnect(true);
  res.cookie('fishman_session',token,{httpOnly:true,sameSite:'strict',secure:production,maxAge:7*86400000,path:'/'});
  res.json({user:store.publicUser(user)});
});
app.use('/api',(req,res,next)=>{const user=store.session(cookie(req.headers.cookie));if(!user){res.status(401).json({error:'请先登录'});return;}res.locals.user=user;next();});
app.get('/api/me',(_req,res)=>res.json({user:store.publicUser(res.locals.user)}));
app.get('/api/room',(_req,res)=>res.json(room.view(res.locals.user.id)));
app.get('/api/ledger',(_req,res)=>res.json(store.recent(res.locals.user.id)));
app.post('/api/logout',(req,res)=>{store.logout(cookie(req.headers.cookie));connections.get(res.locals.user.id)?.disconnect(true);res.clearCookie('fishman_session',{path:'/'});res.json({ok:true});});
app.post('/api/admin/users',(req,res)=>{
  if(!res.locals.user.admin){res.status(403).json({error:'需要管理员权限'});return;}
  if(!rate(`create:${res.locals.user.id}`,10,60000)){res.status(429).json({error:'操作过于频繁'});return;}
  const input=z.object({username:z.string(),name:z.string(),password:z.string()}).safeParse(req.body);
  if(!input.success){res.status(400).json({error:'请填写完整的账号信息'});return;}
  try{res.json({user:store.publicUser(store.createUser(input.data.username,input.data.name,input.data.password))});}
  catch(error){res.status(400).json({error:error instanceof Error?error.message:'创建失败'});}
});
app.use('/api',(_req,res)=>res.status(404).json({error:'接口不存在'}));
function broadcast() {for(const [id,socket] of connections)socket.emit('state',room.view(id));}
io.use((socket,next)=>{const user=store.session(cookie(socket.request.headers.cookie));if(!user)return next(new Error('登录已失效'));socket.data.userId=user.id;next();});
io.on('connection',socket=>{
  const id=socket.data.userId as number;connections.get(id)?.disconnect(true);connections.set(id,socket);room.online.add(id);broadcast();
  socket.on('command',(raw:unknown,ack:unknown)=>{
    if(typeof ack!=='function')return;
    if(!store.session(cookie(socket.request.headers.cookie))){ack({ok:false,error:'登录已失效'});socket.disconnect(true);return;}
    if(!rate(`cmd:${id}`,30,1000)){ack({ok:false,error:'操作过于频繁'});return;}
    const parsed=z.object({key:z.string().min(10).max(80),version:z.number().int().nonnegative(),type:z.string().max(30),data:z.record(z.string(),z.unknown()).optional()}).safeParse(raw);
    if(!parsed.success){ack({ok:false,error:'请求格式错误'});return;}
    try {const {key,version,type,data}=parsed.data;room.command(id,key,version,type,data);ack({ok:true});broadcast();}
    catch(error){ack({ok:false,error:error instanceof Error?error.message:'操作失败'});socket.emit('state',room.view(id));}
  });
  socket.on('disconnect',()=>{if(connections.get(id)===socket){connections.delete(id);room.online.delete(id);broadcast();}});
});
const timer=setInterval(()=>{try{if(room.tick())broadcast();}catch(error){console.error('牌局时钟错误',error);room.state.running=false;room.state.pausedForRecovery=true;broadcast();}},500);
if(production) {
  app.use(express.static(resolve('dist/web')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/web/index.html')));
} else {
  const {createServer:createViteServer}=await import('vite');
  const vite=await createViteServer({server:{middlewareMode:true,hmr:{server},allowedHosts:['localhost','127.0.0.1']},appType:'spa'});
  app.use(vite.middlewares);
}
server.listen(port,host,()=>{
  const actualPort=(server.address() as {port:number}).port;
  console.log(`鱼人德州: http://localhost:${actualPort}`);
  for(const addresses of Object.values(networkInterfaces()))for(const a of addresses??[])if(a.family==='IPv4'&&!a.internal)console.log(`局域网: http://${a.address}:${actualPort}`);
});
function close(){clearInterval(timer);io.close();server.close(()=>{store.db.close();process.exit(0);});setTimeout(()=>process.exit(0),3000).unref();}
process.once('SIGTERM',close);process.once('SIGINT',close);
