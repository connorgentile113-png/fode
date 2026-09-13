#!/usr/bin/env node
import net from 'node:net';
import { socketPath } from './paths.js';
// Both transports use native-messaging frames; no network port or browser token.
const socket=net.connect(socketPath);
socket.on('connect',()=>{process.stdin.pipe(socket);socket.pipe(process.stdout);});
socket.on('error',error=>{console.error(`Fode: ${error.message}. Start fode serve or install its user service.`);process.exit(1);});
socket.on('close',()=>process.exit(0));
process.stdin.on('end',()=>socket.end());
process.stdout.on('error',()=>process.exit(0));
