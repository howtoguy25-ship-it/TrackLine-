// Placeholders for the providers being quoted (AUCN, MotorWeb, Equifax) for PPSR and odometer
// history. Each one answers "not set up" -- never invented data -- so a report shows the
// section as unavailable and the feature stays hidden in production (see availability() in
// providers.js) until a real adapter replaces the stub and its key is in Firebase secrets.
//
// To add one: implement the same method(s) as ppsrBusinessApi.js / carjamAu.js, returning
// { source, asAt, data } -- odometerHistory's data is { readings: [{ date: "YYYY-MM-DD",
// km: number, source?: string }] } -- then register it in providers.js and switch to it with
// config/vehicleCheck.providers.

const { ProviderError } = require("./errors");

function stub(name, methods) {
  const adapter = { name, costs: [], stub: true };
  for (const method of methods) {
    adapter[method] = async () => {
      throw new ProviderError("not_configured", `${name} isn't connected yet.`);
    };
  }
  return adapter;
}

const createAucn = () => stub("AUCN", ["ppsr", "odometerHistory"]);
const createMotorWeb = () => stub("MotorWeb", ["ppsr", "odometerHistory"]);
const createEquifax = () => stub("Equifax", ["ppsr", "odometerHistory"]);

module.exports = { createAucn, createMotorWeb, createEquifax };
