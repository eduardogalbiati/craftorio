// The owner's time zone helper (#273) for the main process: packages/shared/time-zone.js, shared with the
// page (window.TimeZone). Days, weeks, months and resets are cut in settings.timeZone; stamps stay UTC.
module.exports = require('@craftorio/shared/time-zone');
