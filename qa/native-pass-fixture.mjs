// Complete synthetic evidence for sanitizer unit tests, not device validation.
export function androidPassRows(errorCode) {
  return [
    { event: 'boot' }, { event: 'pdf_result', result: 'pass', trials: 3 },
    ...[1, 2, 3].flatMap(trial => [0, 1].map(raster => ({ event: 'pdf_raster', trial, raster, status: 1 }))),
    ...Array.from({ length: 20 }, (_, i) => i + 1).flatMap(cycle => [
      { event: 'list_open', cycle },
      ...(cycle <= 3 ? [{ event: errorCode === undefined ? 'player_ready' : 'player_unavailable', cycle, ...(errorCode === undefined ? {} : { errorCode }) }] : []),
      { event: 'list_close', cycle }, { event: 'cycle_complete', cycle },
    ]),
    { event: 'suite_result', platform: 'android', result: 'pass', cycles: 20, playerCycles: 3 },
  ];
}
export const androidPassLog = androidPassRows().map(row => 'QA_JSON ' + JSON.stringify(row)).join('\n');
