import test from 'node:test';
import assert from 'node:assert/strict';
import messaging from '../../desktop/windowMessaging.cjs';

const { canSendToWindow, sendToWindow } = messaging;

function fakeWindow({ windowDestroyed = false, contentsDestroyed = false, send } = {}) {
  return {
    isDestroyed: () => windowDestroyed,
    webContents: {
      isDestroyed: () => contentsDestroyed,
      send: send || (() => {}),
    },
  };
}

test('desktop events are withheld after the window or renderer is destroyed', () => {
  assert.equal(canSendToWindow(fakeWindow({ windowDestroyed: true })), false);
  assert.equal(canSendToWindow(fakeWindow({ contentsDestroyed: true })), false);
  assert.equal(sendToWindow(fakeWindow({ contentsDestroyed: true }), 'event', {}), false);
});

test('desktop event delivery tolerates destruction between the lifecycle check and send', () => {
  const window = fakeWindow({ send: () => { throw new TypeError('Object has been destroyed'); } });
  assert.equal(sendToWindow(window, 'event', {}), false);
});

test('desktop event delivery never lets an IPC failure crash the main process', () => {
  const window = fakeWindow({ send: () => { throw new Error('Unexpected IPC failure'); } });
  assert.equal(sendToWindow(window, 'event', {}), false);
});
