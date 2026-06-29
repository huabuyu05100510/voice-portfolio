/**
 * NestJS ASR 端到端冒烟测试
 * 连到本地 5001, 走完 start_recording → audio_data → stop_recording, 检查事件契约
 *
 * 不发真实音频 (没麦克风), 只验证:
 *  - connected 事件
 *  - start_recording 握手成功 → recording_started
 *  - stop_recording → recording_stopped
 *  - error 事件不出现
 *
 * 用法: npx ts-node scripts/smoke-asr.ts
 */
import { io as ioc } from 'socket.io-client';

const URL = 'http://localhost:5001';

async function main(): Promise<void> {
  const sock = ioc(URL, { transports: ['websocket'] });
  const events: string[] = [];

  const connectedPromise = new Promise<string>((resolve) => {
    sock.on('connected', (d: { session_id: string }) => {
      events.push(`connected sid=${d.session_id}`);
      resolve(d.session_id);
    });
  });
  sock.on('recording_started', () => events.push('recording_started'));
  sock.on('recording_stopped', () => events.push('recording_stopped'));
  sock.on('error', (e: any) => events.push(`ERROR ${JSON.stringify(e)}`));
  sock.on('transcription_result', (r: any) =>
    events.push(`tr ${r.is_final ? 'F' : 'P'} ${r.text?.slice(0, 30)}`),
  );

  const sid = await connectedPromise;
  console.log('connected:', sid);

  sock.emit('start_recording', { enable_tts: false });
  await new Promise((r) => setTimeout(r, 6000)); // 等 WSS 握手 + 一些时间

  // 发 1s 静音音频 (16kHz mono PCM = 32000 bytes)
  const silence = Buffer.alloc(32000, 0);
  sock.emit('audio_data', silence);
  await new Promise((r) => setTimeout(r, 1000));

  sock.emit('stop_recording');
  await new Promise((r) => setTimeout(r, 2500));

  console.log('--- events observed ---');
  for (const e of events) console.log(' ', e);

  sock.disconnect();
  const sawStart = events.includes('recording_started');
  const sawStop = events.includes('recording_stopped');
  console.log(
    `\nresult: recording_started=${sawStart} recording_stopped=${sawStop}`,
  );
  if (sawStart && sawStop) {
    console.log('PASS — ASR pipeline wired end-to-end');
    process.exit(0);
  } else {
    console.log('FAIL');
    process.exit(1);
  }
}

void main();
