// Elo5 — item 3 do checklist: regra P0 de ACK isolada (espelho do server.js).
// Opera via repositories/commands.js; recebe db + fmtTs por injeção para ser testável.

'use strict';

const commandsRepo = require('../repositories/commands');

// P0: does an observed device state satisfy a queued command?
function commandSatisfiedByState(action, armed, alarming) {
  if (action === 'arm') return armed === true;
  if (action === 'disarm') return armed === false;
  if (action === 'reset_alarm') return alarming === false;
  // test / recalibrate don't change armed state: they are ACKed only via
  // their .../log events (test, recalibrating/recalibrated), never by state.
  return false;
}

// P0: mark un-ACKed sent commands as ACKed when the ESP state confirms them.
function ackCommandsForState(db, fmtTs, deviceId, armed, alarming) {
  const now = fmtTs(new Date());
  const rows = commandsRepo.unackedForState(db, deviceId);
  let n = 0;
  for (const r of rows) {
    if (commandSatisfiedByState(r.action, armed, alarming)) {
      commandsRepo.markAckedIfPending(db, now, r.id);
      n++;
    }
  }
  return n;
}

// P0: log-event based ACK (precise for test/recalibrate/arm/disarm/reset).
const LOG_EVENT_ACTIONS = {
  armed: ['arm'], disarmed: ['disarm'], armed_button: ['arm'], disarmed_button: ['disarm'],
  alarm_reset: ['reset_alarm'], alarm_timeout: ['reset_alarm'],
  test: ['test'], recalibrating: ['recalibrate'], recalibrated: ['recalibrate'],
};

function ackCommandsForLogEvent(db, fmtTs, deviceId, event) {
  const actions = LOG_EVENT_ACTIONS[event];
  if (!actions || !actions.length) return 0;
  const now = fmtTs(new Date());
  let n = 0;
  for (const a of actions) {
    const row = commandsRepo.oldestUnackedByAction(db, deviceId, a);
    if (row) { commandsRepo.markAcked(db, now, row.id); n++; }
  }
  return n;
}

function commandPublicStatusWithRetries(r, maxRetries) {
  if (r.acked_at) return 'acked';
  if ((r.attempts || 0) >= maxRetries && r.sent_at) return 'failed';
  if (r.sent_at) return 'sending';
  return 'pending';
}

module.exports = {
  commandSatisfiedByState,
  ackCommandsForState,
  ackCommandsForLogEvent,
  LOG_EVENT_ACTIONS,
  commandPublicStatusWithRetries,
};
