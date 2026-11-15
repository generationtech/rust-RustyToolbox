'use strict';
const sandbox = require('./helpers/sandbox');

// Email alerts (sendEmails). No network: nodemailer.createTransport is swapped for nodemailer's
// own in-memory stream transport, so the real library still builds every message.

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const nodemailer = require('nodemailer');
const rustynail = require('../rustynail/rustynail');
const { makeResetter, captureConsole } = require('./helpers/fixtures');

const { rusty } = rustynail;
const resetRusty = makeResetter(rustynail);
const realCreateTransport = nodemailer.createTransport.bind(nodemailer);

beforeEach(() => {
  sandbox.reset();
  resetRusty();
  rusty.emuser = 'alerts@example.com';
  rusty.empass = 'app-password';
});

// Records the SMTP options rustynail asks for and sends through a real in-memory transport.
function captureMail(t, { failFor = [] } = {}) {
  const calls = { options: [], sent: [] };
  t.mock.method(nodemailer, 'createTransport', (options) => {
    calls.options.push(options);
    const transport = realCreateTransport({ streamTransport: true, buffer: true });
    return {
      async sendMail(mail) {
        if (failFor.includes(mail.to)) throw new Error(`rejected ${mail.to}`);
        const info = await transport.sendMail(mail);
        calls.sent.push({ mail, raw: info.message.toString() });
        return info;
      },
    };
  });
  return calls;
}

test('sendEmails sends one plain-text message per address through Gmail SMTP', async (t) => {
  const lines = captureConsole(t);
  const calls = captureMail(t);

  await rustynail.sendEmails(['a@example.com', 'b@example.com'], 'Server: not responding', 'Server: not responding');

  assert.deepStrictEqual(calls.options[0], {
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: 'alerts@example.com', pass: 'app-password' },
  });
  assert.deepStrictEqual(calls.sent.map((s) => s.mail.to), ['a@example.com', 'b@example.com']);
  for (const { raw } of calls.sent) {
    assert.match(raw, /^From: alerts@example\.com$/m);
    assert.match(raw, /^Subject: Server: not responding$/m);
    assert.match(raw, /^Content-Type: text\/plain/m);
    assert.match(raw, /\r\n\r\nServer: not responding/);
  }
  assert.strictEqual(lines.filter((l) => l.includes('Emailed:')).length, 2);
});

test('a failed send is logged and the remaining addresses are still sent', async (t) => {
  const lines = captureConsole(t);
  const calls = captureMail(t, { failFor: ['bad@example.com'] });

  await rustynail.sendEmails(['bad@example.com', 'good@example.com'], 'subject', 'body');

  assert.deepStrictEqual(calls.sent.map((s) => s.mail.to), ['good@example.com']);
  assert.ok(lines.some((l) => l.includes('rejected bad@example.com')), lines.join('\n'));
});

test('nodemailer accepts rustynail\'s SMTP options as an SMTP transport (no connection made)', async (t) => {
  captureConsole(t);
  const calls = captureMail(t);
  await rustynail.sendEmails(['a@example.com'], 's', 'b');

  const transporter = realCreateTransport(calls.options[0]);
  try {
    assert.strictEqual(transporter.transporter.name, 'SMTP');
    assert.strictEqual(transporter.transporter.options.host, 'smtp.gmail.com');
    assert.strictEqual(transporter.transporter.options.port, 465);
    assert.strictEqual(transporter.transporter.options.secure, true);
  } finally {
    transporter.close();
  }
});
