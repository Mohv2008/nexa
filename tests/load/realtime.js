import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 250 },
    { duration: '1m', target: 500 },
    { duration: '2m', target: 500 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    checks: ['rate>0.99'],
    ws_connecting: ['p(95)<2000'],
  },
};

const url = __ENV.WS_URL;
const cookie = __ENV.TEST_SESSION_COOKIE;

export default function () {
  if (!url || !cookie)
    throw new Error('Set WS_URL and TEST_SESSION_COOKIE for a dedicated test account');
  const response = ws.connect(
    url,
    { headers: { Cookie: cookie, Origin: __ENV.ORIGIN } },
    (socket) => {
      socket.on('open', () => socket.send(JSON.stringify({ type: 'ping', data: {} })));
      socket.on('message', (message) => {
        const event = JSON.parse(message);
        check(event, {
          'received ready or pong': (value) => ['ready', 'pong'].includes(value.type),
        });
        if (event.type === 'pong') socket.close();
      });
      socket.setTimeout(() => socket.close(), 10_000);
    },
  );
  check(response, { 'websocket upgraded': (value) => value?.status === 101 });
  sleep(Math.random());
}
