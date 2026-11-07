import { getEnv } from './src/lib/server/env';
import { encryptSecret } from './src/lib/server/crypto';

const env = getEnv();
const enc = encryptSecret(env, '787e0b4f3207f6a5e15ebeb2ec16560f');
console.log(enc);
