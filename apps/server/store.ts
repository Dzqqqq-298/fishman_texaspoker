import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export type User = { id:number; username:string; name:string; password:string; admin:number; balance:number; timeCards:number; hands:number };
export function hashPassword(password:string) {const salt=randomBytes(16).toString('hex');return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyPassword(password:string,hash:string) {const [salt,key]=hash.split(':');const expected=Buffer.from(key,'hex');const actual=scryptSync(password,salt,64);return expected.length===actual.length&&timingSafeEqual(expected,actual);}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export class Store {
  db:DatabaseSync;
  constructor(path:string) {
    if(path!==':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,balance INTEGER NOT NULL DEFAULT 100000 CHECK(balance>=0),timeCards INTEGER NOT NULL DEFAULT 3,hands INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,userId INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS room(id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY,userId INTEGER NOT NULL REFERENCES users(id),amount INTEGER NOT NULL,kind TEXT NOT NULL,at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS hands(id TEXT PRIMARY KEY,summary TEXT NOT NULL,at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS commands(userId INTEGER NOT NULL,key TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(userId,key));`);
  }
  users() {return this.db.prepare('SELECT * FROM users ORDER BY id').all() as User[];}
  user(id:number) {return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as User|undefined;}
  byName(username:string) {return this.db.prepare('SELECT * FROM users WHERE username=?').get(username) as User|undefined;}
  createUser(username:string,name:string,password:string,admin=false) {
    if(!/^[a-zA-Z0-9_]{3,24}$/.test(username)||!name.trim()||name.trim().length>16||password.length<12||password.length>128) throw new Error('账号需 3～24 位字母数字下划线；昵称 1～16 字；密码至少 12 位');
    if(this.byName(username)) throw new Error('账号已存在');
    const result=this.db.prepare('INSERT INTO users(username,name,password,admin) VALUES(?,?,?,?)').run(username,name.trim(),hashPassword(password),Number(admin));
    return this.user(Number(result.lastInsertRowid))!;
  }
  publicUser(user:User) {const {password,...publicUser}=user;return publicUser;}
  session(token:string) {return this.db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.userId WHERE token=? AND expires>?').get(digest(token),Date.now()) as User|undefined;}
  login(user:User) {
    this.db.prepare('DELETE FROM sessions WHERE userId=? OR expires<?').run(user.id,Date.now());
    const token=randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+7*86400000);return token;
  }
  logout(token:string) {this.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));}
  balance(id:number,delta:number,kind:string) {
    if(!Number.isSafeInteger(delta)) throw new Error('积分金额错误');
    const result=this.db.prepare('UPDATE users SET balance=balance+? WHERE id=? AND balance+?>=0').run(delta,id,delta);
    if(!result.changes) throw new Error('账户积分不足');
    this.record(id,delta,kind);
  }
  record(id:number,amount:number,kind:string) {this.db.prepare('INSERT INTO ledger(userId,amount,kind) VALUES(?,?,?)').run(id,amount,kind);}
  recent(id:number) {return this.db.prepare('SELECT amount,kind,at FROM ledger WHERE userId=? ORDER BY id DESC LIMIT 30').all();}
  load<T>() {const row=this.db.prepare('SELECT state FROM room WHERE id=1').get() as {state:string}|undefined;return row?JSON.parse(row.state) as T:null;}
  save(state:unknown) {this.db.prepare('INSERT INTO room VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(JSON.stringify(state));}
  transaction<T>(fn:()=>T) {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  seen(id:number,key:string) {return !!this.db.prepare('SELECT 1 FROM commands WHERE userId=? AND key=?').get(id,key);}
  remember(id:number,key:string) {this.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(id,key,Date.now());this.db.prepare('DELETE FROM commands WHERE at<?').run(Date.now()-7*86400000);}
}
