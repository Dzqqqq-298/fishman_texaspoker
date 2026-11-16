import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env.local')) {
  console.log('已有 .env.local，保持不变。管理员信息在该文件中。');
} else {
  const password = randomBytes(12).toString('base64url');
  writeFileSync('.env.local', readFileSync('.env.example', 'utf8').replace('ADMIN_PASSWORD=', `ADMIN_PASSWORD=${password}`));
  console.log('已生成 .env.local。初始账号：admin；初始密码保存在该文件 ADMIN_PASSWORD 中。');
}
console.log('运行 npm run dev，然后访问 http://localhost:9527');
