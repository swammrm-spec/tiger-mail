import net from 'net';
import tls from 'tls';

const config = {
  incoming_server: 'pop.emailarray.com',
  incoming_port: 995,
  username: 'm.safadi@techno-grp.com',
  password: 'Aa@2024@@!@#'
};

const socket = tls.connect({
  host: config.incoming_server,
  port: config.incoming_port,
  servername: config.incoming_server,
  rejectUnauthorized: false
}, () => {
  setTimeout(() => socket.write('USER ' + config.username + '\r\n'), 300);
  setTimeout(() => socket.write('PASS ' + config.password + '\r\n'), 600);
  setTimeout(() => socket.write('STAT\r\n'), 900);
  setTimeout(() => socket.write('UIDL\r\n'), 1200);
  setTimeout(() => socket.write('QUIT\r\n'), 2500);
});

let buffer = '';
socket.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\r\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    console.log(line);
  }
});
socket.on('end', () => { if (buffer.trim()) console.log(buffer.trim()); process.exit(0); });
setTimeout(() => process.exit(0), 8000);
