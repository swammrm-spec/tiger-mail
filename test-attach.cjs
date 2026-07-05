const http = require('http');

const data = JSON.stringify({
  email: "m.safadi@techno-grp.com",
  password: "Aa@2024@@!@#"
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const r = JSON.parse(body);
    console.log('TOKEN:', r.token ? r.token.substring(0, 30) + '...' : 'none');
    
    // Now get attachments for email 77
    const opts2 = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/emails/77',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + r.token }
    };
    http.get(opts2, (res2) => {
      let body2 = '';
      res2.on('data', (chunk) => body2 += chunk);
      res2.on('end', () => {
        const email = JSON.parse(body2);
        console.log('Email attachments:', JSON.stringify(email.email?.attachments || email.attachments || 'none', null, 2));
      });
    });
  });
});
req.write(data);
req.end();
